import { createHash } from "node:crypto";
import { Effect } from "effect";
import type { KeyActivation } from "../../../../../packages/device/src/actions/key-runtime-service";
import type { ProfileKey } from "../../../../../packages/device/src/profiles/profile-contracts";
import { SoundboardConfigInvalid } from "../../../../../packages/edge/src/soundboard/soundboard-errors";
import { importSoundConfig } from "../../../../../packages/edge/src/soundboard/soundboard-invariants";
import type { makeSoundboardService } from "../../../../../packages/edge/src/soundboard/soundboard-service";

/** The committed-key boundary. Playback, fades, looping and output stay in their existing owner. */
export function soundboardKeyActions(
	service: Effect.Effect.Success<typeof makeSoundboardService>,
) {
	const owners = new Map<string, { deviceId: string; profileId: string }>();
	const execute = Effect.fn("SoundboardKeys.execute")(function* (
		key: ProfileKey,
		activation: KeyActivation,
	) {
		if (key.config.type === "stopAudio") {
			yield* service.stopAll();
			return true;
		}
		if (
			key.config.type !== "playAudio" &&
			key.config.type !== "playAudioLegacy"
		)
			return false;
		const sounds = key.config.actions.filter(
			(action) => action.type === "sound",
		);
		const actions = key.config.actions.filter(
			(action) => action.type === "audioAction",
		);
		// Keep the native system-media preset with its owner.
		if (
			key.config.type === "playAudio" &&
			sounds.length === 1 &&
			sounds[0]?.value === "" &&
			actions.length === 1 &&
			actions[0]?.value === 0
		)
			return false;
		const parsed = yield* importSoundConfig({
			type: key.config.type,
			actions: key.config.actions,
		});
		if (
			!parsed.operation ||
			!parsed.fade ||
			parsed.volume === undefined ||
			parsed.issues.some((issue) => issue !== "unverifiedFiles")
		)
			return yield* new SoundboardConfigInvalid();
		if (parsed.operation === "STOP_ALL") {
			yield* service.stopAll(parsed.fade);
			return true;
		}
		const profileId = createHash("sha256")
			.update(JSON.stringify([activation.deviceId, activation.profileId]))
			.digest("hex");
		owners.set(profileId, {
			deviceId: activation.deviceId,
			profileId: activation.profileId,
		});
		yield* service.execute(
			{
				profileId,
				keyCode: createHash("sha256")
					.update(JSON.stringify([activation.pageId, key.keyCode]))
					.digest("hex"),
			},
			{
				revision: activation.revision,
				entries: parsed.entries,
				volume: parsed.volume,
				fade: parsed.fade,
			},
			parsed.operation,
		);
		return true;
	});
	const reset = Effect.fn("SoundboardKeys.reset")(function* (
		deviceId?: string,
	) {
		for (const [owner, identity] of owners)
			if (!deviceId || deviceId === identity.deviceId) {
				yield* service.stopProfile(owner);
				owners.delete(owner);
			}
	});
	return { execute, reset, snapshot: service.snapshot };
}
