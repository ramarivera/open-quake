import { Effect } from "effect";
import { meetingError } from "../../meetings/meeting-errors.js";
import { meetingRequest, providerUrl, responseJson } from "./meeting-http.js";
import type {
	MeetingResources,
	ResolveMeetingConnection,
} from "./meeting-resources.js";
import type { SpeechHttp } from "./speech-ports.js";
import { object } from "./speech-session.js";

/** Only files recorded by this meeting can be listed or deleted. No account-wide cleanup. */
export function meetingFileHygiene(
	http: typeof SpeechHttp.Service,
	resources: MeetingResources,
	resolve: ResolveMeetingConnection,
) {
	const list = (ref: string) =>
		Effect.gen(function* () {
			const state = yield* resources.load(ref);
			if (!state || state.config.asrProvider === "openai") return [];
			const c = yield* resolve(state.config);
			const raw = yield* meetingRequest(
				http,
				providerUrl("files", c.files ?? c.api),
				{
					headers: { Authorization: `Bearer ${c.key}` },
				},
			).pipe(Effect.flatMap(responseJson));
			const files = object(raw).data;
			if (!Array.isArray(files))
				return yield* meetingError("TranscriptionFailed");
			return files
				.map(object)
				.filter(
					(file) =>
						typeof file.id === "string" && state.remoteFiles.includes(file.id),
				);
		});
	const upload = (ref: string, text: string) =>
		Effect.gen(function* () {
			const state = yield* resources.load(ref);
			if (state?.config.asrProvider !== "dashscope" || text.length > 1_000_000)
				return yield* meetingError("Invalid");
			const c = yield* resolve(state.config);
			const form = new FormData();
			form.append("purpose", "file-extract");
			form.append(
				"file",
				new Blob([text], { type: "text/plain" }),
				"meeting-transcript.txt",
			);
			const raw = yield* meetingRequest(
				http,
				providerUrl("files", c.files ?? c.api),
				{
					method: "POST",
					headers: { Authorization: `Bearer ${c.key}` },
					body: form,
				},
			).pipe(Effect.flatMap(responseJson));
			const id = object(raw).id;
			if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(id))
				return yield* meetingError("TranscriptionFailed");
			yield* resources
				.save(ref, {
					...state,
					remoteFiles: [...state.remoteFiles, id],
					cleanupPending: true,
				})
				.pipe(
					Effect.onError(() =>
						meetingRequest(
							http,
							providerUrl(`files/${encodeURIComponent(id)}`, c.files ?? c.api),
							{
								method: "DELETE",
								headers: { Authorization: `Bearer ${c.key}` },
							},
						).pipe(
							Effect.flatMap((response) =>
								Effect.tryPromise({
									try: async () => {
										await response.body?.cancel();
										if (!response.ok && response.status !== 404)
											throw meetingError("TranscriptionFailed");
									},
									catch: (cause) => meetingError("TranscriptionFailed", cause),
								}),
							),
							Effect.catchAll((error) =>
								Effect.logWarning(
									"Meeting transcript rollback needs cleanup",
									error,
								),
							),
						),
					),
				);
			return id;
		}).pipe(Effect.uninterruptible);
	const remove = (ref: string, id: string) =>
		Effect.gen(function* () {
			const state = yield* resources.load(ref);
			if (!state?.remoteFiles.includes(id))
				return yield* meetingError("Invalid");
			const c = yield* resolve(state.config);
			yield* resources.save(ref, { ...state, cleanupPending: true });
			const response = yield* meetingRequest(
				http,
				providerUrl(`files/${encodeURIComponent(id)}`, c.files ?? c.api),
				{ method: "DELETE", headers: { Authorization: `Bearer ${c.key}` } },
			);
			if (!response.ok && response.status !== 404)
				return yield* meetingError("TranscriptionFailed");
			yield* Effect.promise(() => response.body?.cancel() ?? Promise.resolve());
			const remoteFiles = state.remoteFiles.filter((f) => f !== id);
			yield* resources.save(ref, {
				...state,
				remoteFiles,
				cleanupPending: remoteFiles.length > 0,
			});
		});
	const cleanup = (ref: string) =>
		Effect.gen(function* () {
			const state = yield* resources.load(ref);
			for (const id of state?.remoteFiles ?? []) yield* remove(ref, id);
		});
	return { list, upload, remove, cleanup };
}
