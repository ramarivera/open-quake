import { Deferred, Duration, Effect, Fiber, Layer, Ref, Schema } from "effect";
import { SessionId, TurnId } from "../../chat/chat-contracts.js";
import {
	type CaptureRequest,
	GridVoiceRuntime,
	type TextRequest,
} from "./voice-surface-ports.js";
import { VoiceSurface } from "./voice-surface-service.js";

/**
 * A scripted voice runtime for OPEN_QUAKE_MOCK_DEVICE=1 and the native
 * smoke. It calls no provider; every reply is labelled as mock. Timings are
 * design.md "Mock runtime".
 */
export const MOCK_TIMING = {
	preparingMs: 300,
	levelMs: 50,
	partialEveryLevels: 8,
	chunkMs: 60,
	maxCaptureMs: 60_000,
} as const;
const PHRASE = ["What's", "the", "weather", "like", "in", "Lisbon", "today?"];
const REPLY = [
	"(mock) ",
	"Lisbon is ",
	"sunny and 22 °C, ",
	"with a light breeze ",
	"from the west. ",
	"Expect clear skies ",
	"through the evening.",
];

/** Deterministic mic envelope: speech-like bursts between 0.05 and ~0.75. */
export const mockLevel = (
	step: number,
): { readonly rms: number; readonly speaking: boolean } => {
	const t = step * (MOCK_TIMING.levelMs / 1000);
	const burst = Math.abs(Math.sin(t * Math.PI * 1.8));
	const flutter = 0.6 + 0.4 * Math.sin(t * Math.PI * 6.2);
	const rms = Math.min(1, 0.05 + 0.7 * burst * flutter);
	return { rms, speaking: rms > 0.12 };
};
export const mockPartial = (step: number): string =>
	PHRASE.slice(
		0,
		Math.min(
			PHRASE.length,
			1 + Math.floor(step / MOCK_TIMING.partialEveryLevels),
		),
	).join(" ");

const uuid = (value: number): string =>
	`00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
const decodeSession = Schema.decodeUnknownSync(SessionId);
const decodeTurn = Schema.decodeUnknownSync(TurnId);

interface Capture {
	readonly keyCode: string;
	readonly generation: number;
	readonly captureId: string;
	readonly released: Deferred.Deferred<void>;
	readonly fiber: Fiber.RuntimeFiber<void>;
}

export const MockVoiceRuntimeLive: Layer.Layer<
	GridVoiceRuntime,
	never,
	VoiceSurface
> = Layer.scoped(
	GridVoiceRuntime,
	Effect.gen(function* () {
		const surface = yield* VoiceSurface;
		const scope = yield* Effect.scope;
		const captures = yield* Ref.make<ReadonlyMap<string, Capture>>(new Map());
		const ids = yield* Ref.make(0);
		const nextId = Ref.updateAndGet(ids, (value) => value + 1);

		const answer = (
			serial: string,
			keyCode: string,
			prompt: string,
			source: "voice" | "typed",
		) =>
			Effect.gen(function* () {
				const sessionId = decodeSession(uuid(yield* nextId));
				const turnId = decodeTurn(uuid(yield* nextId));
				yield* surface.publish({
					_tag: "TurnStarted",
					serial,
					keyCode,
					sessionId,
					turnId,
					prompt,
					source,
					agent: { id: "weather", name: "Weather", icon: "0-1" },
				});
				let seq = 0;
				for (const textDelta of REPLY) {
					yield* Effect.sleep(Duration.millis(MOCK_TIMING.chunkMs));
					yield* surface.publish({
						_tag: "Chunk",
						serial,
						keyCode,
						chunk: {
							version: 1,
							sessionId,
							turnId,
							seq: seq++,
							type: "answer",
							textDelta,
						},
					});
				}
				yield* surface.publish({
					_tag: "Chunk",
					serial,
					keyCode,
					chunk: {
						version: 1,
						sessionId,
						turnId,
						seq,
						type: "end",
						outcome: "completed",
					},
				});
			});

		const script = (
			request: CaptureRequest,
			released: Deferred.Deferred<void>,
		) =>
			Effect.gen(function* () {
				const stage = (stage: Parameters<typeof surface.publish>[0]) =>
					surface.publish(stage);
				const base = {
					_tag: "Stage" as const,
					serial: request.serial,
					keyCode: request.keyCode,
					captureId: request.captureId,
				};
				yield* stage({
					...base,
					stage: { _tag: "recording", status: "preparing" },
				});
				yield* Effect.sleep(Duration.millis(MOCK_TIMING.preparingMs));
				yield* stage({
					...base,
					stage: { _tag: "recording", status: "listening" },
				});
				let step = 0;
				const maxSteps = MOCK_TIMING.maxCaptureMs / MOCK_TIMING.levelMs;
				while (!(yield* Deferred.isDone(released)) && step < maxSteps) {
					yield* Effect.sleep(Duration.millis(MOCK_TIMING.levelMs));
					step++;
					const level = mockLevel(step);
					yield* surface.publish({
						_tag: "Level",
						serial: request.serial,
						keyCode: request.keyCode,
						captureId: request.captureId,
						...level,
					});
					if (step % MOCK_TIMING.partialEveryLevels === 0)
						yield* stage({
							...base,
							stage: {
								_tag: "recording",
								status: "speaking",
								transcript: mockPartial(step),
							},
						});
				}
				const transcript = mockPartial(Math.max(step, 1));
				yield* stage({
					...base,
					stage: { _tag: "processing", transcript },
				});
				yield* answer(request.serial, request.keyCode, transcript, "voice");
				yield* stage({
					...base,
					stage: { _tag: "idle", outcome: "completed" },
				});
			}).pipe(
				Effect.ensuring(
					Ref.update(captures, (map) => {
						const next = new Map(map);
						if (next.get(request.serial)?.released === released)
							next.delete(request.serial);
						return next;
					}),
				),
			);

		const stop = (serial: string, keyCode: string, generation?: number) =>
			Effect.gen(function* () {
				const capture = (yield* Ref.get(captures)).get(serial);
				if (
					!capture ||
					capture.keyCode !== keyCode ||
					(generation !== undefined && capture.generation !== generation)
				)
					return;
				yield* Fiber.interrupt(capture.fiber);
				yield* surface.publish({
					_tag: "Stage",
					serial,
					keyCode: capture.keyCode,
					captureId: capture.captureId,
					stage: { _tag: "idle", outcome: "cancelled" },
				});
			});

		return GridVoiceRuntime.of({
			select: () => Effect.void,
			startCapture: (request) =>
				Effect.gen(function* () {
					const released = yield* Deferred.make<void>();
					const fiber = yield* Effect.forkIn(script(request, released), scope);
					yield* Ref.update(captures, (map) =>
						new Map(map).set(request.serial, {
							keyCode: request.keyCode,
							generation: request.generation,
							captureId: request.captureId,
							released,
							fiber,
						}),
					);
				}),
			releaseCapture: (serial, keyCode, generation) =>
				Effect.gen(function* () {
					const capture = (yield* Ref.get(captures)).get(serial);
					// Late releases from an older generation are ignored (knob-push-to-talk).
					if (
						capture &&
						capture.keyCode === keyCode &&
						capture.generation === generation
					)
						yield* Deferred.succeed(capture.released, undefined);
				}),
			cancelCapture: (serial, keyCode, generation) =>
				stop(serial, keyCode, generation),
			cancelFlow: (serial, keyCode) => stop(serial, keyCode),
			sendText: (request: TextRequest) =>
				Effect.forkIn(
					answer(request.serial, request.keyCode, request.message, "typed"),
					scope,
				).pipe(Effect.asVoid),
		});
	}),
);
