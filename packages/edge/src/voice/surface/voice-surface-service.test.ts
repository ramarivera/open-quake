import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import type {
	StageEvent,
	VoiceStage,
	VoiceSurfaceEvent,
	VoiceTone,
} from "./voice-surface-contracts.js";
import { VoiceSurfacePublisher, VoiceTonePort } from "./voice-surface-ports.js";
import { VoiceSurface } from "./voice-surface-service.js";

const stage = (
	value: VoiceStage,
	keyCode = "1,6",
	captureId = "c1",
): StageEvent => ({
	_tag: "Stage",
	serial: "QK",
	keyCode,
	captureId,
	stage: value,
});

const setup = () => {
	const events: VoiceSurfaceEvent[] = [];
	const tones: VoiceTone[] = [];
	const layer = VoiceSurface.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(VoiceSurfacePublisher, {
					publish: (event) => Effect.sync(() => void events.push(event)),
				}),
				Layer.succeed(VoiceTonePort, {
					play: (_serial, tone) => Effect.sync(() => void tones.push(tone)),
				}),
			),
		),
	);
	return { events, tones, layer };
};

describe("VoiceSurface", () => {
	it.effect(
		"publishes a repeated stage once and keeps the stage before its alert",
		() => {
			const { events, tones, layer } = setup();
			return Effect.gen(function* () {
				const listening = stage({ _tag: "recording", status: "listening" });
				yield* VoiceSurface.publish(listening);
				yield* VoiceSurface.publish(listening);
				yield* VoiceSurface.publish(
					stage({ _tag: "failed", reason: "timeout" }),
				);
				expect(events.map((event) => event._tag)).toEqual([
					"Stage",
					"Stage",
					"KeyAlert",
				]);
				expect(tones).toEqual(["start", "error"]);
			}).pipe(Effect.provide(layer));
		},
	);

	it.effect("tracks the running flow until the same capture ends", () => {
		const { layer } = setup();
		return Effect.gen(function* () {
			yield* VoiceSurface.publish(stage({ _tag: "processing" }));
			expect(yield* VoiceSurface.activeFlow("QK")).toEqual(Option.some("1,6"));
			// A rejected press on another key does not end the flow.
			yield* VoiceSurface.rejectBusy("QK", "1,7");
			expect(yield* VoiceSurface.activeFlow("QK")).toEqual(Option.some("1,6"));
			// An unrelated capture's idle does not end it either.
			yield* VoiceSurface.publish(
				stage({ _tag: "idle", outcome: "completed" }, "1,6", "other"),
			);
			expect(yield* VoiceSurface.activeFlow("QK")).toEqual(Option.some("1,6"));
			yield* VoiceSurface.publish(
				stage({ _tag: "idle", outcome: "completed" }),
			);
			expect(yield* VoiceSurface.activeFlow("QK")).toEqual(Option.none());
		}).pipe(Effect.provide(layer));
	});

	it.effect("replays the last agent status, defaulting to no service", () => {
		const { events, layer } = setup();
		return Effect.gen(function* () {
			expect(yield* VoiceSurface.agentStatus()).toEqual({
				_tag: "AgentStatus",
				state: "noService",
			});
			yield* VoiceSurface.publish({ _tag: "AgentStatus", state: "connected" });
			expect(yield* VoiceSurface.agentStatus()).toEqual({
				_tag: "AgentStatus",
				state: "connected",
			});
			expect(events).toHaveLength(1);
		}).pipe(Effect.provide(layer));
	});

	it.effect("keeps distinct busy rejections distinct", () => {
		const { tones, layer } = setup();
		return Effect.gen(function* () {
			yield* VoiceSurface.rejectBusy("QK", "1,7");
			yield* VoiceSurface.rejectBusy("QK", "1,7");
			expect(tones).toEqual(["busy", "busy"]);
		}).pipe(Effect.provide(layer));
	});
});
