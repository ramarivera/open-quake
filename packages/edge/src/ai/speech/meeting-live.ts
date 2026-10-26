import { Effect } from "effect";
import { meetingError } from "../../meetings/meeting-errors.js";
import type { MeetingAdapter } from "../meeting-adapter.js";
import { dashscopeFiletrans } from "./dashscope-filetrans.js";
import { meetingFileHygiene } from "./meeting-file-hygiene.js";
import { openaiMeeting } from "./meeting-openai.js";
import { makeMeetingTranslation } from "./meeting-realtime.js";
import type {
	MeetingResources,
	ResolveMeetingConnection,
} from "./meeting-resources.js";
import type { SpeechHttp, SpeechWebSocket } from "./speech-ports.js";
export const makeLiveMeetingAdapter = Effect.fn("AiMeetingAdapter.live")(
	function* (options: {
		http: typeof SpeechHttp.Service;
		socket: typeof SpeechWebSocket.Service;
		resources: MeetingResources;
		resolve: ResolveMeetingConnection;
	}) {
		const dashscope = dashscopeFiletrans(options);
		const openai = openaiMeeting(
			options.socket,
			options.resources,
			options.resolve,
		);
		const translation = yield* makeMeetingTranslation(
			options.socket,
			options.resolve,
		);
		const files = meetingFileHygiene(
			options.http,
			options.resources,
			options.resolve,
		);
		const adapter: MeetingAdapter = {
			prepare: (config) => options.resolve(config).pipe(Effect.asVoid),
			files,
			cleanup: (ref) =>
				Effect.gen(function* () {
					const state = yield* options.resources.load(ref);
					if (
						state?.task &&
						!state.segments &&
						state.config.asrProvider === "dashscope"
					) {
						yield* dashscope
							.call(
								state.config,
								`tasks/${encodeURIComponent(state.task)}/cancel`,
								{},
							)
							.pipe(
								Effect.catchAll((error) =>
									Effect.logWarning("Meeting task cancellation skipped", error),
								),
							);
						yield* options.resources.save(ref, { ...state, task: undefined });
					}
					yield* files.cleanup(ref);
				}),
			...translation,
			submit: (request) =>
				Effect.gen(function* () {
					if (request.config.asrProvider === "dashscope")
						return yield* dashscope.submit(request);
					if (request.config.asrProvider !== "openai")
						return yield* meetingError("Unavailable");
					const state = yield* options.resources.load(request.audioRef);
					if (state?.remoteFiles.length) return yield* meetingError("Invalid");
					const segments = yield* openai(request);
					yield* options.resources.save(request.audioRef, {
						version: 1,
						config: request.config,
						segments,
						remoteFiles: [],
						cleanupPending: false,
					});
					return request.audioRef;
				}),
			poll: dashscope.poll,
			cancel: dashscope.cancel,
		};
		return adapter;
	},
);
