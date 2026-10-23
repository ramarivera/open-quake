import { Context, Effect, Either, Layer, Option, Schema } from "effect";
import {
	type KnobDispatchCommand,
	KnobEvent,
	KnobFunction,
	type KnobSession,
	KnobSnapshot,
	KnobVoiceActions,
} from "./knob-contracts.js";
import {
	sameKnobSession,
	selectKnobRotation,
} from "./knob-dispatch-routing.js";
import {
	InvalidKnobConfig,
	KnobCapabilityUnavailable,
	KnobDispatchFailed,
	type KnobError,
	KnobRouteIncomplete,
	KnobSessionStale,
} from "./knob-errors.js";
import { findKnobCapability, type KnobRegistry } from "./knob-registry.js";
import { directKnobRouteReferences } from "./knob-voice-migration.js";

/** Infrastructure boundary. The profile lane supplies committed snapshots, never drafts. */
export interface KnobPorts {
	readonly registry: KnobRegistry;
	readonly readSnapshot: (deviceId: string) => Promise<unknown>;
	/** Must atomically recheck the complete session against current selection before IO. */
	readonly dispatch: (command: KnobDispatchCommand) => Promise<void>;
}
export class KnobDispatchPorts extends Context.Tag(
	"@open-quake/device/KnobDispatchPorts",
)<KnobDispatchPorts, KnobPorts>() {}
const unavailablePorts = Layer.succeed(KnobDispatchPorts, {
	registry: [],
	readSnapshot: () => Promise.resolve(undefined),
	dispatch: () => Promise.reject(KnobCapabilityUnavailable.fromCause()),
});
export interface KnobDispatchResult {
	readonly dispatched: number;
	readonly ignored: number;
}
interface PressState {
	readonly session: KnobSession;
	readonly pressId: string;
	readonly held: boolean;
}
interface CompletedPresses {
	readonly session: KnobSession;
	readonly pressIds: Set<string>;
}
export class KnobService extends Effect.Service<KnobService>()(
	"@open-quake/device/KnobService",
	{
		accessors: true,
		dependencies: [unavailablePorts],
		effect: Effect.gen(function* () {
			const ports = yield* KnobDispatchPorts;
			// Serialize the state transition and callback, including concurrent duplicate releases.
			const semaphore = yield* Effect.makeSemaphore(1);
			const pressed = new Map<string, PressState>();
			const disconnected = new Map<string, ReadonlyArray<KnobSession>>();
			const completed = new Map<string, CompletedPresses>();
			const read = Effect.fn("KnobService.readSnapshot")(function* (
				session: KnobSession,
			): Effect.fn.Return<KnobSnapshot, KnobError> {
				const ended = disconnected.get(session.deviceId);
				if (ended?.some((entry) => sameKnobSession(entry, session)))
					return yield* KnobSessionStale.fromCause();
				const raw = yield* Effect.tryPromise({
					try: () => ports.readSnapshot(session.deviceId),
					catch: (cause) => KnobDispatchFailed.fromCause(cause),
				});
				if (raw === undefined)
					return yield* KnobCapabilityUnavailable.fromCause();
				const snapshot = yield* Schema.decodeUnknown(KnobSnapshot, {
					onExcessProperty: "error",
				})(raw).pipe(
					Effect.catchTag("ParseError", (cause) =>
						Effect.fail(InvalidKnobConfig.fromCause(cause)),
					),
				);
				if (!sameKnobSession(session, snapshot.session)) {
					const old = pressed.get(session.deviceId);
					if (old && !sameKnobSession(old.session, snapshot.session))
						pressed.delete(session.deviceId);
					return yield* KnobSessionStale.fromCause();
				}
				return snapshot;
			});
			const execute = Effect.fn("KnobService.execute")(function* (
				command: KnobDispatchCommand,
			): Effect.fn.Return<void, KnobError> {
				const capability = findKnobCapability(
					ports.registry,
					command.assignment.config.type,
				);
				if (Option.isNone(capability))
					return yield* KnobCapabilityUnavailable.fromCause();
				yield* capability.value.validate(command.assignment);
				if (
					command.activation === "rotate"
						? !capability.value.rotation
						: !capability.value.press
				)
					return yield* KnobCapabilityUnavailable.fromCause();
				yield* Effect.tryPromise({
					try: () => ports.dispatch(command),
					catch: (cause) =>
						cause instanceof InvalidKnobConfig ||
						cause instanceof KnobCapabilityUnavailable ||
						cause instanceof KnobRouteIncomplete ||
						cause instanceof KnobSessionStale ||
						cause instanceof KnobDispatchFailed
							? cause
							: KnobDispatchFailed.fromCause(cause),
				});
			});
			const handle = Effect.fn("KnobService.handle")(function* (
				event: KnobEvent,
			): Effect.fn.Return<KnobDispatchResult, KnobError> {
				if (event._tag === "Rotate") {
					let dispatched = 0;
					let ignored = 0;
					for (let detent = 0; detent < event.detents; detent++) {
						const snapshot = yield* read(event.session);
						const command = selectKnobRotation(
							snapshot,
							event.direction,
							ports.registry,
						);
						if (Option.isNone(command)) {
							ignored++;
							continue;
						}
						yield* execute(command.value);
						dispatched++;
					}
					return { dispatched, ignored };
				}
				const old = pressed.get(event.session.deviceId);
				if (event._tag === "Disconnect") {
					// Session invalidation must not depend on snapshot availability.
					const ended = disconnected.get(event.session.deviceId) ?? [];
					if (!ended.some((entry) => sameKnobSession(entry, event.session)))
						disconnected.set(event.session.deviceId, [...ended, event.session]);
					if (old && sameKnobSession(old.session, event.session))
						pressed.delete(event.session.deviceId);
					return { dispatched: 0, ignored: 1 };
				}
				const matches =
					old &&
					sameKnobSession(old.session, event.session) &&
					old.pressId === event.pressId;
				// Commit lifecycle transitions before fallible IO, including interruption.
				if (event._tag === "Release" && matches) {
					const last = completed.get(event.session.deviceId);
					if (last && sameKnobSession(last.session, event.session))
						last.pressIds.add(event.pressId);
					else
						completed.set(event.session.deviceId, {
							session: event.session,
							pressIds: new Set([event.pressId]),
						});
					pressed.delete(event.session.deviceId);
				}
				if (event._tag === "HoldStart" && matches && !old.held)
					pressed.set(event.session.deviceId, { ...old, held: true });
				const snapshot = yield* read(event.session);
				if (event._tag === "Press") {
					const last = completed.get(event.session.deviceId);
					if (
						last &&
						sameKnobSession(last.session, event.session) &&
						last.pressIds.has(event.pressId)
					)
						return { dispatched: 0, ignored: 1 };
					if (!old || !sameKnobSession(old.session, event.session))
						pressed.set(event.session.deviceId, {
							session: event.session,
							pressId: event.pressId,
							held: false,
						});
					return { dispatched: 0, ignored: 1 };
				}
				if (event._tag === "HoldStart") {
					if (!matches || old.held) return { dispatched: 0, ignored: 1 };
					const center = Option.isSome(snapshot.knob)
						? Schema.decodeUnknownEither(KnobFunction)(
								snapshot.knob.value.config.subActions[0],
							)
						: Either.left(undefined);
					if (
						Either.isRight(center) &&
						center.right.config.type === "assistant"
					) {
						const actions = Schema.decodeUnknownEither(KnobVoiceActions)(
							center.right.config.actions,
						);
						if (Either.isLeft(actions))
							return yield* InvalidKnobConfig.fromCause(actions.left);
						if (
							actions.right.some(
								(a) => a.type === "voiceRoute" && a.value === "direct",
							) &&
							Option.isNone(directKnobRouteReferences(actions.right))
						)
							return yield* KnobRouteIncomplete.fromCause();
					}
					// Capture belongs to the voice lane. A consumed hold never falls through to press.
					return yield* KnobCapabilityUnavailable.fromCause();
				}
				if (!matches) return { dispatched: 0, ignored: 1 };
				if (
					old.held ||
					event.classification !== "short" ||
					Option.isNone(snapshot.knob) ||
					!snapshot.knob.value.config.display
				)
					return { dispatched: 0, ignored: 1 };
				const center = Schema.decodeUnknownEither(KnobFunction)(
					snapshot.knob.value.config.subActions[0],
				);
				if (Either.isLeft(center)) return { dispatched: 0, ignored: 1 };
				const capability = findKnobCapability(
					ports.registry,
					center.right.config.type,
				);
				if (Option.isNone(capability))
					return yield* KnobCapabilityUnavailable.fromCause();
				if (!capability.value.press) return { dispatched: 0, ignored: 1 };
				yield* execute({
					session: snapshot.session,
					route: "center",
					assignment: center.right,
					activation: "press",
				});
				return { dispatched: 1, ignored: 0 };
			});
			const dispatch = Effect.fn("KnobService.dispatch")(function* (
				input: unknown,
			): Effect.fn.Return<KnobDispatchResult, KnobError> {
				const event = yield* Schema.decodeUnknown(KnobEvent, {
					onExcessProperty: "error",
				})(input).pipe(
					Effect.catchTag("ParseError", (cause) =>
						Effect.fail(InvalidKnobConfig.fromCause(cause)),
					),
				);
				return yield* semaphore.withPermits(1)(handle(event));
			});
			return { dispatch };
		}),
	},
) {}
