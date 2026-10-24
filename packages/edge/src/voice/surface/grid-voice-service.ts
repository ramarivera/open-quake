import { Clock, Duration, Effect, Equal, Fiber, Option, Ref } from "effect";
import {
	type HoldEffect,
	type HoldInput,
	type HoldState,
	initialHoldState,
	nextDeadline,
	stepHold,
} from "./hold-to-talk.js";
import type { GridVoiceInput } from "./voice-surface-contracts.js";
import { GridVoiceRuntime, type TextRequest } from "./voice-surface-ports.js";
import { VoiceSurface } from "./voice-surface-service.js";

/**
 * Drives the hold-to-talk reducer per device with Clock-based deadlines
 * (one timer per device) and turns its effects into runtime calls and
 * surface events.
 */
export class GridVoice extends Effect.Service<GridVoice>()("GridVoice", {
	accessors: true,
	scoped: Effect.gen(function* () {
		const surface = yield* VoiceSurface;
		const runtime = yield* GridVoiceRuntime;
		const scope = yield* Effect.scope;
		const lock = yield* Effect.makeSemaphore(1);
		const states = yield* Ref.make<ReadonlyMap<string, HoldState>>(new Map());
		const timers = yield* Ref.make<
			ReadonlyMap<string, Fiber.RuntimeFiber<void>>
		>(new Map());
		const texts = yield* Ref.make(0);

		const run = (serial: string, effect: HoldEffect): Effect.Effect<void> => {
			switch (effect._tag) {
				case "select":
					return runtime.select(
						serial,
						effect.keyCode,
						effect.type,
						effect.agentId,
					);
				case "keyPress":
					return surface.publish({
						_tag: "KeyPress",
						serial,
						keyCode: effect.keyCode,
						action: effect.action,
					});
				case "startCapture": {
					const captureId = `${effect.keyCode}/${effect.generation}`;
					return runtime
						.startCapture({
							serial,
							keyCode: effect.keyCode,
							captureId,
							generation: effect.generation,
							type: effect.type,
							agentId: effect.agentId,
						})
						.pipe(
							Effect.catchTag("VoiceRuntimeUnavailable", (error) =>
								surface.publish({
									_tag: "Stage",
									serial,
									keyCode: effect.keyCode,
									captureId,
									stage: {
										_tag: "failed",
										reason: "unavailable",
										errorCode: error.code,
									},
								}),
							),
						);
				}
				case "release":
					return runtime.releaseCapture(
						serial,
						effect.keyCode,
						effect.generation,
					);
				case "cancelCapture":
					return runtime.cancelCapture(
						serial,
						effect.keyCode,
						effect.generation,
					);
				case "cancelFlow":
					return runtime.cancelFlow(serial, effect.keyCode);
				case "busy":
					return surface.rejectBusy(serial, effect.keyCode);
			}
		};

		const apply = (
			serial: string,
			input: (now: number, activeFlow: Option.Option<string>) => HoldInput,
		): Effect.Effect<void> =>
			lock.withPermits(1)(
				Effect.gen(function* () {
					const now = yield* Clock.currentTimeMillis;
					const flow = yield* surface.activeFlow(serial);
					const state =
						(yield* Ref.get(states)).get(serial) ?? initialHoldState;
					const step = stepHold(state, input(now, flow));
					yield* Ref.update(states, (map) =>
						new Map(map).set(serial, step.state),
					);
					yield* Effect.forEach(step.effects, (effect) => run(serial, effect), {
						discard: true,
					});
					yield* reschedule(serial, step.state, now);
				}),
			);

		const reschedule = (
			serial: string,
			state: HoldState,
			now: number,
		): Effect.Effect<void> =>
			Effect.gen(function* () {
				const self = yield* Effect.fiberId;
				const previous = (yield* Ref.get(timers)).get(serial);
				// The timer fiber reschedules from inside itself; never self-interrupt.
				if (previous && !Equal.equals(previous.id(), self))
					yield* Fiber.interrupt(previous);
				const deadline = nextDeadline(state);
				if (Option.isNone(deadline)) {
					yield* Ref.update(timers, (map) => {
						const next = new Map(map);
						next.delete(serial);
						return next;
					});
					return;
				}
				const timer = yield* Effect.sleep(
					Duration.millis(Math.max(0, deadline.value - now)),
				).pipe(
					Effect.zipRight(apply(serial, (at) => ({ _tag: "tick", now: at }))),
					Effect.forkIn(scope),
				);
				yield* Ref.update(timers, (map) => new Map(map).set(serial, timer));
			});

		const input = Effect.fn("GridVoice.input")(function* (
			serial: string,
			event: GridVoiceInput,
		): Effect.fn.Return<void> {
			yield* Effect.annotateCurrentSpan({
				keyCode: event.keyCode,
				kind: event.kind,
			});
			yield* apply(serial, (now, activeFlow): HoldInput => {
				switch (event.kind) {
					case "down":
						return {
							_tag: "down",
							keyCode: event.keyCode,
							type: event.type,
							agentId: Option.fromNullable(event.agentId),
							now,
							activeFlow,
						};
					case "touchEnd":
						return { _tag: "touchEnd", keyCode: event.keyCode, now };
					case "touchCancel":
						return { _tag: "touchCancel", keyCode: event.keyCode, now };
					case "up":
						return {
							_tag: "up",
							keyCode: event.keyCode,
							now,
							voiceTouchEnd: event.voiceTouchEnd === true,
						};
				}
			});
		});

		/** Profile change or disconnect: disarm and cancel a running capture. */
		const reset = Effect.fn("GridVoice.reset")(function* (
			serial: string,
		): Effect.fn.Return<void> {
			yield* apply(serial, (now) => ({ _tag: "reset", now }));
		});

		const sendText = Effect.fn("GridVoice.sendText")(function* (
			request: TextRequest,
		): Effect.fn.Return<void> {
			const count = yield* Ref.updateAndGet(texts, (value) => value + 1);
			yield* runtime.sendText(request).pipe(
				Effect.catchTag("VoiceRuntimeUnavailable", (error) =>
					surface.publish({
						_tag: "Stage",
						serial: request.serial,
						keyCode: request.keyCode,
						captureId: `text/${request.keyCode}/${count}`,
						stage: {
							_tag: "failed",
							reason: "unavailable",
							errorCode: error.code,
						},
					}),
				),
			);
		});

		return { input, reset, sendText };
	}),
}) {}
