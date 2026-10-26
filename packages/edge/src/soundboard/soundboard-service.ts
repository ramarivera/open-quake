import {
	Cause,
	Effect,
	Either,
	Equal,
	Exit,
	Fiber,
	Option,
	Schema,
	Scope,
} from "effect";
import {
	AudioOutputBusy,
	type AudioOutputError,
	AudioOutputFailed,
} from "../audio/output-errors.js";
import { AudioOutput, type AudioOutputLease } from "../audio/output-service.js";
import {
	SoundOwner as OwnerSchema,
	SoundEndToken,
	type SoundOwner,
	SoundPlaylist,
	type SoundSession,
	soundOwnerKey,
} from "./playback-contracts.js";
import { SoundboardPlayer, type SoundPlayer } from "./playback-ports.js";
import {
	SoundboardConfigInvalid,
	type SoundboardDecodeFailed,
	SoundboardFileUnavailable,
	SoundboardLoadTimeout,
} from "./soundboard-errors.js";
import { SoundboardFiles } from "./soundboard-ports.js";
import { SoundboardRepository } from "./soundboard-repository.js";

export type SoundPlaybackError =
	| SoundboardConfigInvalid
	| SoundboardFileUnavailable
	| SoundboardDecodeFailed
	| SoundboardLoadTimeout
	| AudioOutputError;
interface Group {
	active: boolean;
	lease: Option.Option<AudioOutputLease>;
	readonly slots: Set<Slot>;
}
interface Slot {
	session: SoundSession;
	readonly playlist: SoundPlaylist;
	readonly group: Group;
	track: Option.Option<{
		readonly scope: Scope.CloseableScope;
		readonly close: Effect.Effect<void>;
	}>;
	player: Option.Option<SoundPlayer>;
	watcher: Option.Option<Fiber.RuntimeFiber<void, never>>;
	stop: Effect.Effect<void>;
}

export const makeSoundboardService = Effect.gen(function* () {
	const scope = yield* Scope.Scope;
	const repository = yield* SoundboardRepository;
	const backend = yield* SoundboardPlayer;
	const files = yield* SoundboardFiles;
	const output = yield* AudioOutput;
	const gate = yield* Effect.makeSemaphore(1);
	const slots = new Map<string, Slot>();
	const stopping = new Map<string, Slot>();
	const groups = new Set<Group>();
	const remembered = new Map<string, { revision: number; index: number }>();
	let group: Option.Option<Group> = Option.none();
	let sequence = 0;
	let commandEpoch = 0;
	let closed = false;
	const publish = (slot: Slot) => repository.put(slot.session);
	const current = (slot: Slot) =>
		slot.group.active && slots.get(slot.session.playbackId) === slot;
	const closeTrack = (slot: Slot): Effect.Effect<void> =>
		Effect.gen(function* () {
			const track = slot.track;
			const watcher = slot.watcher;
			slot.player = Option.none();
			const self = yield* Effect.fiberId;
			// Let shared native teardown settle before interrupting its observer.
			// Otherwise an interrupted watcher can poison the cached close result.
			if (Option.isSome(track)) yield* track.value.close;
			if (Option.isSome(watcher) && !Equal.equals(self, watcher.value.id()))
				yield* Fiber.interrupt(watcher.value);
			if (slot.track === track) slot.track = Option.none();
			if (slot.watcher === watcher) slot.watcher = Option.none();
		});
	const stopSlot = (slot: Slot): Effect.Effect<void> =>
		Effect.uninterruptible(slot.stop);
	const cleanupSlot = (slot: Slot): Effect.Effect<void> =>
		Effect.uninterruptible(
			Effect.gen(function* () {
				if (!slots.delete(slot.session.playbackId)) return;
				stopping.set(slot.session.playbackId, slot);
				const key = soundOwnerKey(slot.session.owner);
				remembered.delete(key);
				remembered.set(key, {
					revision: slot.playlist.revision,
					index: slot.session.trackIndex,
				});
				if (remembered.size > 1024)
					remembered.delete(remembered.keys().next().value ?? "");
				slot.session = {
					...slot.session,
					state: "stopped",
					generation: slot.session.generation + 1,
					positionMs: 0,
					gain: 0,
				};
				yield* publish(slot);
				yield* closeTrack(slot).pipe(
					Effect.onExit((exit) =>
						Effect.gen(function* () {
							if (Exit.isFailure(exit)) {
								slot.group.active = false;
								const error = new AudioOutputFailed(
									Cause.originalError(Cause.squash(exit.cause)),
								);
								slot.session = {
									...slot.session,
									state: "failed",
									errorCode: error.code,
								};
								yield* publish(slot);
								yield* Effect.logWarning("soundboard.player.failed", error);
							} else {
								slot.group.slots.delete(slot);
								stopping.delete(slot.session.playbackId);
							}
						}),
					),
				);
			}),
		);
	const stopGroup = (target: Group): Effect.Effect<void> =>
		Effect.suspend(() => {
			if (target.active) commandEpoch++;
			target.active = false;
			return Effect.forEach([...target.slots], stopSlot, {
				concurrency: "unbounded",
				discard: true,
			}).pipe(
				Effect.tap(() =>
					Effect.sync(() => {
						groups.delete(target);
						if (Option.isSome(group) && group.value === target)
							group = Option.none();
					}),
				),
			);
		});
	const releaseIdle = (target: Group): Effect.Effect<void> =>
		Effect.suspend(() => {
			if (target.slots.size !== 0 || Option.isNone(target.lease))
				return Effect.void;
			// Empty-group disposal isn't an explicit stop or voice preemption. Queued
			// commands remain valid while the idle lease closes its own resources.
			target.active = false;
			return target.lease.value.release;
		});
	const ensureGroup = Effect.gen(function* () {
		if (closed) return yield* new AudioOutputFailed();
		if (
			Option.isSome(group) &&
			group.value.active &&
			Option.isSome(group.value.lease) &&
			(yield* group.value.lease.value.current)
		)
			return group.value;
		const target: Group = {
			active: true,
			lease: Option.none(),
			slots: new Set(),
		};
		groups.add(target);
		const lease = yield* output
			// If an uninterruptible native finalizer stalls, the output owner must still
			// reach its deadline and fail closed. Cleanup retains ownership in the background.
			.acquire("soundboard", stopGroup(target).pipe(Effect.disconnect))
			.pipe(Effect.onError(() => stopGroup(target)));
		target.lease = Option.some(lease);
		if (closed || !target.active) {
			yield* lease.release;
			return yield* new AudioOutputBusy();
		}
		group = Option.some(target);
		return target;
	});
	const inspect = (slot: Slot, index: number): Effect.Effect<boolean> =>
		Effect.gen(function* () {
			const entry = slot.playlist.entries[index];
			if (!entry) return false;
			const status = yield* files.inspect(entry.path).pipe(
				Effect.timeoutFail({
					duration: "2 seconds",
					onTimeout: () => new SoundboardFileUnavailable(),
				}),
				Effect.tapError((error) =>
					Effect.logWarning("soundboard.file.inspection.failed", error),
				),
				Effect.catchTag("SoundboardFileUnavailable", () =>
					Effect.succeed("unreadable" as const),
				),
			);
			slot.session = {
				...slot.session,
				entries: slot.session.entries.map((item, offset) =>
					offset === index ? { ...item, status } : item,
				),
			};
			return status === "available";
		});
	let naturalEnd: (
		token: SoundEndToken,
	) => Effect.Effect<void, SoundPlaybackError>;
	const startTrack = (
		slot: Slot,
		index: number,
	): Effect.Effect<void, SoundPlaybackError> =>
		Effect.gen(function* () {
			// A native finalizer can defect before loading starts. Retain unsafe
			// teardown ownership and publish failure through the normal slot cleanup.
			yield* closeTrack(slot).pipe(
				Effect.onError(() => (current(slot) ? stopSlot(slot) : Effect.void)),
			);
			if (!current(slot)) return yield* new AudioOutputBusy();
			const entry = slot.playlist.entries[index];
			if (!entry) return yield* new SoundboardConfigInvalid();
			const track = yield* Scope.make();
			const teardown = yield* Effect.cached(Scope.close(track, Exit.void));
			slot.track = Option.some({ scope: track, close: teardown });
			if (!current(slot)) {
				yield* teardown;
				return yield* new AudioOutputBusy();
			}
			slot.session = {
				...slot.session,
				trackIndex: index,
				generation: slot.session.generation + 1,
				state: "loading",
				positionMs: 0,
				gain: slot.playlist.volume / 100,
			};
			yield* publish(slot);
			const loading = Effect.suspend(
				(): Effect.Effect<
					SoundPlayer,
					SoundboardDecodeFailed | AudioOutputBusy,
					Scope.Scope
				> =>
					current(slot)
						? backend.open(entry)
						: Effect.fail(new AudioOutputBusy()),
			).pipe(
				Effect.tap((player) =>
					Effect.gen(function* () {
						yield* player.ready;
						if (!current(slot)) return yield* new AudioOutputBusy();
						yield* player.gain(slot.session.gain);
						if (!current(slot)) return yield* new AudioOutputBusy();
						yield* player.play;
					}),
				),
				Effect.timeoutFail({
					duration: "10 seconds",
					onTimeout: () => new SoundboardLoadTimeout(),
				}),
				Effect.provideService(Scope.Scope, track),
			);
			const pending = yield* loading.pipe(Effect.forkIn(track));
			const loaded = yield* Fiber.await(pending);
			if (!current(slot)) return yield* new AudioOutputBusy();
			if (Exit.isFailure(loaded)) return yield* Effect.failCause(loaded.cause);
			const player = loaded.value;
			slot.player = Option.some(player);
			slot.session = { ...slot.session, state: "playing" };
			yield* publish(slot);
			const token: SoundEndToken = {
				playbackId: slot.session.playbackId,
				generation: slot.session.generation,
			};
			yield* Effect.uninterruptibleMask((restore) =>
				Effect.gen(function* () {
					const observation = player.ended.pipe(
						Effect.zipRight(Effect.suspend(() => naturalEnd(token))),
						Effect.matchEffect({
							onSuccess: () => Effect.void,
							onFailure: (error) =>
								gate.withPermits(1)(
									Effect.gen(function* () {
										if (
											!current(slot) ||
											slot.session.generation !== token.generation
										)
											return;
										yield* Effect.logWarning("soundboard.player.failed", error);
										yield* failed(slot, error);
									}),
								),
						}),
					);
					const watcher = yield* restore(observation).pipe(
						Effect.forkIn(scope),
					);
					slot.watcher = Option.some(watcher);
					if (!current(slot)) yield* Fiber.interrupt(watcher);
				}),
			);
		}).pipe(
			Effect.onInterrupt(() => (current(slot) ? stopSlot(slot) : Effect.void)),
		);
	const failed = (slot: Slot, error: SoundPlaybackError): Effect.Effect<void> =>
		Effect.gen(function* () {
			// Preempted/stopped loading work must not overwrite its terminal observation.
			if (!current(slot)) return;
			yield* stopSlot(slot);
			slot.session = {
				...slot.session,
				state: "failed",
				errorCode: error.code,
			};
			yield* publish(slot);
			yield* releaseIdle(slot.group);
		});
	naturalEnd = Effect.fn("SoundboardService.naturalEnd")(
		(token: SoundEndToken): Effect.Effect<void, SoundPlaybackError> =>
			gate.withPermits(1)(
				Effect.gen(function* () {
					const parsed = Schema.decodeUnknownEither(SoundEndToken)(token);
					if (Either.isLeft(parsed))
						return yield* new SoundboardConfigInvalid(parsed.left);
					const slot = slots.get(token.playbackId);
					if (
						!slot ||
						!current(slot) ||
						slot.session.generation !== token.generation ||
						slot.session.state !== "playing"
					)
						return;
					slot.session = { ...slot.session, state: "loading" };
					let index = slot.session.trackIndex;
					for (
						let visited = 0;
						visited < slot.playlist.entries.length;
						visited++
					) {
						if (!current(slot)) return;
						if (!slot.session.loopTrack || visited > 0)
							index = (index + 1) % slot.playlist.entries.length;
						if (yield* inspect(slot, index)) {
							yield* startTrack(slot, index).pipe(
								Effect.tapError((error) => failed(slot, error)),
							);
							return;
						}
					}
					yield* stopSlot(slot);
					yield* releaseIdle(slot.group);
				}),
			),
	);
	const serializeStart = <A, E>(
		run: (epoch: number) => Effect.Effect<A, E>,
	): Effect.Effect<A, E> =>
		Effect.suspend(() => gate.withPermits(1)(run(commandEpoch))).pipe(
			Effect.onInterrupt(() =>
				Effect.forEach([...groups], releaseIdle, { discard: true }),
			),
		);
	const play = Effect.fn("SoundboardService.play")(
		(
			owner: SoundOwner,
			playlist: SoundPlaylist,
			additional = false,
			loopTrack = false,
		): Effect.Effect<SoundSession, SoundPlaybackError> =>
			serializeStart((epoch) =>
				Effect.gen(function* () {
					const parsedOwner = Schema.decodeUnknownEither(OwnerSchema)(owner);
					const parsed = Schema.decodeUnknownEither(SoundPlaylist)(playlist);
					if (Either.isLeft(parsedOwner))
						return yield* new SoundboardConfigInvalid(parsedOwner.left);
					if (Either.isLeft(parsed))
						return yield* new SoundboardConfigInvalid(parsed.left);
					// Task 2.2 owns ramp semantics. Reject them until implemented rather than silently ignoring them.
					if (parsed.right.fade.mode !== "none")
						return yield* new SoundboardConfigInvalid();
					if (closed) return yield* new AudioOutputFailed();
					const config: SoundPlaylist = {
						...parsed.right,
						entries: parsed.right.entries.map((entry) => ({ ...entry })),
						fade: { ...parsed.right.fade },
					};
					const owned = { ...parsedOwner.right };
					const key = soundOwnerKey(owned);
					if (
						slots.size >= 128 &&
						(additional ||
							![...slots.values()].some(
								(slot) => soundOwnerKey(slot.session.owner) === key,
							))
					)
						return yield* new SoundboardConfigInvalid();
					const running = [...slots.values()]
						.reverse()
						.find(
							(slot) =>
								current(slot) && soundOwnerKey(slot.session.owner) === key,
						);
					const previous = running
						? {
								revision: running.playlist.revision,
								index: running.session.trackIndex,
							}
						: remembered.get(key);
					const index =
						previous?.revision === config.revision
							? Math.min(previous.index, config.entries.length - 1)
							: 0;
					// Validate the explicit target before stopping an unrelated or existing valid session.
					const entry = config.entries[index];
					if (
						!entry ||
						(yield* files.inspect(entry.path).pipe(
							Effect.timeoutFail({
								duration: "2 seconds",
								onTimeout: () => new SoundboardFileUnavailable(),
							}),
						)) !== "available"
					)
						return yield* new SoundboardFileUnavailable();
					if (epoch !== commandEpoch) return yield* new AudioOutputBusy();
					const target = yield* ensureGroup;
					if (closed || !target.active) return yield* new AudioOutputBusy();
					if (!additional)
						for (const slot of [...target.slots])
							if (soundOwnerKey(slot.session.owner) === key)
								yield* stopSlot(slot);
					const session: SoundSession = {
						playbackId: `sound-${++sequence}`,
						generation: 0,
						owner: owned,
						playlistRevision: config.revision,
						trackIndex: index,
						state: "loading",
						loopTrack,
						positionMs: 0,
						gain: config.volume / 100,
						entries: config.entries.map(({ fileId, status }, offset) => ({
							fileId,
							status: offset === index ? "available" : status,
						})),
					};
					const slot: Slot = {
						session,
						playlist: config,
						group: target,
						track: Option.none(),
						player: Option.none(),
						watcher: Option.none(),
						stop: Effect.void,
					};
					slot.stop = yield* Effect.cached(cleanupSlot(slot));
					if (closed || !target.active) return yield* new AudioOutputBusy();
					slots.set(session.playbackId, slot);
					target.slots.add(slot);
					yield* startTrack(slot, index).pipe(
						Effect.tapError((error) => failed(slot, error)),
						Effect.onInterrupt(() => releaseIdle(target)),
					);
					return {
						...slot.session,
						owner: { ...slot.session.owner },
						entries: slot.session.entries.map((item) => ({ ...item })),
					};
				}),
			),
	);
	const stop = Effect.fn("SoundboardService.stop")(
		(playbackId: string): Effect.Effect<void> =>
			Effect.gen(function* () {
				const slot = slots.get(playbackId) ?? stopping.get(playbackId);
				if (!slot) return;
				// Cancel loading without waiting for the command holding the gate.
				yield* stopSlot(slot);
				yield* gate.withPermits(1)(releaseIdle(slot.group));
			}),
	);
	const closing = yield* Effect.cached(
		Effect.uninterruptible(
			Effect.gen(function* () {
				closed = true;
				for (const target of [...groups]) {
					yield* stopGroup(target);
					if (Option.isSome(target.lease)) yield* target.lease.value.release;
				}
				yield* gate.withPermits(1)(Effect.void);
			}),
		),
	);
	const close = Effect.fn("SoundboardService.close")(
		(): Effect.Effect<void> => closing,
	);
	const stopAll = Effect.fn("SoundboardService.stopAll")(
		(): Effect.Effect<void> =>
			Effect.uninterruptible(
				Effect.gen(function* () {
					commandEpoch++;
					for (const target of [...groups]) {
						yield* stopGroup(target);
						yield* releaseIdle(target);
					}
					yield* gate.withPermits(1)(Effect.void);
				}),
			),
	);
	yield* Effect.addFinalizer(close);
	const snapshot = Effect.fn("SoundboardService.snapshot")(
		(): Effect.Effect<readonly SoundSession[]> => repository.list(),
	);
	return { play, stop, stopAll, naturalEnd, close, snapshot };
});

export class SoundboardService extends Effect.Service<SoundboardService>()(
	"@open-quake/edge/SoundboardService",
	{
		accessors: true,
		dependencies: [SoundboardRepository.Default],
		scoped: makeSoundboardService,
	},
) {}
