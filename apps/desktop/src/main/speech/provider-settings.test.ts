import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Redacted, Schema } from "effect";
import { CredentialRef } from "../../../../../packages/edge/src/ai/ai-contracts";
import {
	AZURE_VOICES,
	azureVoice,
} from "../../../../../packages/edge/src/ai/speech/speech-catalog";
import type { SpeechSettings } from "../../shared/speech";
import { createSpeechSettings } from "./settings";

const fixture = Effect.fn("SpeechSettingsTest.fixture")(function* () {
	let data: unknown;
	let changes = 0;
	const secrets = new Map<string, string>();
	const storage = {
		read: async () => data,
		write: async (value: unknown) => {
			data = value;
		},
	};
	const credentials = {
		store: (key: Redacted.Redacted<string>) =>
			Effect.sync(() => {
				const reference = Schema.decodeUnknownSync(CredentialRef)(
					crypto.randomUUID(),
				);
				secrets.set(reference, Redacted.value(key));
				return { reference, authGeneration: 0 as const };
			}),
		remove: (reference: CredentialRef) =>
			Effect.sync(() => {
				secrets.delete(reference);
			}),
		resolve: (reference: CredentialRef, _generation: number) =>
			Effect.sync(() => Redacted.make(secrets.get(reference) ?? "")),
	};
	const options = {
		storage,
		credentials,
		changed: Effect.sync(() => {
			changes++;
		}),
	};
	const controller = yield* createSpeechSettings(options);
	return {
		controller,
		storage,
		credentials,
		options,
		secrets,
		data: () => data,
		changes: () => changes,
	};
});
describe("secure independent speech settings", () => {
	it.effect(
		"round trips all independent engines, retains settings across restart and never returns secrets or references",
		() =>
			Effect.gen(function* () {
				const f = yield* fixture();
				const configs: SpeechSettings[] = [
					{
						version: 1,
						speakAnswers: true,
						stt: { provider: "openai", language: "de" },
						tts: {
							provider: "azure",
							language: "zh-TW",
							voice: "",
							region: "westus",
						},
					},
					{
						version: 1,
						speakAnswers: false,
						stt: { provider: "azure", language: "en-US" },
						tts: { provider: "xfy", language: "en_us", voice: "aisxping" },
					},
					{
						version: 1,
						speakAnswers: true,
						stt: { provider: "xfy", language: "zh_cn" },
						tts: {
							provider: "qwen-realtime",
							language: "de",
							voice: "Cherry",
							realtimeEnabled: true,
						},
					},
				];
				for (const settings of configs) {
					const request = {
						_tag: "Save",
						settings,
						...(settings.stt?.provider === "xfy"
							? {
									sttXfy: {
										appId: "private-app",
										apiKey: "private-key",
										apiSecret: "private-secret",
									},
								}
							: { sttKey: "private-stt" }),
						...(settings.tts?.provider === "xfy"
							? {
									ttsXfy: {
										appId: "private-tts-app",
										apiKey: "private-tts-key",
										apiSecret: "private-tts-secret",
									},
								}
							: { ttsKey: "private-tts" }),
					};
					const view = yield* f.controller.request(request);
					expect(view).toMatchObject({
						sttCredential: true,
						ttsCredential: true,
					});
					const profiles = yield* f.controller.profiles();
					const rebooted = yield* createSpeechSettings(f.options);
					expect(yield* rebooted.profiles()).toEqual(profiles);
					expect(yield* rebooted.request({ _tag: "Get" })).toEqual(view);
					expect(JSON.stringify(view)).not.toContain("private-");
					expect(JSON.stringify(f.data())).not.toContain("private-");
					expect(JSON.stringify(view)).not.toContain("credentialRef");
					expect(f.secrets.size).toBe(2);
					const saved = yield* f.controller.request({
						_tag: "Save",
						settings: view.settings,
					});
					expect(saved).toEqual(view);
					expect(yield* f.controller.profiles()).toEqual(profiles);
				}
			}),
	);
	it.effect(
		"pins model/language/voice and requires a new speech credential when provider or Azure region changes",
		() =>
			Effect.gen(function* () {
				const f = yield* fixture();
				const settings: SpeechSettings = {
					version: 1,
					speakAnswers: true,
					stt: { provider: "openai", language: "de" },
					tts: {
						provider: "azure",
						language: "en-US",
						voice: "en-US-GuyNeural",
					},
				};
				yield* f.controller.request({
					_tag: "Save",
					settings,
					sttKey: "stt-key",
					ttsKey: "azure-key",
				});
				const first = yield* f.controller.profiles();
				expect(first).toMatchObject({
					stt: { provider: "openai", model: "gpt-transcribe", language: "de" },
					tts: {
						provider: "azure",
						region: "eastasia",
						voice: "en-US-GuyNeural",
						language: "en-US",
					},
				});
				expect(
					yield* f.controller
						.request({
							_tag: "Save",
							settings: {
								...settings,
								tts: {
									provider: "azure",
									region: "westus",
									language: "en-US",
									voice: "en-US-GuyNeural",
								},
							},
						})
						.pipe(Effect.either),
				).toMatchObject({ _tag: "Left", left: { _tag: "AiAuthRequired" } });
				expect(yield* f.controller.profiles()).toEqual(first);
				expect(
					yield* f.controller
						.request({
							_tag: "Save",
							settings: {
								...settings,
								stt: { provider: "azure", language: "en-US" },
							},
						})
						.pipe(Effect.either),
				).toMatchObject({ _tag: "Left", left: { _tag: "AiAuthRequired" } });
			}),
	);
	it.effect(
		"stores all XFY fields in one write-only vault bundle and rejects incomplete credentials without leaking them",
		() =>
			Effect.gen(function* () {
				const f = yield* fixture();
				const settings: SpeechSettings = {
					version: 1,
					speakAnswers: false,
					stt: { provider: "xfy", language: "en_us" },
				};
				const invalid = yield* f.controller
					.request({
						_tag: "Save",
						settings,
						sttXfy: { appId: "private-app", apiKey: "private-key" },
					})
					.pipe(Effect.either);
				expect(invalid).toMatchObject({
					_tag: "Left",
					left: { _tag: "AiConfigInvalid" },
				});
				expect(f.secrets.size).toBe(0);
				expect(JSON.stringify(invalid)).not.toContain("private-app");
				yield* f.controller.request({
					_tag: "Save",
					settings,
					sttXfy: {
						appId: "private-app",
						apiKey: "private-key",
						apiSecret: "private-secret",
					},
				});
				const profile = (yield* f.controller.profiles()).stt;
				expect(profile).toBeDefined();
				expect(JSON.parse([...f.secrets.values()][0] ?? "{}")).toEqual({
					appId: "private-app",
					apiKey: "private-key",
					apiSecret: "private-secret",
				});
				expect(JSON.stringify(f.data())).not.toContain("private-");
			}),
	);
	it.effect(
		"replays latest public profiles on renderer reload and waits for active cleanup before repeated replacement",
		() =>
			Effect.gen(function* () {
				const f = yield* fixture();
				let reset = Effect.void;
				const controller = yield* createSpeechSettings({
					...f.options,
					changed: Effect.suspend(() => reset),
				});
				yield* controller.request({
					_tag: "Save",
					settings: {
						version: 1,
						speakAnswers: false,
						stt: { provider: "openai", language: "en" },
					},
					sttKey: "first",
				});
				const before = yield* controller.request({ _tag: "Get" });
				const closed = yield* Deferred.make<void>();
				reset = Deferred.await(closed);
				const replacing = yield* controller
					.request({
						_tag: "Save",
						settings: {
							version: 1,
							speakAnswers: false,
							stt: { provider: "azure", language: "zh-CN" },
						},
						sttKey: "second",
					})
					.pipe(Effect.fork);
				yield* Effect.yieldNow().pipe(Effect.repeatN(10));
				const waiting = yield* controller.profiles().pipe(Effect.fork);
				expect((yield* Fiber.poll(waiting))._tag).toBe("None");
				yield* Deferred.succeed(closed, undefined);
				const after = yield* Fiber.join(replacing);
				expect(yield* Fiber.join(waiting)).toMatchObject({
					stt: { provider: "azure" },
				});
				expect(after.settings.stt?.provider).toBe("azure");
				expect(before.settings.stt?.provider).toBe("openai");
				reset = Effect.void;
				yield* controller.request({
					_tag: "Save",
					settings: {
						...after.settings,
						stt: { provider: "openai", language: "de" },
					},
					sttKey: "third",
				});
				const reload = yield* createSpeechSettings({
					...f.options,
					changed: Effect.void,
				});
				expect(yield* reload.request({ _tag: "Get" })).toMatchObject({
					settings: { stt: { provider: "openai", language: "de" } },
				});
				expect(f.secrets.size).toBe(1);
			}),
	);
	it.effect(
		"geographic opt-in suggestions never change explicit speech/live translation, including unknown country and restart",
		() =>
			Effect.gen(function* () {
				for (const country of [undefined, "CN", "DE"]) {
					const f = yield* fixture();
					const settings: SpeechSettings = {
						version: 1,
						speakAnswers: false,
						stt: { provider: "openai", language: "de" },
						liveTranslationModel: "explicit-live-model",
						geographicSeed: { ...(country ? { country } : {}) },
					};
					const view = yield* f.controller.request({
						_tag: "Save",
						settings,
						sttKey: "private-key",
					});
					expect(view.settings).toEqual(settings);
					expect(view.regionSuggestion?.provider).toBe(
						country ? (country === "CN" ? "dashscope" : "openai") : undefined,
					);
					const rebooted = yield* createSpeechSettings(f.options);
					expect(yield* rebooted.request({ _tag: "Get" })).toEqual(view);
					expect((yield* rebooted.profiles()).stt?.provider).toBe("openai");
					expect(f.changes()).toBe(1);
				}
			}),
	);
	it("contains every recovered Azure voice and defaults to the first compatible voice", () => {
		expect(Object.values(AZURE_VOICES).map((v) => v.length)).toEqual([4, 9, 3]);
		for (const [language, voices] of Object.entries(AZURE_VOICES)) {
			expect(azureVoice(language)).toBe(voices[0]);
			expect(azureVoice(language, "invalid")).toBe(voices[0]);
			for (const voice of voices)
				expect(azureVoice(language, voice)).toBe(voice);
		}
	});
});
