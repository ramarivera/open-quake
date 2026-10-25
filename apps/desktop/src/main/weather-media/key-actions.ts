import { Effect } from "effect";
import type { MediaActionAdapter } from "../../../../../packages/device/src/actions/action-adapters";
import type { MediaCommand } from "../../../../../packages/device/src/actions/action-contracts";
import { HostActionFailed } from "../../../../../packages/device/src/actions/action-errors";

/** Both cards and action keys call the single main-owned system-media runtime. */
export function systemMediaKeyActions(
	send: (
		command: MediaCommand,
		signal: AbortSignal,
	) => Promise<{ accepted: boolean }>,
): MediaActionAdapter {
	return {
		supportedCommands: new Set([
			"audio_play",
			"audio_stop",
			"audio_prev",
			"audio_next",
			"audio_rewind",
			"audio_forward",
			"audio_repeat",
			"audio_random",
		]),
		sendMedia: Effect.fn("SystemMedia.keyAction")(function* (command) {
			const result = yield* Effect.tryPromise({
				try: (signal) => send(command, signal),
				catch: (cause) => new HostActionFailed(cause),
			});
			if (!result.accepted)
				return yield* new HostActionFailed("system-media-control-rejected");
		}),
	};
}
