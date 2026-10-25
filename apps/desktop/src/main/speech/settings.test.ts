import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Redacted } from "effect";
import type { CredentialRef } from "../../../../../packages/edge/src/ai/ai-contracts";
import { CredentialVault, MacOsKeychain } from "../credentials/keychain";
import { createSpeechSettings, emptySpeechSettings } from "./settings";

const setup = (failWrite = false) =>
	Effect.gen(function* () {
		const keys = new Map<CredentialRef, Redacted.Redacted<string>>();
		let stored: unknown = emptySpeechSettings;
		let changes = 0;
		const vault = yield* CredentialVault;
		const controller = yield* createSpeechSettings({
			storage: {
				read: async () => stored,
				write: async (value) => {
					if (failWrite) throw new Error("synthetic disk error");
					stored = value;
				},
			},
			credentials: vault,
			changed: Effect.sync(() => {
				changes++;
			}),
		});
		return {
			controller,
			stored: () => stored,
			changes: () => changes,
			vault,
			keys,
		};
	});
const nativeKeys = new Map<CredentialRef, Redacted.Redacted<string>>();
const layer = () =>
	CredentialVault.Default.pipe(
		Layer.provide(
			Layer.succeed(MacOsKeychain, {
				read: async (_service, reference) =>
					Option.fromNullable(nativeKeys.get(reference)),
				write: async (_service, reference, key) => {
					nativeKeys.set(reference, key);
				},
				remove: async (_service, reference) => {
					nativeKeys.delete(reference);
				},
			}),
		),
	);

describe("explicit speech settings and existing credential ownership", () => {
	it.effect(
		"defaults disabled, stores write-only keys in the actual vault, and keeps refs/secrets out of public view",
		() =>
			Effect.gen(function* () {
				const { controller, stored, changes, vault } = yield* setup();
				expect(yield* controller.profiles()).toEqual({ speakAnswers: false });
				const view = yield* controller.request({
					_tag: "Save",
					settings: {
						version: 1,
						speakAnswers: true,
						stt: { workspace: "fixture", region: "cn-beijing" },
						tts: { provider: "openai", voice: "marin", language: "de" },
					},
					sttKey: "synthetic-asr",
					ttsKey: "synthetic-tts",
				});
				expect(view.sttCredential).toBe(true);
				expect(view.ttsCredential).toBe(true);
				expect(changes()).toBe(1);
				expect(JSON.stringify(view)).not.toMatch(
					/synthetic|credentialRef|authGeneration/,
				);
				expect(JSON.stringify(stored())).not.toMatch(
					/synthetic-asr|synthetic-tts/,
				);
				const profiles = yield* controller.profiles();
				expect(profiles.stt?.baseUrl).toBe(
					"wss://fixture.cn-beijing.maas.aliyuncs.com",
				);
				expect(profiles.tts?.baseUrl).toBe("https://api.openai.com/v1");
				if (!profiles.stt) throw new Error("missing STT fixture");
				expect(
					Redacted.value(yield* vault.resolve(profiles.stt.credentialRef, 0)),
				).toBe("synthetic-asr");
				yield* controller.request({
					_tag: "Save",
					settings: { version: 1, speakAnswers: false },
				});
				expect(
					yield* vault
						.resolve(profiles.stt.credentialRef, 0)
						.pipe(Effect.either),
				).toMatchObject({
					_tag: "Left",
					left: { code: "AI.PROVIDER.AUTH_REVOKED" },
				});
			}).pipe(Effect.provide(layer())),
	);
	it.effect(
		"preserves credentials for same destination but requires a new key for workspace/region/provider changes",
		() =>
			Effect.gen(function* () {
				const { controller } = yield* setup();
				const settings = {
					version: 1,
					speakAnswers: false,
					stt: { workspace: "one", region: "cn-beijing" },
				};
				yield* controller.request({
					_tag: "Save",
					settings,
					sttKey: "synthetic-one",
				});
				expect(
					(yield* controller.request({ _tag: "Save", settings })).sttCredential,
				).toBe(true);
				const result = yield* controller
					.request({
						_tag: "Save",
						settings: {
							...settings,
							stt: { workspace: "two", region: "cn-beijing" },
						},
					})
					.pipe(Effect.either);
				expect(result).toMatchObject({
					_tag: "Left",
					left: { code: "AI.PROVIDER.AUTH_REQUIRED" },
				});
				expect((yield* controller.profiles()).stt?.baseUrl).toContain(
					"one.cn-beijing",
				);
			}).pipe(Effect.provide(layer())),
	);
	it.effect(
		"rejects spoofed credential refs and cleans up newly stored credentials on persistence failure",
		() =>
			Effect.gen(function* () {
				const { controller, stored } = yield* setup(true);
				const before = nativeKeys.size;
				const forged = yield* controller
					.request({
						_tag: "Save",
						settings: {
							version: 1,
							speakAnswers: false,
							credentialRef: "forged",
						},
					})
					.pipe(Effect.either);
				expect(forged).toMatchObject({
					_tag: "Left",
					left: { code: "AI.PROVIDER.CONFIG_INVALID" },
				});
				const failed = yield* controller
					.request({
						_tag: "Save",
						settings: {
							version: 1,
							speakAnswers: false,
							tts: { provider: "openai", voice: "marin", language: "en" },
						},
						ttsKey: "synthetic-key",
					})
					.pipe(Effect.either);
				expect(failed).toMatchObject({
					_tag: "Left",
					left: { code: "AI.CREDENTIAL.STORE_FAILED" },
				});
				expect(nativeKeys.size).toBe(before);
				expect(stored()).toEqual(emptySpeechSettings);
			}).pipe(Effect.provide(layer())),
	);
});
