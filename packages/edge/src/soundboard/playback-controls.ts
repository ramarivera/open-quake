import { Effect, Either, Fiber, Option, Schema } from "effect";
import { AudioOutputBusy } from "../audio/output-errors.js";
import {
	SoundOwner as OwnerSchema,
	SoundPlaylist as PlaylistSchema,
	type SoundOwner,
	type SoundPlaylist,
	type SoundSession,
	soundOwnerKey,
} from "./playback-contracts.js";
import type { SoundPlayer } from "./playback-ports.js";
import type {
	PlaybackSlot,
	SoundPlaybackError,
	StartSound,
} from "./playback-state.js";
import {
	type SoundEntry,
	SoundFade,
	SoundOperation,
	SoundVolume,
} from "./soundboard-contracts.js";
import {
	SoundboardConfigInvalid,
	SoundboardDecodeFailed,
} from "./soundboard-errors.js";
import { copySoundSession } from "./soundboard-repository.js";

export const makePlaybackControls = (ports: {
	readonly slots: Map<string, PlaybackSlot>;
	readonly stopping: Map<string, PlaybackSlot>;
	readonly epoch: () => number;
	readonly invalidatePending: () => void;
	readonly current: (slot: PlaybackSlot) => boolean;
	readonly locked: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>;
	readonly publish: (slot: PlaybackSlot) => Effect.Effect<void>;
	readonly inspect: (
		slot: PlaybackSlot,
		index: number,
	) => Effect.Effect<boolean>;
	readonly inspectAvailable: (
		path: string,
	) => Effect.Effect<SoundEntry["status"]>;
	readonly startTrack: (
		slot: PlaybackSlot,
		index: number,
		gain?: number,
	) => Effect.Effect<void, SoundPlaybackError>;
	readonly start: StartSound;
	readonly stopNow: (id: string) => Effect.Effect<void>;
	readonly drain: () => Effect.Effect<void>;
	readonly navigateStopped: (
		owner: SoundOwner,
		playlist: SoundPlaylist,
		direction: 1 | -1,
		accept: () => boolean,
	) => Effect.Effect<Option.Option<SoundSession>, SoundPlaybackError>;
	readonly failed: (
		slot: PlaybackSlot,
		error: SoundPlaybackError,
	) => Effect.Effect<void>;
	readonly stopUnavailable: (slot: PlaybackSlot) => Effect.Effect<void>;
	readonly finishPendingEnd: (
		slot: PlaybackSlot,
	) => Effect.Effect<void, SoundPlaybackError>;
	readonly validatePlay: (
		owner: SoundOwner,
		config: SoundPlaylist,
	) => Effect.Effect<void, SoundPlaybackError>;
}) => {
	const requests = new Set<{
		key: string;
		profileId: string;
		valid: boolean;
	}>();
	const invalidateOwner = (owner: SoundOwner) => {
		for (const request of requests)
			if (request.key === soundOwnerKey(owner)) request.valid = false;
	};
	const cancel = (slot: PlaybackSlot) =>
		Effect.gen(function* () {
			const command = ++slot.command;
			slot.stopAfterRamp = Option.none();
			slot.navigation = Option.none();
			slot.replacement = Option.none();
			if (Option.isSome(slot.gain)) yield* slot.gain.value.cancel;
			return command;
		});
	const ramp = (slot: PlaybackSlot, target: number, duration: number) =>
		Option.isSome(slot.gain)
			? slot.gain.value
					.to(target, duration)
					.pipe(Effect.tapError((error) => ports.failed(slot, error)))
			: Effect.succeed(false);
	const lookup = (id: string) => ports.slots.get(id);
	const own = (owner: SoundOwner) =>
		[...ports.slots.values()].filter(
			(slot) =>
				ports.current(slot) &&
				soundOwnerKey(slot.session.owner) === soundOwnerKey(owner),
		);
	const native = <A>(
		slot: PlaybackSlot,
		run: (player: SoundPlayer) => Effect.Effect<A, SoundPlaybackError>,
	): Effect.Effect<A, SoundPlaybackError> =>
		Effect.gen(function* () {
			if (
				!ports.current(slot) ||
				Option.isNone(slot.player) ||
				Option.isNone(slot.track)
			)
				return yield* new AudioOutputBusy();
			const result = yield* run(slot.player.value).pipe(
				Effect.timeoutFail({
					duration: "2 seconds",
					onTimeout: () => new SoundboardDecodeFailed(),
				}),
				Effect.forkIn(slot.track.value.scope),
				Effect.flatMap(Fiber.join),
			);
			if (!ports.current(slot)) return yield* new AudioOutputBusy();
			return result;
		}).pipe(
			Effect.tapError((error) => ports.failed(slot, error)),
			Effect.onInterrupt(() => ports.stopUnavailable(slot)),
		);
	const control = (
		id: string,
		run: (slot: PlaybackSlot) => Effect.Effect<void, SoundPlaybackError>,
	) =>
		Effect.gen(function* () {
			const slot = lookup(id);
			if (!slot) return;
			invalidateOwner(slot.session.owner);
			const command = yield* cancel(slot);
			yield* ports.locked(
				Effect.suspend(() =>
					ports.current(slot) && slot.command === command
						? run(slot)
						: Effect.void,
				),
			);
		});
	const pause = Effect.fn("SoundboardService.pause")(
		(id: string): Effect.Effect<void, SoundPlaybackError> =>
			control(id, (slot) =>
				Effect.gen(function* () {
					if (slot.session.state !== "playing") return;
					const positionMs = yield* native(slot, (player) =>
						player.pause.pipe(Effect.zipRight(player.position)),
					);
					slot.session = { ...slot.session, state: "paused", positionMs };
					yield* ports.publish(slot);
				}),
			),
	);
	const resume = Effect.fn("SoundboardService.resume")(
		(id: string): Effect.Effect<void, SoundPlaybackError> =>
			control(id, (slot) =>
				Effect.gen(function* () {
					if (slot.session.state !== "paused") return;
					yield* native(slot, (player) => player.play);
					slot.session = { ...slot.session, state: "playing" };
					yield* ports.publish(slot);
				}),
			).pipe(
				Effect.zipRight(
					Effect.suspend(() => {
						const slot = lookup(id);
						return slot && ports.current(slot) && slot.endPending
							? ports.finishPendingEnd(slot)
							: Effect.void;
					}),
				),
			),
	);
	const navigate = (
		id: string,
		direction: 1 | -1,
		fade?: SoundFade,
	): Effect.Effect<void, SoundPlaybackError> =>
		Effect.gen(function* () {
			const slot = lookup(id);
			if (!slot) return;
			const parsed = Schema.decodeUnknownEither(SoundFade)(
				fade ?? slot.playlist.fade,
			);
			if (Either.isLeft(parsed))
				return yield* new SoundboardConfigInvalid(parsed.left);
			const selected = { ...parsed.right };
			invalidateOwner(slot.session.owner);
			const command = yield* cancel(slot);
			const wasPlaying = slot.session.state === "playing";
			slot.navigation = Option.some(command);
			yield* Effect.gen(function* () {
				if (
					wasPlaying &&
					(selected.mode === "out" || selected.mode === "toggle")
				) {
					if (!(yield* ramp(slot, 0, selected.durationMs))) return;
				}
				const fadeIn =
					selected.mode === "in" || (selected.mode === "toggle" && !wasPlaying);
				let started = false;
				yield* ports.locked(
					Effect.gen(function* () {
						if (!ports.current(slot) || command !== slot.command) return;
						let index = slot.session.trackIndex;
						for (
							let visited = 0;
							visited < slot.playlist.entries.length;
							visited++
						) {
							if (!ports.current(slot) || command !== slot.command) return;
							index =
								(index + direction + slot.playlist.entries.length) %
								slot.playlist.entries.length;
							if (yield* ports.inspect(slot, index)) {
								if (!ports.current(slot) || command !== slot.command) return;
								yield* ports
									.startTrack(slot, index, fadeIn ? 0 : undefined)
									.pipe(Effect.tapError((error) => ports.failed(slot, error)));
								started = true;
								return;
							}
						}
						yield* ports.stopUnavailable(slot);
					}),
				);
				if (started && command === slot.command && fadeIn)
					yield* ramp(slot, slot.targetGain, selected.durationMs);
			}).pipe(
				Effect.onInterrupt(() =>
					slot.command === command ? ports.stopUnavailable(slot) : Effect.void,
				),
				Effect.ensuring(
					Effect.sync(() => {
						if (
							Option.isSome(slot.navigation) &&
							slot.navigation.value === command
						)
							slot.navigation = Option.none();
					}),
				),
			);
			if (ports.current(slot) && slot.endPending)
				yield* ports.finishPendingEnd(slot);
		});
	const previous = Effect.fn("SoundboardService.previous")(
		(id: string): Effect.Effect<void, SoundPlaybackError> => navigate(id, -1),
	);
	const next = Effect.fn("SoundboardService.next")(
		(id: string): Effect.Effect<void, SoundPlaybackError> => navigate(id, 1),
	);
	const rescan = Effect.fn("SoundboardService.rescan")(
		(id: string): Effect.Effect<void> =>
			Effect.gen(function* () {
				const slot = lookup(id);
				if (!slot || !ports.current(slot)) return;
				const generation = slot.session.generation;
				const scan = ++slot.scan;
				const statuses = yield* Effect.forEach(
					slot.playlist.entries,
					(entry) =>
						Effect.suspend(() =>
							ports.current(slot) &&
							slot.scan === scan &&
							slot.session.generation === generation
								? ports.inspectAvailable(entry.path)
								: Effect.succeed(entry.status),
						),
					{ concurrency: 4 },
				);
				yield* ports.locked(
					Effect.gen(function* () {
						if (
							!ports.current(slot) ||
							slot.session.generation !== generation ||
							slot.scan !== scan
						)
							return;
						slot.session = {
							...slot.session,
							entries: slot.session.entries.map((entry, index) => ({
								...entry,
								status: statuses[index] ?? entry.status,
							})),
						};
						yield* ports.publish(slot);
					}),
				);
			}),
	);
	const stop = Effect.fn("SoundboardService.stop")(
		(id: string, fade?: SoundFade): Effect.Effect<void, SoundPlaybackError> =>
			Effect.gen(function* () {
				const slot = lookup(id);
				if (!slot) return yield* ports.stopNow(id);
				const parsed = Schema.decodeUnknownEither(SoundFade)(
					fade ?? slot.playlist.fade,
				);
				if (Either.isLeft(parsed))
					return yield* new SoundboardConfigInvalid(parsed.left);
				invalidateOwner(slot.session.owner);
				const command = yield* cancel(slot);
				if (
					slot.session.state === "playing" &&
					(parsed.right.mode === "out" || parsed.right.mode === "toggle")
				) {
					slot.stopAfterRamp = Option.some(command);
					if (
						!(yield* ramp(slot, 0, parsed.right.durationMs).pipe(
							Effect.onInterrupt(() =>
								slot.command === command ? ports.stopNow(id) : Effect.void,
							),
						))
					)
						return;
				}
				if (slot.command === command) yield* ports.stopNow(id);
			}),
	);
	const setVolume = Effect.fn("SoundboardService.setVolume")(
		(
			id: string,
			volume: number,
			durationMs = 0,
		): Effect.Effect<void, SoundPlaybackError> =>
			Effect.gen(function* () {
				const parsed = Schema.decodeUnknownEither(
					Schema.Struct({
						volume: SoundVolume,
						durationMs: SoundFade.fields.durationMs,
					}),
				)({ volume, durationMs });
				if (Either.isLeft(parsed))
					return yield* new SoundboardConfigInvalid(parsed.left);
				const slot = lookup(id);
				if (!slot || !ports.current(slot)) return;
				invalidateOwner(slot.session.owner);
				const command = yield* cancel(slot);
				const accepted = yield* ports.locked(
					Effect.sync(() => {
						if (!ports.current(slot) || slot.command !== command) return false;
						slot.targetGain = volume / 100;
						return true;
					}),
				);
				if (accepted && slot.command === command) {
					yield* ramp(slot, slot.targetGain, durationMs);
					if (
						ports.current(slot) &&
						slot.command === command &&
						slot.endPending
					)
						yield* ports.finishPendingEnd(slot);
				}
			}),
	);
	const play = Effect.fn("SoundboardService.play")(
		(
			owner: SoundOwner,
			playlist: SoundPlaylist,
			additional = false,
			loop = false,
		): Effect.Effect<SoundSession, SoundPlaybackError> =>
			Effect.gen(function* () {
				const epoch = ports.epoch();
				const decoded = Schema.decodeUnknownEither(
					Schema.Struct({ owner: OwnerSchema, playlist: PlaylistSchema }),
				)({ owner, playlist });
				if (Either.isLeft(decoded))
					return yield* new SoundboardConfigInvalid(decoded.left);
				const owned = { ...decoded.right.owner };
				if (requests.size >= 128) return yield* new SoundboardConfigInvalid();
				if (!additional) invalidateOwner(owned);
				const request = {
					key: soundOwnerKey(owned),
					profileId: owned.profileId,
					valid: true,
				};
				requests.add(request);
				let started = Option.none<PlaybackSlot>();
				const commands: { slot: PlaybackSlot; command: number }[] = [];
				const stopOwned = () =>
					Effect.forEach(
						commands,
						({ slot, command }) =>
							slot.command === command && ports.current(slot)
								? ports.stopNow(slot.session.playbackId)
								: Effect.void,
						{ discard: true },
					);
				return yield* Effect.gen(function* () {
					const config: SoundPlaylist = {
						...decoded.right.playlist,
						entries: decoded.right.playlist.entries.map((entry) => ({
							...entry,
						})),
						fade: { ...decoded.right.playlist.fade },
					};
					const running = additional ? [] : own(owned);
					// Validation and file availability must precede stopping existing playback.
					// Explicit replacements are performed by start; ramps never own the global command lock.
					const outgoing =
						config.fade.mode === "out" || config.fade.mode === "toggle";
					if (running.length > 0) yield* ports.validatePlay(owned, config);
					if (!request.valid || epoch !== ports.epoch())
						return yield* new AudioOutputBusy();
					for (const slot of running) {
						const command = yield* cancel(slot);
						commands.push({ slot, command });
						slot.replacement = Option.some(command);
					}
					for (const { slot, command } of commands) {
						if (outgoing && slot.session.state === "playing") {
							if (
								!(yield* ramp(slot, 0, config.fade.durationMs)) ||
								command !== slot.command
							)
								return yield* new AudioOutputBusy();
						}
					}
					const fadeIn =
						config.fade.mode === "in" ||
						(config.fade.mode === "toggle" && running.length === 0);
					if (commands.some(({ slot, command }) => slot.command !== command))
						return yield* new AudioOutputBusy();
					const session = yield* ports.start(owned, config, {
						additional,
						loopTrack: loop,
						initialGain: fadeIn ? 0 : undefined,
						expectedEpoch: epoch,
						accept: () => request.valid,
					});
					const slot = lookup(session.playbackId);
					started = Option.fromNullable(slot);
					if (slot && request.valid && fadeIn)
						yield* ramp(slot, slot.targetGain, config.fade.durationMs);
					else if (
						slot &&
						request.valid &&
						config.fade.mode === "out" &&
						running.length === 0
					)
						yield* ramp(slot, 0, config.fade.durationMs);
					return slot ? copySoundSession(slot.session) : session;
				}).pipe(
					Effect.tapError(stopOwned),
					Effect.onInterrupt(() =>
						Effect.gen(function* () {
							if (Option.isSome(started) && request.valid)
								yield* ports.stopNow(started.value.session.playbackId);
							yield* stopOwned();
						}),
					),
					Effect.ensuring(
						Effect.sync(() => {
							requests.delete(request);
							for (const { slot, command } of commands)
								if (
									Option.isSome(slot.replacement) &&
									slot.replacement.value === command
								)
									slot.replacement = Option.none();
						}),
					),
				);
			}),
	);
	const stopAll = Effect.fn("SoundboardService.stopAll")(
		(fade?: SoundFade): Effect.Effect<void, SoundPlaybackError> =>
			Effect.gen(function* () {
				if (fade !== undefined) {
					const parsed = Schema.decodeUnknownEither(SoundFade)(fade);
					if (Either.isLeft(parsed))
						return yield* new SoundboardConfigInvalid(parsed.left);
				}
				ports.invalidatePending();
				yield* Effect.forEach(
					[...ports.slots.values(), ...ports.stopping.values()],
					(slot) => stop(slot.session.playbackId, fade),
					{ concurrency: "unbounded", discard: true },
				);
				yield* ports.drain();
			}),
	);
	const stopProfile = Effect.fn("SoundboardService.stopProfile")(
		(profileId: string): Effect.Effect<void> =>
			Effect.sync(() => {
				for (const request of requests)
					if (request.profileId === profileId) request.valid = false;
			}).pipe(
				Effect.zipRight(
					Effect.forEach(
						[...ports.slots.values(), ...ports.stopping.values()].filter(
							(slot) => slot.session.owner.profileId === profileId,
						),
						(slot) => ports.stopNow(slot.session.playbackId),
						{ concurrency: "unbounded", discard: true },
					),
				),
			),
	);
	const execute = Effect.fn("SoundboardService.execute")(
		(
			owner: SoundOwner,
			playlist: SoundPlaylist,
			operation: SoundOperation,
		): Effect.Effect<void, SoundPlaybackError> =>
			Effect.gen(function* () {
				const parsed = Schema.decodeUnknownEither(
					Schema.Struct({ owner: OwnerSchema, operation: SoundOperation }),
				)({ owner, operation });
				if (Either.isLeft(parsed))
					return yield* new SoundboardConfigInvalid(parsed.left);
				if (operation === "STOP_ALL") return yield* stopAll(playlist.fade);
				const config = Schema.decodeUnknownEither(PlaylistSchema)(playlist);
				if (Either.isLeft(config))
					return yield* new SoundboardConfigInvalid(config.left);
				const active = own(owner);
				const latest = active.at(-1);
				switch (operation) {
					case "PLAY_STOP":
					case "PLAY_LOOP":
						if (active.length > 0)
							return yield* Effect.forEach(
								active,
								(slot) => stop(slot.session.playbackId, playlist.fade),
								{ discard: true },
							);
						return yield* play(
							owner,
							playlist,
							false,
							operation === "PLAY_LOOP",
						).pipe(Effect.asVoid);
					case "PLAY_ADD":
						return yield* play(owner, playlist, true).pipe(Effect.asVoid);
					case "PLAY_RESTART":
						return yield* play(owner, playlist).pipe(Effect.asVoid);
					case "PLAY_PREV":
					case "PLAY_NEXT": {
						if (latest)
							return yield* navigate(
								latest.session.playbackId,
								operation === "PLAY_PREV" ? -1 : 1,
								config.right.fade,
							);
						if (requests.size >= 128)
							return yield* new SoundboardConfigInvalid();
						invalidateOwner(owner);
						const request = {
							key: soundOwnerKey(owner),
							profileId: owner.profileId,
							valid: true,
						};
						requests.add(request);
						return yield* ports
							.navigateStopped(
								owner,
								config.right,
								operation === "PLAY_PREV" ? -1 : 1,
								() => request.valid,
							)
							.pipe(
								Effect.flatMap((session) => {
									if (Option.isNone(session)) return Effect.void;
									const slot = lookup(session.value.playbackId);
									if (!slot || !request.valid) return Effect.void;
									return ramp(
										slot,
										config.right.fade.mode === "out" ? 0 : slot.targetGain,
										config.right.fade.mode === "none"
											? 0
											: config.right.fade.durationMs,
									).pipe(
										Effect.asVoid,
										Effect.onInterrupt(() =>
											ports.stopNow(slot.session.playbackId),
										),
									);
								}),
								Effect.ensuring(
									Effect.sync(() => {
										requests.delete(request);
									}),
								),
							);
					}
				}
			}),
	);
	return {
		play,
		stop,
		pause,
		resume,
		previous,
		next,
		rescan,
		setVolume,
		stopProfile,
		stopAll,
		execute,
	};
};
