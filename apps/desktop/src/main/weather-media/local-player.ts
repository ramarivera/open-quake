import { Context, Effect, Layer } from "effect";
import { SoundboardConfigInvalid } from "../../../../../packages/edge/src/soundboard/soundboard-errors";
import type {
	LocalPlayerSnapshot,
	LocalPlayerTarget,
} from "../../shared/weather-media-contracts";

/** Composition supplies the existing SoundboardService, never a second playback stack. */
export class LocalPlayerPort extends Context.Tag("LocalPlayerPort")<
	LocalPlayerPort,
	{
		readonly read: (
			target: LocalPlayerTarget,
		) => Effect.Effect<LocalPlayerSnapshot>;
	}
>() {}
export const noLocalPlayer = Layer.succeed(LocalPlayerPort, {
	read: () =>
		Effect.succeed({
			revision: 0,
			state: "unconfigured",
			title: "",
			trackIndex: 0,
			total: 0,
			positionMs: 0,
			errorCode: null,
		}),
});

export function committedLocalPlayer(
	load: (
		signal: AbortSignal,
	) => Promise<
		import("../../../../../packages/device/src/profiles/profile-contracts").ProfileEnvelope
	>,
	read: (
		key: import("../../../../../packages/device/src/profiles/profile-contracts").ProfileKey,
		target: LocalPlayerTarget,
	) => Promise<LocalPlayerSnapshot>,
): typeof LocalPlayerPort.Service {
	let revision = 0;
	const empty = {
		state: "unconfigured" as const,
		title: "",
		trackIndex: 0,
		total: 0,
		positionMs: 0,
		errorCode: null,
	};
	return {
		read: Effect.fn("LocalPlayer.read")(
			(target: LocalPlayerTarget): Effect.Effect<LocalPlayerSnapshot> =>
				Effect.tryPromise({
					try: async (signal) => {
						const envelope = await load(signal),
							selected = envelope.activeByDevice[target.deviceId];
						const profile = envelope.profiles.find(
							(p) => p.id === target.profileId,
						);
						const key = profile?.pages
							.find((p) => p.id === target.pageId)
							?.keys.find(
								(k) => k.keyCode === target.keyCode && k.config.display,
							);
						if (
							!key ||
							selected?.profileId !== target.profileId ||
							selected.pageId !== target.pageId ||
							profile?.revision !== target.revision ||
							!["playAudio", "playAudioLegacy"].includes(key.config.type)
						)
							return empty;
						return read(key, target);
					},
					catch: (cause) => new SoundboardConfigInvalid(cause),
				}).pipe(
					Effect.catchTag("SoundboardConfigInvalid", (error) =>
						Effect.logWarning(error).pipe(
							Effect.as({
								...empty,
								state: "failed" as const,
								errorCode: error.code,
							}),
						),
					),
					Effect.map((snapshot) => ({ ...snapshot, revision: ++revision })),
				),
		),
	};
}
