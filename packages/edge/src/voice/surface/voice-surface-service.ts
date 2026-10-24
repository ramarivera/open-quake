import { Effect, Option, Ref } from "effect";
import type {
	AgentConnection,
	StageEvent,
	ToastKey,
	VoiceSurfaceEvent,
} from "./voice-surface-contracts.js";
import {
	type CaptureMemory,
	isActiveStage,
	stepStage,
} from "./voice-surface-invariants.js";
import { VoiceSurfacePublisher, VoiceTonePort } from "./voice-surface-ports.js";

/** Recent captures remembered per process; older ones only lose dedupe. */
const MEMORY_LIMIT = 16;

interface Flow {
	readonly keyCode: string;
	readonly captureId: string;
}

/**
 * The conductor between a voice runtime and the strip: dedupes stages per
 * device and capture, derives tones and key alerts (design.md "Device
 * feedback"), tracks which key's flow is running, and fans events out.
 */
export class VoiceSurface extends Effect.Service<VoiceSurface>()(
	"VoiceSurface",
	{
		accessors: true,
		effect: Effect.gen(function* () {
			const publisher = yield* VoiceSurfacePublisher;
			const tones = yield* VoiceTonePort;
			const memories = yield* Ref.make<ReadonlyMap<string, CaptureMemory>>(
				new Map(),
			);
			const flows = yield* Ref.make<ReadonlyMap<string, Flow>>(new Map());
			const agent = yield* Ref.make<AgentConnection>("noService");
			const busyCount = yield* Ref.make(0);

			const remember = (event: StageEvent) =>
				Ref.modify(memories, (map) => {
					const id = `${event.serial}\u0000${event.captureId}`;
					const step = stepStage(Option.fromNullable(map.get(id)), event);
					const next = new Map(map);
					next.delete(id);
					next.set(id, step.memory);
					while (next.size > MEMORY_LIMIT) {
						const oldest = next.keys().next();
						if (oldest.done) break;
						next.delete(oldest.value);
					}
					return [step, next] as const;
				});

			const track = (event: StageEvent) =>
				Ref.update(flows, (map) => {
					const current = map.get(event.serial);
					if (isActiveStage(event.stage)) {
						const next = new Map(map);
						next.set(event.serial, {
							keyCode: event.keyCode,
							captureId: event.captureId,
						});
						return next;
					}
					// A busy stage belongs to a rejected press, not the running flow.
					if (
						event.stage._tag !== "busy" &&
						current?.captureId === event.captureId
					) {
						const next = new Map(map);
						next.delete(event.serial);
						return next;
					}
					return map;
				});

			const publish = Effect.fn("VoiceSurface.publish")(function* (
				event: VoiceSurfaceEvent,
			): Effect.fn.Return<void> {
				if (event._tag === "AgentStatus") yield* Ref.set(agent, event.state);
				if (event._tag === "Reset")
					yield* Ref.update(flows, (map) => {
						const next = new Map(map);
						next.delete(event.serial);
						return next;
					});
				if (event._tag !== "Stage") return yield* publisher.publish(event);
				yield* Effect.annotateCurrentSpan({
					keyCode: event.keyCode,
					stage: event.stage._tag,
				});
				const step = yield* remember(event);
				if (!step.publish) return;
				yield* track(event);
				yield* publisher.publish(event);
				for (const tone of step.feedback.tones)
					yield* tones.play(event.serial, tone);
				if (Option.isSome(step.feedback.alert))
					yield* publisher.publish({
						_tag: "KeyAlert",
						serial: event.serial,
						keyCode: step.feedback.alert.value.keyCode,
						alert: step.feedback.alert.value.alert,
					});
			});

			/** The key whose recording or processing stage is still running. */
			const activeFlow = Effect.fn("VoiceSurface.activeFlow")(function* (
				serial: string,
			): Effect.fn.Return<Option.Option<string>> {
				const map = yield* Ref.get(flows);
				return Option.map(
					Option.fromNullable(map.get(serial)),
					(flow) => flow.keyCode,
				);
			});
			/** Reserve before an adapter starts; its first Stage may arrive later. */
			const reserve = Effect.fn("VoiceSurface.reserve")(function* (
				serial: string,
				keyCode: string,
				captureId: string,
			): Effect.fn.Return<void> {
				yield* Ref.update(flows, (map) =>
					new Map(map).set(serial, { keyCode, captureId }),
				);
			});

			/**
			 * BG `Zo`: busy stage, busy tone and alert, plus DK's busy toast
			 * (AI-169; the knob's "Previous turn still running", KNOB-042).
			 */
			const rejectBusy = Effect.fn("VoiceSurface.rejectBusy")(function* (
				serial: string,
				keyCode: string,
				toast: ToastKey = "aiIconViewTxt.busyToast",
			): Effect.fn.Return<void> {
				const count = yield* Ref.updateAndGet(busyCount, (value) => value + 1);
				yield* publish({
					_tag: "Stage",
					serial,
					keyCode,
					captureId: `busy/${keyCode}/${count}`,
					stage: { _tag: "busy" },
				});
				yield* publish({ _tag: "Toast", serial, messageKey: toast });
			});

			const agentStatus = Effect.fn("VoiceSurface.agentStatus")(
				function* (): Effect.fn.Return<VoiceSurfaceEvent> {
					return { _tag: "AgentStatus", state: yield* Ref.get(agent) };
				},
			);

			return { publish, activeFlow, reserve, rejectBusy, agentStatus };
		}),
	},
) {}
