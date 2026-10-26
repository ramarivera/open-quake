import { Clock, Duration, Effect, Equal, Fiber, Option, Ref } from "effect";
import {
	type HoldEffect,
	type HoldInput,
	type HoldState,
	initialHoldState,
	nextDeadline,
	stepHold,
} from "./hold-to-talk.js";
import {
	type GridVoiceInput,
	KNOB_VOICE_KEY,
	type VoiceResetReason,
} from "./voice-surface-contracts.js";
import type { VoiceRuntimeUnavailable } from "./voice-surface-errors.js";
import {
	GridVoiceRuntime,
	type KnobCaptureSnapshot,
	type TextRequest,
} from "./voice-surface-ports.js";
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

		const captureRejected =
			(serial: string, keyCode: string, captureId: string) =>
			(error: { readonly code: string }) =>
				surface.publish({
					_tag: "Stage",
					serial,
					keyCode,
					captureId,
					stage: {
						_tag: "failed",
						reason: "unavailable",
						errorCode: error.code,
					},
				});
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
					return surface.reserve(serial, effect.keyCode, captureId).pipe(
						Effect.zipRight(
							runtime
								.startCapture({
									serial,
									keyCode: effect.keyCode,
									captureId,
									generation: effect.generation,
									type: effect.type,
									agentId: effect.agentId,
								})
								.pipe(
									Effect.catchTags({
										VoiceRuntimeUnavailable: captureRejected(
											serial,
											effect.keyCode,
											captureId,
										),
										VoiceKnobRejected: captureRejected(
											serial,
											effect.keyCode,
											captureId,
										),
									}),
								),
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

		const applyUnlocked = (
			serial: string,
			input: (now: number, activeFlow: Option.Option<string>) => HoldInput,
		): Effect.Effect<void> =>
			Effect.gen(function* () {
				const now = yield* Clock.currentTimeMillis;
				const flow = yield* surface.activeFlow(serial);
				const state = (yield* Ref.get(states)).get(serial) ?? initialHoldState;
				const step = stepHold(state, input(now, flow));
				yield* Ref.update(states, (map) =>
					new Map(map).set(serial, step.state),
				);
				yield* Effect.forEach(step.effects, (effect) => run(serial, effect), {
					discard: true,
				});
				yield* reschedule(serial, step.state, now);
			});
		const apply: typeof applyUnlocked = (serial, input) =>
			lock.withPermits(1)(applyUnlocked(serial, input));

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
			if (event.type === "clawbot" && event.voiceInput === false) {
				if (event.kind === "down")
					yield* runtime.select(
						serial,
						event.keyCode,
						event.type,
						Option.fromNullable(event.agentId),
					);
				return yield* surface.publish({
					_tag: "KeyPress",
					serial,
					keyCode: event.keyCode,
					action: event.kind === "down" ? "down" : "up",
				});
			}
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
			reason: VoiceResetReason = "profileChanged",
		): Effect.fn.Return<void> {
			yield* lock.withPermits(1)(
				Effect.gen(function* () {
					const held = (
						(yield* Ref.get(states)).get(serial) ?? initialHoldState
					).held;
					yield* applyUnlocked(serial, (now) => ({ _tag: "reset", now }));
					// A released capture may already be processing; it still belongs to
					// this device and must be cancelled before the renderer reset.
					const flow = yield* surface.activeFlow(serial);
					if (
						Option.isSome(flow) &&
						!Option.exists(
							held,
							(key) => key.phase === "capturing" && key.keyCode === flow.value,
						)
					)
						yield* runtime.cancelFlow(serial, flow.value);
					yield* surface.publish({ _tag: "Reset", serial, reason });
				}),
			);
		});

		const sendText = Effect.fn("GridVoice.sendText")(function* (
			request: TextRequest,
		): Effect.fn.Return<void, VoiceRuntimeUnavailable> {
			const count = yield* Ref.updateAndGet(texts, (value) => value + 1);
			yield* runtime.sendText(request).pipe(
				Effect.tapErrorTag("VoiceRuntimeUnavailable", (error) =>
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

		/**
		 * knob model's push-to-talk seam (`KnobVoiceInput`): a hold starts a
		 * knob capture unless another key's flow or reservation holds voice
		 * (busy, KNOB-042); a re-press cancels the knob's own turn first
		 * (knob-push-to-talk "Exclusive capture and re-press"); a short press
		 * interrupts (KNOB top gap 3).
		 */
		const knob = Effect.fn("GridVoice.knob")(function* (
			serial: string,
			action: "holdStart" | "release" | "interrupt" | "cancel",
			generation: number,
			snapshot?: KnobCaptureSnapshot,
		): Effect.fn.Return<void> {
			yield* Effect.annotateCurrentSpan({ action, generation });
			const captureId = `${KNOB_VOICE_KEY}/knob-${generation}`;
			return yield* lock.withPermits(1)(
				Effect.gen(function* () {
					switch (action) {
						case "holdStart": {
							const flow = yield* surface.activeFlow(serial);
							const reserved = Option.isSome(
								((yield* Ref.get(states)).get(serial) ?? initialHoldState).held,
							);
							if (
								reserved ||
								Option.exists(flow, (keyCode) => keyCode !== KNOB_VOICE_KEY)
							)
								return yield* surface.rejectBusy(
									serial,
									KNOB_VOICE_KEY,
									"aiAudio.prevTurnBusy",
								);
							yield* surface.reserve(serial, KNOB_VOICE_KEY, captureId);
							return yield* runtime
								.startCapture({
									serial,
									keyCode: KNOB_VOICE_KEY,
									captureId,
									generation,
									type: "knob",
									...(snapshot ? { knob: snapshot } : {}),
									agentId: Option.none(),
								})
								.pipe(
									Effect.catchTags({
										VoiceRuntimeUnavailable: captureRejected(
											serial,
											KNOB_VOICE_KEY,
											captureId,
										),
										VoiceKnobRejected: captureRejected(
											serial,
											KNOB_VOICE_KEY,
											captureId,
										),
									}),
								);
						}
						case "release":
							return yield* runtime.releaseCapture(
								serial,
								KNOB_VOICE_KEY,
								generation,
							);
						case "interrupt":
							return yield* runtime.cancelFlow(serial, KNOB_VOICE_KEY);
						case "cancel":
							return yield* runtime.cancelCapture(
								serial,
								KNOB_VOICE_KEY,
								generation,
							);
					}
				}),
			);
		});

		return { input, reset, sendText, knob };
	}),
}) {}
