import { runInNewContext } from "node:vm";
import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, TestClock } from "effect";
import { vi } from "vitest";
import { makeAudioOutput } from "../../../../../packages/edge/src/audio/output-service";
import type { ReaderSettings } from "../../shared/voice-surface";
import { audioWorkerSource } from "./audio-worker";
import { localSpeech } from "./local-speech";

vi.mock("electron", () => ({
	app: {},
	BrowserWindow: class {},
	session: {},
	systemPreferences: {},
}));
const settings: ReaderSettings = {
	engine: "webSpeech",
	voiceHint: "Desk",
	rate: 1.4,
	pitch: 0.8,
	volume: 0.6,
};
const target = { kind: "device", serial: "A", keyCode: "1,5" } as const;
class Utterance {
	voice: unknown;
	rate = 1;
	pitch = 1;
	volume = 1;
	onstart = () => {};
	onend = () => {};
	onerror = () => {};
	constructor(readonly text: string) {}
}
interface LocalApi {
	speakLocal(text: string, settings: ReaderSettings): void;
	localState(): { started: boolean; done: boolean; failed: boolean };
	stop(): Promise<void>;
}
function fixture(
	voices = [
		{ name: "Desk voice", lang: "en-US" },
		{ name: "Chinese", lang: "zh-CN" },
	],
) {
	let utterance: Utterance | undefined;
	let cancellations = 0;
	const context = {
		AudioBufferSourceNode: class {},
		SpeechSynthesisUtterance: Utterance,
		speechSynthesis: {
			getVoices: () => voices,
			speak: (u: Utterance) => {
				utterance = u;
			},
			cancel: () => {
				cancellations++;
			},
		},
	};
	const api = runInNewContext(
		`${audioWorkerSource()}; globalThis.__quakeSpeech`,
		context,
	) as LocalApi;
	return {
		api,
		utterance: () => utterance,
		cancellations: () => cancellations,
	};
}

it("KNOB-073 MGMT-301: actual serialized local engine selects voice, clamps settings, waits for start/end and cancels", async () => {
	const f = fixture();
	f.api.speakLocal("synthetic", {
		...settings,
		rate: 99,
		pitch: -5,
		volume: 4,
	});
	expect(f.utterance()).toMatchObject({
		text: "synthetic",
		voice: { name: "Desk voice" },
		rate: 2,
		pitch: 0,
		volume: 1,
	});
	expect(f.api.localState()).toEqual({
		started: false,
		done: false,
		failed: false,
	});
	f.utterance()?.onstart();
	expect(f.api.localState()).toEqual({
		started: true,
		done: false,
		failed: false,
	});
	f.utterance()?.onend();
	expect(f.api.localState().done).toBe(true);
	f.api.speakLocal("second", { ...settings, voiceHint: "" });
	expect(f.utterance()?.voice).toEqual({ name: "Chinese", lang: "zh-CN" });
	await f.api.stop();
	f.utterance()?.onend();
	expect(f.cancellations()).toBe(1);
	expect(f.api.localState().done).toBe(false);
	expect(f.api.localState().failed).toBe(true);
	expect(() => fixture([]).api.speakLocal("missing", settings)).toThrow(
		"Local voice unavailable",
	);
	expect(() =>
		fixture().api.speakLocal("missing hint", {
			...settings,
			voiceHint: "missing",
		}),
	).toThrow("Local voice unavailable");
});

for (const mode of ["drain", "cancel", "timeout"] as const)
	it.scoped(
		`local facade ${mode} owns the explicit device and never fabricates speaking`,
		() =>
			Effect.gen(function* () {
				const ownership = yield* makeAudioOutput;
				const polled = yield* Deferred.make<void>();
				const f = fixture();
				const phases: string[] = [];
				let closed = 0;
				const engine = localSpeech(
					ownership,
					settings,
					target,
					async (_signal, destination) => {
						expect(destination).toEqual(target);
						return {
							invoke: async (method, args) => {
								if (method === "speakLocal") {
									f.api.speakLocal(String(args?.[0]), settings);
									return;
								}
								if (method === "localState") {
									Effect.runSync(Deferred.succeed(polled, undefined));
									return f.api.localState();
								}
								throw new Error("unexpected operation");
							},
							close: async () => {
								closed++;
								await f.api.stop();
							},
						};
					},
				);
				const turn = yield* engine.createSpeech(undefined, "fake", (phase) =>
					Effect.sync(() => phases.push(phase)),
				);
				const playing = yield* turn.result.pipe(Effect.fork);
				yield* Deferred.await(polled);
				yield* Effect.yieldNow().pipe(Effect.repeatN(10));
				expect(phases).toEqual(["thinking"]);
				if (mode === "drain") {
					f.utterance()?.onstart();
					yield* TestClock.adjust(25);
					expect(phases).toEqual(["thinking", "speaking"]);
					f.utterance()?.onend();
					yield* TestClock.adjust(25);
					expect(yield* Fiber.join(playing)).toEqual({ _tag: "completed" });
				} else if (mode === "cancel") {
					yield* turn.cancel();
					expect(yield* Fiber.join(playing)).toEqual({ _tag: "cancelled" });
				} else {
					yield* TestClock.adjust(120000);
					expect(yield* Fiber.join(playing)).toMatchObject({
						_tag: "textOnly",
						error: { code: "AI.PROVIDER.UNAVAILABLE" },
					});
				}
				expect(closed).toBe(1);
			}),
	);
