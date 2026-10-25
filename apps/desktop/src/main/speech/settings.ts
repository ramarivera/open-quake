import { Effect, Either, Redacted, Schema } from "effect";
import { CredentialRef } from "../../../../../packages/edge/src/ai/ai-contracts";
import type { AiError } from "../../../../../packages/edge/src/ai/ai-errors";
import {
	AiAuthRequired,
	AiConfigInvalid,
	AiCredentialStoreFailed,
} from "../../../../../packages/edge/src/ai/ai-errors";
import {
	PCM_24K,
	SttProfile,
	speechInstructions,
	TtsProfile,
} from "../../../../../packages/edge/src/ai/speech/speech-contracts";
import type { JsonStore } from "../../../../../packages/edge/src/channels/channel-contracts";
import {
	SpeechSettings,
	SpeechSettingsRequest,
	type SpeechSettingsView,
} from "../../shared/speech";
import type { CredentialVault } from "../credentials/keychain";
import type { SpeechProfiles } from "./runtime";

const Stored = Schema.Struct({
	version: Schema.Literal(1),
	settings: SpeechSettings,
	stt: Schema.optional(SttProfile),
	tts: Schema.optional(TtsProfile),
	retired: Schema.optional(
		Schema.Array(CredentialRef).pipe(Schema.maxItems(64)),
	),
});
type Stored = typeof Stored.Type;
const initial: Stored = {
	version: 1,
	settings: { version: 1, speakAnswers: false },
};
const host = (workspace: string, region: string) =>
	`${workspace}.${region}.maas.aliyuncs.com`;
export const createSpeechSettings = Effect.fn("DesktopSpeech.settings")(
	function* (options: {
		readonly storage: JsonStore;
		readonly credentials: Pick<CredentialVault, "store" | "remove" | "resolve">;
		/** Cancel active sessions and output before exposing a changed profile. */
		readonly changed: Effect.Effect<void>;
	}) {
		const lock = yield* Effect.makeSemaphore(1);
		const loaded = yield* Effect.tryPromise({
			try: () => options.storage.read(),
			catch: (cause) => new AiConfigInvalid(cause),
		}).pipe(
			Effect.flatMap((raw) =>
				Schema.decodeUnknown(Stored, {
					onExcessProperty: "error",
				})(raw ?? initial).pipe(
					Effect.mapError((cause) => new AiConfigInvalid(cause)),
				),
			),
			Effect.either,
		);
		let loadError = Either.isLeft(loaded) ? loaded.left : undefined;
		let state: Stored = Either.isRight(loaded) ? loaded.right : initial;
		// Keep the saved file untouched until an explicit, validated Save succeeds.
		// A broken profile must neither enable capture nor disable its repair UI.
		if (loadError)
			yield* Effect.logError("Speech initialization failed", loadError);
		const cleanup = Effect.fn("DesktopSpeech.cleanupCredentials")(function* () {
			while (state.retired?.length) {
				const reference = state.retired[0];
				if (!reference) break;
				yield* options.credentials.remove(reference);
				const next = { ...state, retired: state.retired.slice(1) };
				yield* Effect.tryPromise({
					try: () => options.storage.write(next),
					catch: (cause) => new AiCredentialStoreFailed(cause),
				});
				state = next;
			}
		});
		const view = Effect.fn("DesktopSpeech.settingsView")(
			function* (): Effect.fn.Return<SpeechSettingsView> {
				const available = (profile: SttProfile | TtsProfile | undefined) =>
					profile
						? options.credentials
								.resolve(profile.credentialRef, profile.authGeneration)
								.pipe(
									Effect.as(true),
									Effect.orElseSucceed(() => false),
								)
						: Effect.succeed(false);
				return {
					settings: state.settings,
					sttCredential: yield* available(state.stt),
					ttsCredential: yield* available(state.tts),
				};
			},
		);
		return {
			profiles: Effect.fn("DesktopSpeech.profiles")(
				(): Effect.Effect<SpeechProfiles> =>
					Effect.sync(() => ({
						...(state.stt ? { stt: state.stt } : {}),
						...(state.tts ? { tts: state.tts } : {}),
						speakAnswers: state.settings.speakAnswers,
					})),
			),
			request: Effect.fn("DesktopSpeech.configure")(
				(input: unknown): Effect.Effect<SpeechSettingsView, AiError> =>
					lock.withPermits(1)(
						Effect.gen(function* () {
							const request = yield* Schema.decodeUnknown(
								SpeechSettingsRequest,
								{ onExcessProperty: "error" },
							)(input).pipe(
								Effect.mapError((cause) => new AiConfigInvalid(cause)),
							);
							if (request._tag === "Get") {
								if (loadError) return yield* loadError;
								yield* cleanup();
								return yield* view();
							}
							const previous = state;
							const created: Array<SttProfile | TtsProfile> = [];
							const build = Effect.gen(function* () {
								let stt: SttProfile | undefined;
								if (request.settings.stt) {
									const config = request.settings.stt;
									const baseUrl = `wss://${host(config.workspace, config.region)}`;
									const identity = request.sttKey
										? yield* options.credentials.store(
												Redacted.make(request.sttKey),
											)
										: previous.stt?.baseUrl === baseUrl
											? {
													reference: previous.stt.credentialRef,
													authGeneration: previous.stt.authGeneration,
												}
											: undefined;
									if (!identity) return yield* new AiAuthRequired();
									stt = {
										provider: "dashscope",
										baseUrl,
										model: "qwen-audio-3.1-asr-flash-streaming",
										descriptor: PCM_24K,
										credentialRef: identity.reference,
										authGeneration: identity.authGeneration,
									};
									if (request.sttKey) created.push(stt);
								}
								let tts: TtsProfile | undefined;
								if (request.settings.tts) {
									const config = request.settings.tts;
									const baseUrl =
										config.provider === "openai"
											? "https://api.openai.com/v1"
											: `https://${host(config.workspace, config.region)}`;
									const identity = request.ttsKey
										? yield* options.credentials.store(
												Redacted.make(request.ttsKey),
											)
										: previous.tts?.baseUrl === baseUrl &&
												previous.tts.provider === config.provider
											? {
													reference: previous.tts.credentialRef,
													authGeneration: previous.tts.authGeneration,
												}
											: undefined;
									if (!identity) return yield* new AiAuthRequired();
									tts = {
										provider: config.provider,
										baseUrl,
										model:
											config.provider === "openai"
												? "gpt-4o-mini-tts"
												: "qwen-audio-3.1-tts-flash",
										voice: config.voice,
										language: config.language,
										instructions: speechInstructions(config.language),
										format: config.provider === "openai" ? "wav" : "pcm",
										descriptor: PCM_24K,
										credentialRef: identity.reference,
										authGeneration: identity.authGeneration,
									};
									if (request.ttsKey) created.push(tts);
								}
								const retired = [
									...new Set([
										...(previous.retired ?? []),
										...[previous.stt, previous.tts]
											.filter(
												(old) =>
													old &&
													old.credentialRef !== stt?.credentialRef &&
													old.credentialRef !== tts?.credentialRef,
											)
											.map((old) => old?.credentialRef)
											.filter((ref): ref is CredentialRef => ref !== undefined),
									]),
								];
								if (retired.length > 64)
									return yield* new AiCredentialStoreFailed();
								const next: Stored = {
									version: 1,
									retired,
									settings: request.settings,
									...(stt ? { stt } : {}),
									...(tts ? { tts } : {}),
								};
								yield* options.changed;
								yield* Effect.tryPromise({
									try: () => options.storage.write(next),
									catch: (cause) => new AiCredentialStoreFailed(cause),
								});
								state = next;
								loadError = undefined;
							});
							const result = yield* build.pipe(Effect.either);
							if (Either.isLeft(result)) {
								for (const profile of created)
									yield* options.credentials.remove(profile.credentialRef);
								return yield* result.left;
							}
							yield* cleanup();
							return yield* view();
						}),
					),
			),
		};
	},
);
export type SpeechSettingsController = Effect.Effect.Success<
	ReturnType<typeof createSpeechSettings>
>;
export const emptySpeechSettings = initial;
