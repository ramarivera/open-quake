import { Context, Effect, Layer } from "effect";
import type { MediaCommand } from "../../../../../packages/device/src/actions/action-contracts";
import { canControlMedia } from "../../shared/media-invariants";
import type {
	MediaFailure,
	MediaIntent,
	MediaSnapshot,
} from "../../shared/weather-media-contracts";

export type NativeMediaState = Omit<MediaSnapshot, "revision">;
export type NativeMediaAction =
	| "play"
	| "pause"
	| "previous"
	| "next"
	| "stop"
	| "rewind"
	| "forward"
	| "repeat"
	| "shuffle";
/** Native IO boundary. No renderer or controller reaches the OS directly. */
export class SystemMediaAdapter extends Context.Tag("SystemMediaAdapter")<
	SystemMediaAdapter,
	{
		readonly read: () => Effect.Effect<NativeMediaState>;
		readonly control: (action: NativeMediaAction) => Effect.Effect<boolean>;
	}
>() {}

/** Side-effect-free unavailable adapter for mock and unsupported platforms. */
export const systemMediaStub = (
	platform: string,
): Layer.Layer<SystemMediaAdapter> => {
	const error: MediaFailure =
		platform === "darwin"
			? "MEDIAREMOTE_UNAVAILABLE"
			: platform === "win32"
				? "SMTC_UNAVAILABLE"
				: "UNSUPPORTED_PLATFORM";
	return Layer.succeed(SystemMediaAdapter, {
		read: () => Effect.succeed({ session: null, error }),
		control: () => Effect.succeed(false),
	});
};

export class SystemMediaService extends Effect.Service<SystemMediaService>()(
	"SystemMediaService",
	{
		accessors: true,
		effect: Effect.gen(function* () {
			const adapter = yield* SystemMediaAdapter;
			const lock = yield* Effect.makeSemaphore(1);
			let snapshot: MediaSnapshot = { revision: 0, session: null, error: null };
			const update = Effect.fn("SystemMediaService.update")(function* () {
				const state = yield* adapter.read();
				snapshot = { ...state, revision: snapshot.revision + 1 };
				return snapshot;
			});
			const read = Effect.fn("SystemMediaService.read")(
				(): Effect.Effect<MediaSnapshot> => lock.withPermits(1)(update()),
			);
			const control = Effect.fn("SystemMediaService.control")(
				(
					intent: MediaIntent,
				): Effect.Effect<{ accepted: boolean; media: MediaSnapshot }> =>
					lock.withPermits(1)(
						Effect.gen(function* () {
							const current = yield* update();
							const session = current.session;
							const allowed = canControlMedia(current, intent);
							const action =
								intent === "toggle"
									? session?.playing
										? "pause"
										: "play"
									: intent;
							const accepted = allowed ? yield* adapter.control(action) : false;
							// Re-pull even on rejection. Never let optimistic renderer state become truth.
							return { accepted, media: yield* update() };
						}),
					),
			);
			const send = Effect.fn("SystemMediaService.send")(
				(
					command: MediaCommand,
				): Effect.Effect<{ accepted: boolean; media: MediaSnapshot }> => {
					if (command === "audio_play") return control("toggle");
					if (command === "audio_prev") return control("previous");
					if (command === "audio_next") return control("next");
					const action = {
						audio_stop: "stop",
						audio_rewind: "rewind",
						audio_forward: "forward",
						audio_repeat: "repeat",
						audio_random: "shuffle",
					} as const;
					return lock.withPermits(1)(
						Effect.gen(function* () {
							const current = yield* update();
							const accepted =
								current.session && !current.error
									? yield* adapter.control(action[command])
									: false;
							return { accepted, media: yield* update() };
						}),
					);
				},
			);
			return { read, control, send };
		}),
	},
) {}
