import { Effect, Option } from "effect";
import { AudioOutputBusy, AudioOutputFailed } from "../audio/output-errors.js";
import {
	type SoundOwner,
	type SoundPlaylist,
	type SoundSession,
	soundOwnerKey,
} from "./playback-contracts.js";
import type {
	PlaybackSlot,
	SoundPlaybackError,
	StartSound,
} from "./playback-state.js";
import { SoundboardFileUnavailable } from "./soundboard-errors.js";
import type { SoundboardFiles } from "./soundboard-ports.js";

/** Selection and explicit-list metadata policy. Never decodes or acquires output. */
export const makePlaybackSelection = (ports: {
	readonly slots: Map<string, PlaybackSlot>;
	readonly remembered: Map<string, { revision: number; index: number }>;
	readonly current: (slot: PlaybackSlot) => boolean;
	readonly closed: () => boolean;
	readonly epoch: () => number;
	readonly files: typeof SoundboardFiles.Service;
	readonly start: StartSound;
}) => {
	const index = (owner: SoundOwner, config: SoundPlaylist) => {
		const key = soundOwnerKey(owner);
		const active = [...ports.slots.values()]
			.reverse()
			.find(
				(slot) =>
					ports.current(slot) && soundOwnerKey(slot.session.owner) === key,
			);
		const previous = active
			? { revision: active.playlist.revision, index: active.session.trackIndex }
			: ports.remembered.get(key);
		return previous?.revision === config.revision
			? Math.min(previous.index, config.entries.length - 1)
			: 0;
	};
	const inspect = (path: string) =>
		ports.files.inspect(path).pipe(
			Effect.timeoutFail({
				duration: "2 seconds",
				onTimeout: () => new SoundboardFileUnavailable(),
			}),
		);
	const inspectAvailable = (path: string) =>
		inspect(path).pipe(
			Effect.tapError((error) =>
				Effect.logWarning("soundboard.file.inspection.failed", error),
			),
			Effect.catchTag("SoundboardFileUnavailable", () =>
				Effect.succeed("unreadable" as const),
			),
		);
	const validateIndex = (
		config: SoundPlaylist,
		selected: number,
	): Effect.Effect<void, SoundPlaybackError> =>
		Effect.gen(function* () {
			if (ports.closed()) return yield* new AudioOutputFailed();
			const entry = config.entries[selected];
			if (!entry || (yield* inspect(entry.path)) !== "available")
				return yield* new SoundboardFileUnavailable();
		});
	const validate = (owner: SoundOwner, config: SoundPlaylist) =>
		validateIndex(config, index(owner, config));
	const navigate = (
		owner: SoundOwner,
		config: SoundPlaylist,
		direction: 1 | -1,
		accept: () => boolean,
	): Effect.Effect<Option.Option<SoundSession>, SoundPlaybackError> =>
		Effect.gen(function* () {
			const epoch = ports.epoch();
			let selected = index(owner, config);
			const entries = config.entries.map((entry) => ({ ...entry }));
			for (let visited = 0; visited < entries.length; visited++) {
				if (ports.closed() || epoch !== ports.epoch() || !accept())
					return yield* new AudioOutputBusy();
				selected = (selected + direction + entries.length) % entries.length;
				const entry = entries[selected];
				if (!entry) continue;
				const status = yield* inspectAvailable(entry.path);
				entries[selected] = { ...entry, status };
				if (status === "available") {
					const session = yield* ports.start(
						owner,
						{ ...config, entries },
						{
							expectedEpoch: epoch,
							initialIndex: selected,
							accept,
							initialGain:
								config.fade.mode === "in" || config.fade.mode === "toggle"
									? 0
									: undefined,
						},
					);
					return Option.some(session);
				}
			}
			return Option.none();
		});
	return { index, inspectAvailable, validateIndex, validate, navigate };
};
