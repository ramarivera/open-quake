import { Context, Effect, Layer } from "effect";
import { canControlMedia } from "../../shared/media-invariants";
import type {
	MediaFailure,
	MediaIntent,
	MediaSnapshot,
} from "../../shared/weather-media-contracts";

export type NativeMediaState = Omit<MediaSnapshot, "revision">;
export type NativeMediaAction = "play" | "pause" | "previous" | "next";
/** Native IO boundary. No renderer or controller reaches the OS directly. */
export class SystemMediaAdapter extends Context.Tag("SystemMediaAdapter")<
	SystemMediaAdapter,
	{
		readonly read: () => Effect.Effect<NativeMediaState>;
		readonly control: (action: NativeMediaAction) => Effect.Effect<boolean>;
	}
>() {}

/** Explicit platform stubs, pending native helper approval. Never launches a process. */
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
			return { read, control };
		}),
	},
) {}
