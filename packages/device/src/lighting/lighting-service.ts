import { Cause, Deferred, Effect, Exit, Option, Schema, Scope } from "effect";
import {
	type LightingCapabilities,
	type LightingChange,
	type LightingField,
	type LightingState,
	LightingTarget,
} from "./lighting-contracts.js";
import { type LightingConnection, LightingDevice } from "./lighting-device.js";
import {
	LightingApplyFailed,
	type LightingError,
	LightingSaveFailed,
	LightingTargetUnavailable,
	LightingValueUnsupported,
} from "./lighting-errors.js";
import {
	changeBytes,
	reconcileSaveStatus,
	replaceChange,
	sameChange,
	sameTarget,
	sameValues,
	validateChange,
} from "./lighting-invariants.js";

export interface LightingConductor {
	readonly select: (
		target: LightingTarget,
	) => Effect.Effect<LightingState, LightingError>;
	/** Validates and queues the latest edit; does not claim transport completion. */
	readonly setDesired: (
		target: LightingTarget,
		input: unknown,
	) => Effect.Effect<LightingState, LightingError>;
	/** Waits for matching set echoes and actual-value readback. */
	readonly flush: (
		target: LightingTarget,
	) => Effect.Effect<LightingState, LightingError>;
	/** Explicit save echo plus applied-snapshot readback; reboot remains unverified. */
	readonly save: (
		target: LightingTarget,
	) => Effect.Effect<LightingState, LightingError>;
	readonly state: () => Effect.Effect<Option.Option<LightingState>>;
	readonly deselect: () => Effect.Effect<void>;
}

interface Session {
	readonly capabilities: LightingCapabilities;
	readonly scope: Scope.CloseableScope;
	readonly stopped: Deferred.Deferred<void>;
	readonly closed: Deferred.Deferred<void>;
	closing: boolean;
	readonly lock: Effect.Semaphore;
	readonly pending: Map<LightingField, LightingChange>;
	state: LightingState;
	connection: Option.Option<LightingConnection>;
	drain: Option.Option<Deferred.Deferred<void, LightingError>>;
	failure: Option.Option<LightingError>;
}

export class LightingService extends Effect.Service<LightingService>()(
	"@open-quake/device/LightingService",
	{
		accessors: true,
		dependencies: [LightingDevice.Default],
		scoped: Effect.gen(function* () {
			const device = yield* LightingDevice;
			const serviceScope = yield* Effect.scope;
			let selected = Option.none<Session>();
			let selection = 0;
			const close = (session: Session, cancel = true): Effect.Effect<void> =>
				Effect.gen(function* () {
					if (cancel) yield* Deferred.succeed(session.stopped, undefined);
					if (session.closing) return yield* Deferred.await(session.closed);
					session.closing = true;
					session.pending.clear();
					yield* Scope.close(session.scope, Exit.void).pipe(
						Effect.ensuring(Deferred.succeed(session.closed, undefined)),
					);
				}).pipe(Effect.uninterruptible);
			yield* Effect.addFinalizer(() =>
				Option.isSome(selected) ? close(selected.value) : Effect.void,
			);
			const isCurrent = (session: Session): boolean =>
				Option.isSome(selected) && selected.value === session;
			const guard = <A, E, R>(
				session: Session,
				effect: Effect.Effect<A, E, R>,
			): Effect.Effect<A, E | LightingTargetUnavailable, R> =>
				Effect.raceFirst(
					effect,
					Deferred.await(session.stopped).pipe(
						Effect.zipRight(Effect.fail(new LightingTargetUnavailable())),
					),
				);
			const get = (
				target: LightingTarget,
			): Effect.Effect<Session, LightingTargetUnavailable> =>
				Effect.suspend(() =>
					Option.isSome(selected) &&
					sameTarget(selected.value.capabilities.target, target)
						? Effect.succeed(selected.value)
						: Effect.fail(new LightingTargetUnavailable()),
				);
			const startDrain = (session: Session): Effect.Effect<void> =>
				Effect.gen(function* () {
					if (Option.isSome(session.drain)) return;
					const completed = yield* Deferred.make<void, LightingError>();
					if (Option.isSome(session.drain)) return;
					session.drain = Option.some(completed);
					const work = Effect.gen(function* () {
						while (true) {
							const applied = yield* session.lock.withPermits(1)(
								guard(
									session,
									Effect.gen(function* () {
										const change = session.pending.values().next().value;
										if (!change) {
											session.drain = Option.none();
											return false;
										}
										session.pending.delete(change.field);
										const cap = session.capabilities.fields.find(
											(cap) => cap.field === change.field,
										);
										if (!cap || Option.isNone(session.connection))
											return yield* new LightingTargetUnavailable();
										const connection = session.connection.value;
										yield* connection
											.exchange({
												command: 7,
												lightingValue: cap.valueId,
												values: changeBytes(change),
											})
											.pipe(
												Effect.catchTag("LightingIoFailed", (cause) =>
													Effect.fail(new LightingApplyFailed(cause)),
												),
											);
										const actual = yield* connection
											.read(cap)
											.pipe(
												Effect.catchTag("LightingReadFailed", (cause) =>
													Effect.fail(new LightingApplyFailed(cause)),
												),
											);
										if (!sameChange(change, actual))
											return yield* new LightingApplyFailed(
												"readback-mismatch",
											);
										if (!isCurrent(session))
											return yield* new LightingTargetUnavailable();
										session.state = reconcileSaveStatus(
											{
												...session.state,
												applied: replaceChange(session.state.applied, actual),
											},
											session.pending.size > 0,
										);
										return true;
									}),
								).pipe(Effect.interruptible),
							);
							if (!applied) return;
						}
					});
					yield* work.pipe(
						Effect.interruptible,
						Effect.exit,
						Effect.flatMap((exit) =>
							Effect.gen(function* () {
								if (
									Option.isSome(session.drain) &&
									session.drain.value === completed
								)
									session.drain = Option.none();
								if (Exit.isFailure(exit)) {
									session.pending.clear();
									session.failure = Option.some(
										Option.getOrElse(
											Cause.failureOption(exit.cause),
											() => new LightingTargetUnavailable(),
										),
									);
									yield* Deferred.failCause(completed, exit.cause);
								} else yield* Deferred.succeed(completed, undefined);
							}),
						),
						Effect.forkIn(serviceScope),
					);
				}).pipe(Effect.uninterruptible);
			const select = Effect.fn("LightingService.select")(function* (
				input: LightingTarget,
			): Effect.fn.Return<LightingState, LightingError> {
				const target = yield* Schema.decodeUnknown(LightingTarget)(input).pipe(
					Effect.catchTag("ParseError", (cause) =>
						Effect.fail(new LightingTargetUnavailable(cause)),
					),
				);
				const ticket = ++selection;
				const previous = selected;
				selected = Option.none();
				if (Option.isSome(previous)) yield* close(previous.value);
				const registration = yield* device.resolve(target);
				if (selection !== ticket) return yield* new LightingTargetUnavailable();
				const capabilities = registration.capabilities;
				const session: Session = {
					capabilities,
					scope: yield* Scope.make(),
					stopped: yield* Deferred.make<void>(),
					closed: yield* Deferred.make<void>(),
					closing: false,
					lock: yield* Effect.makeSemaphore(1),
					pending: new Map(),
					state: {
						capabilities,
						status: "reading",
						desired: [],
						applied: [],
						saved: Option.none(),
						saveStatus: "unknown",
					},
					connection: Option.none(),
					drain: Option.none(),
					failure: Option.none(),
				};
				if (selection !== ticket) {
					yield* close(session);
					return yield* new LightingTargetUnavailable();
				}
				selected = Option.some(session);
				return yield* guard(
					session,
					Effect.gen(function* () {
						if (capabilities.transport === "unavailable") {
							session.state = { ...session.state, status: "unavailable" };
							return session.state;
						}
						const connection = yield* device
							.open(registration)
							.pipe(Scope.extend(session.scope));
						session.connection = Option.some(connection);
						yield* guard(session, connection.ended).pipe(
							Effect.matchEffect({
								onFailure: () =>
									Effect.gen(function* () {
										session.state = { ...session.state, status: "unavailable" };
										session.pending.clear();
										yield* close(session, false);
									}),
								onSuccess: () => Effect.void,
							}),
							Effect.forkIn(serviceScope),
						);
						const actual = yield* Effect.forEach(
							capabilities.fields.filter((cap) => cap.readable),
							connection.read,
						);
						if (!isCurrent(session))
							return yield* new LightingTargetUnavailable();
						session.state = {
							...session.state,
							status: "ready",
							desired: actual,
							applied: actual,
						};
						return session.state;
					}),
				).pipe(
					Effect.onExit((exit) =>
						Exit.isFailure(exit)
							? Effect.gen(function* () {
									session.state = { ...session.state, status: "unavailable" };
									yield* close(session);
								})
							: Effect.void,
					),
				);
			});
			const setDesired = Effect.fn("LightingService.setDesired")(function* (
				target: LightingTarget,
				input: unknown,
			): Effect.fn.Return<LightingState, LightingError> {
				const session = yield* get(target);
				const change = yield* validateChange(session.capabilities, input);
				if (session.state.status !== "ready" || !isCurrent(session))
					return yield* new LightingTargetUnavailable();
				session.state = reconcileSaveStatus(
					{
						...session.state,
						desired: replaceChange(session.state.desired, change),
					},
					true,
				);
				session.failure = Option.none();
				session.pending.set(change.field, change);
				yield* startDrain(session);
				return session.state;
			});
			const flush = Effect.fn("LightingService.flush")(function* (
				target: LightingTarget,
			): Effect.fn.Return<LightingState, LightingError> {
				const session = yield* get(target);
				while (Option.isSome(session.drain))
					yield* guard(session, Deferred.await(session.drain.value));
				if (Option.isSome(session.failure)) return yield* session.failure.value;
				if (!isCurrent(session) || session.state.status !== "ready")
					return yield* new LightingTargetUnavailable();
				return session.state;
			});
			const save = Effect.fn("LightingService.save")(function* (
				target: LightingTarget,
			): Effect.fn.Return<LightingState, LightingError> {
				const session = yield* get(target);
				if (Option.isNone(session.capabilities.save))
					return yield* new LightingValueUnsupported();
				yield* flush(target);
				return yield* session.lock
					.withPermits(1)(
						guard(
							session,
							Effect.gen(function* () {
								if (!isCurrent(session) || Option.isNone(session.connection))
									return yield* new LightingTargetUnavailable();
								if (
									session.pending.size > 0 ||
									Option.isSome(session.drain) ||
									!sameValues(session.state.desired, session.state.applied)
								)
									return yield* new LightingSaveFailed("pending-edits");
								const applied = session.state.applied;
								const connection = session.connection.value;
								yield* connection
									.exchange({ command: 9 })
									.pipe(
										Effect.catchTag("LightingIoFailed", (cause) =>
											Effect.fail(new LightingSaveFailed(cause)),
										),
									);
								const actual = yield* Effect.forEach(
									session.capabilities.fields.filter((cap) => cap.readable),
									connection.read,
								).pipe(
									Effect.catchTag("LightingReadFailed", (cause) =>
										Effect.fail(new LightingSaveFailed(cause)),
									),
								);
								if (!sameValues(actual, applied))
									return yield* new LightingSaveFailed("readback-mismatch");
								if (!isCurrent(session))
									return yield* new LightingTargetUnavailable();
								session.state = reconcileSaveStatus(
									{
										...session.state,
										saved: Option.some(applied),
										saveStatus: "saved",
									},
									session.pending.size > 0,
								);
								return session.state;
							}),
						),
					)
					.pipe(
						Effect.tapError(() =>
							Effect.sync(() => {
								session.state = { ...session.state, saveStatus: "failed" };
							}),
						),
					);
			});
			return {
				select,
				setDesired,
				flush,
				save,
				state: Effect.fn("LightingService.state")(
					(): Effect.Effect<Option.Option<LightingState>> =>
						Effect.sync(() => Option.map(selected, (session) => session.state)),
				),
				deselect: Effect.fn("LightingService.deselect")(
					function* (): Effect.fn.Return<void> {
						++selection;
						const previous = selected;
						selected = Option.none();
						if (Option.isSome(previous)) yield* close(previous.value);
					},
				),
			} satisfies LightingConductor;
		}),
	},
) {}
