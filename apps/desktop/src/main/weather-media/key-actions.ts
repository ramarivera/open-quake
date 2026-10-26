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
	observe?: MediaActionAdapter["observe"],
): MediaActionAdapter {
	return {
		...(observe ? { observe } : {}),
		supportedCommands: new Set([
			"audio_play",
			"audio_pause",
			"audio_mute",
			"audio_vol_down",
			"audio_vol_up",
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

/** The saved empty preset is system-owned; explicit local never falls through. */
export function isSystemPlayerKey(
	key: import("../../../../../packages/device/src/profiles/profile-contracts").ProfileKey,
): boolean {
	if (key.config.type !== "playAudio" && key.config.type !== "playAudioLegacy")
		return false;
	const source = key.config.actions.find(
		(a) => a.type === "musicSource",
	)?.value;
	if (source) return source === "system";
	if (key.config.type === "playAudioLegacy") return false;
	const sounds = key.config.actions.filter((a) => a.type === "sound");
	const actions = key.config.actions.filter((a) => a.type === "audioAction");
	return (
		sounds.length === 1 &&
		sounds[0]?.value === "" &&
		actions.length === 1 &&
		actions[0]?.value === 0
	);
}
