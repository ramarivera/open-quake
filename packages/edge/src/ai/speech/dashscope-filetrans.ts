import { Clock, Effect, Schema } from "effect";
import { Segment } from "../../meetings/meeting-contracts.js";
import { meetingError } from "../../meetings/meeting-errors.js";
import type {
	MeetingAsrRequest,
	MeetingAsrResult,
} from "../meeting-adapter.js";
import { meetingRequest, providerUrl, responseJson } from "./meeting-http.js";
import type {
	MeetingResource,
	MeetingResources,
	ResolveMeetingConnection,
} from "./meeting-resources.js";
import type { SpeechHttp } from "./speech-ports.js";
import { object } from "./speech-session.js";

export const FILETRANS_MODEL = "qwen-audio-3.0-asr-flash-filetrans";
const Policy = Schema.Struct({
	upload_host: Schema.NonEmptyString,
	upload_dir: Schema.NonEmptyString,
	oss_access_key_id: Schema.NonEmptyString,
	signature: Schema.NonEmptyString,
	policy: Schema.NonEmptyString,
	object_key: Schema.optional(Schema.String),
});
const safeId = (id: unknown): id is string =>
	typeof id === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(id);
const Task = Schema.Struct({
	output: Schema.Struct({
		task_id: Schema.String,
		task_status: Schema.String,
		results: Schema.optional(Schema.Array(Schema.Unknown)),
		code: Schema.optional(Schema.String),
	}),
});
export function dashscopeFiletrans(options: {
	http: typeof SpeechHttp.Service;
	resources: MeetingResources;
	resolve: ResolveMeetingConnection;
}) {
	const { http, resources, resolve } = options;
	const call = (
		config: MeetingResource["config"],
		path: string,
		body?: unknown,
	) =>
		Effect.gen(function* () {
			const connection = yield* resolve(config);
			return yield* meetingRequest(http, providerUrl(path, connection.api), {
				method: body === undefined ? "GET" : "POST",
				headers: {
					Authorization: `Bearer ${connection.key}`,
					"Content-Type": "application/json",
					"X-DashScope-Async": "enable",
					"X-DashScope-OssResourceResolve": "enable",
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			}).pipe(Effect.flatMap(responseJson));
		});
	const upload = (
		ref: string,
		resource: MeetingResource,
		expiresInMs: number,
	) =>
		Effect.gen(function* () {
			const raw = yield* call(
				resource.config,
				`uploads?action=getPolicy&model=${FILETRANS_MODEL}`,
			);
			const policy = yield* Schema.decodeUnknown(Policy)(
				object(raw).data ?? raw,
			).pipe(
				Effect.mapError((cause) => meetingError("TranscriptionFailed", cause)),
			);
			const key =
				policy.object_key ?? `${policy.upload_dir}/${crypto.randomUUID()}.mp3`;
			if (!key || key.includes("..") || key.length > 2048)
				return yield* meetingError("TranscriptionFailed");
			yield* Effect.acquireUseRelease(
				resources.audio(ref),
				({ blob }) =>
					Effect.gen(function* () {
						const form = new FormData();
						for (const [name, value] of Object.entries({
							OSSAccessKeyId: policy.oss_access_key_id,
							Signature: policy.signature,
							policy: policy.policy,
							"x-oss-object-acl": "private",
							"x-oss-forbid-overwrite": "true",
							key,
							success_action_status: "200",
						}))
							form.append(name, value);
						form.append("file", blob, "meeting.mp3");
						const response = yield* meetingRequest(
							http,
							providerUrl(policy.upload_host),
							{ method: "POST", body: form },
						);
						if (!response.ok) return yield* meetingError("TranscriptionFailed");
						yield* Effect.promise(
							() => response.body?.cancel() ?? Promise.resolve(),
						);
					}),
				(audio) => audio.release,
			).pipe(
				Effect.catchTag("MeetingAudioMissing", (cause) =>
					Effect.fail(
						meetingError(
							resource.upload ? "AudioExpired" : "AudioMissing",
							cause,
						),
					),
				),
			);
			const next: MeetingResource = {
				...resource,
				task: undefined,
				upload: {
					url: `oss://${key}`,
					expiresAt: (yield* Clock.currentTimeMillis) + expiresInMs,
				},
			};
			yield* resources.save(ref, next);
			return next;
		});
	const submitTask = (ref: string, resource: MeetingResource) =>
		Effect.gen(function* () {
			const raw = yield* call(
				resource.config,
				"services/audio/asr/transcription",
				{
					model: FILETRANS_MODEL,
					input: { file_urls: [resource.upload?.url] },
					parameters: { channel_id: [0], diarization_enabled: true },
				},
			);
			const parsed = yield* Schema.decodeUnknown(Task)(raw).pipe(
				Effect.mapError((cause) => meetingError("TranscriptionFailed", cause)),
			);
			if (!safeId(parsed.output.task_id))
				return yield* meetingError("TranscriptionFailed");
			const next = { ...resource, task: parsed.output.task_id };
			yield* resources.save(ref, next);
			return next;
		});
	const submit = Effect.fn("DashscopeMeeting.submit")(function* (
		request: MeetingAsrRequest,
	) {
		if (
			request.config.asrModel !== FILETRANS_MODEL ||
			request.channelIds.length !== 1 ||
			request.channelIds[0] !== 0 ||
			!request.diarization
		)
			return yield* meetingError("Invalid");
		const previous = yield* resources.load(request.audioRef);
		if (
			previous?.remoteFiles.length &&
			previous.config.profileId !== request.config.profileId
		)
			return yield* meetingError("Invalid");
		let state: MeetingResource =
			previous &&
			previous.config.profileId === request.config.profileId &&
			previous.config.asrModel === request.config.asrModel
				? previous
				: {
						version: 1,
						config: request.config,
						remoteFiles: [],
						cleanupPending: false,
					};
		if (state.segments?.length || state.task) return request.audioRef;
		if (
			!state.upload ||
			state.upload.expiresAt <= (yield* Clock.currentTimeMillis)
		)
			state = yield* upload(request.audioRef, state, request.expiresInMs);
		yield* submitTask(request.audioRef, state);
		return request.audioRef;
	});
	const poll = Effect.fn("DashscopeMeeting.poll")(function* (
		ref: string,
	): Effect.fn.Return<
		MeetingAsrResult,
		import("../../meetings/meeting-errors.js").MeetingError
	> {
		const state = yield* resources.load(ref);
		if (!state) return yield* meetingError("Invalid");
		if (state.segments) return { status: "complete", segments: state.segments };
		if (!safeId(state.task)) return yield* meetingError("Invalid");
		const raw = yield* call(state.config, `tasks/${state.task}`);
		const task = yield* Schema.decodeUnknown(Task)(raw).pipe(
			Effect.mapError((cause) => meetingError("TranscriptionFailed", cause)),
		);
		if (task.output.task_id !== state.task)
			return yield* meetingError("TranscriptionFailed");
		if (["PENDING", "RUNNING"].includes(task.output.task_status))
			return { status: "pending" };
		if (task.output.task_status !== "SUCCEEDED") {
			if (
				task.output.code === "InternalError" &&
				(state.internalRetries ?? 0) < 3
			) {
				const next = {
					...state,
					internalRetries: (state.internalRetries ?? 0) + 1,
				};
				yield* resources.save(ref, next);
				yield* Effect.sleep(2000 * next.internalRetries);
				yield* submitTask(ref, next);
				return { status: "pending" };
			}
			if (task.output.code === "FILE_DOWNLOAD_FAILED") {
				// Leave retry explicit and durable. A rejected upload is never reused.
				yield* resources.save(ref, {
					...state,
					task: undefined,
					upload: state.upload ? { ...state.upload, expiresAt: 0 } : undefined,
				});
			} else yield* resources.save(ref, { ...state, task: undefined });
			return yield* meetingError("TranscriptionFailed");
		}
		const bodies: unknown[] = [];
		const segments: (typeof Segment.Type)[] = [];
		for (const item of task.output.results ?? []) {
			const entry = object(item);
			if (
				entry.subtask_status !== "SUCCEEDED" ||
				typeof entry.transcription_url !== "string"
			)
				return yield* meetingError("TranscriptionFailed");
			const body = yield* meetingRequest(
				http,
				providerUrl(entry.transcription_url),
			).pipe(Effect.flatMap(responseJson));
			bodies.push(body);
			const transcripts = object(body).transcripts;
			if (!Array.isArray(transcripts))
				return yield* meetingError("TranscriptionFailed");
			for (const track of transcripts) {
				const sentences = object(track).sentences;
				if (!Array.isArray(sentences))
					return yield* meetingError("TranscriptionFailed");
				for (const sentence of sentences) {
					const s = object(sentence);
					const segment = yield* Schema.decodeUnknown(Segment)({
						id: `${segments.length}`,
						speaker: String(s.speaker_id ?? ""),
						startMs: s.begin_time,
						endMs: s.end_time,
						text: s.text,
					}).pipe(
						Effect.mapError((cause) =>
							meetingError("TranscriptionFailed", cause),
						),
					);
					segments.push(segment);
					if (segments.length > 20000)
						return yield* meetingError("TranscriptionFailed");
				}
			}
		}
		if (!segments.some((s) => s.text.trim())) {
			yield* resources.save(ref, { ...state, task: undefined });
			return yield* meetingError("NoValidSpeech");
		}
		segments.sort((a, b) => a.startMs - b.startMs);
		yield* resources.artifacts(ref, bodies, segments);
		yield* resources.save(ref, { ...state, segments });
		return { status: "complete", segments };
	});
	const cancel = Effect.fn("DashscopeMeeting.cancel")((ref: string) =>
		Effect.gen(function* () {
			const state = yield* resources.load(ref);
			if (!state?.task || state.segments) return;
			yield* call(
				state.config,
				`tasks/${encodeURIComponent(state.task)}/cancel`,
				{},
			);
			yield* resources.save(ref, { ...state, task: undefined });
		}).pipe(
			Effect.catchAll((error) =>
				Effect.logWarning("Meeting task cancellation needs retry", error),
			),
		),
	);
	return { submit, poll, cancel, call };
}
