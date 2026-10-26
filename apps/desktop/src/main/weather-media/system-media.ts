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
		readonly read: (target?: string | null) => Effect.Effect<NativeMediaState>;
		readonly launch?: (
			id: "apple" | "spotify" | "qq" | "netease",
		) => Effect.Effect<boolean>;
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
			let target: string | null = null;
			let snapshot: MediaSnapshot = { revision: 0, session: null, error: null };
			const update = Effect.fn("SystemMediaService.update")(function* () {
				const state = yield* adapter.read(target);
				const sessions =
					state.sessions ?? (state.session ? [state.session] : []);
				const session =
					target && state.session?.id !== target ? null : state.session;
				snapshot = {
					...state,
					session,
					sessions,
					target,
					lyrics: state.lyrics ?? { _tag: "unavailable" },
					error:
						target && !session && !state.error ? "SESSION_LOST" : state.error,
					revision: snapshot.revision + 1,
				};
				return snapshot;
			});
			const read = Effect.fn("SystemMediaService.read")(
				(selected?: string | null): Effect.Effect<MediaSnapshot> =>
					lock.withPermits(1)(
						Effect.suspend(() => {
							if (selected !== undefined) target = selected;
							return update();
						}),
					),
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
					if (
						command === "audio_mute" ||
						command === "audio_vol_down" ||
						command === "audio_vol_up"
					)
						return Effect.map(read(), (media) => ({ accepted: false, media }));
					if (command === "audio_prev") return control("previous");
					if (command === "audio_next") return control("next");
					const action = {
						audio_pause: "pause",
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
								current.session &&
								!current.error &&
								(command !== "audio_pause" || current.session.canPause)
									? yield* adapter.control(action[command])
									: false;
							return { accepted, media: yield* update() };
						}),
					);
				},
			);
			const launch = Effect.fn("SystemMediaService.launch")(
				(id: "apple" | "spotify" | "qq" | "netease") =>
					adapter.launch?.(id) ?? Effect.succeed(false),
			);
			return { read, control, send, launch };
		}),
	},
) {}
