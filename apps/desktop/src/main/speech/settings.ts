import { Effect, Either, Redacted, Schema } from "effect";
import { CredentialRef } from "../../../../../packages/edge/src/ai/ai-contracts";
import type { AiError } from "../../../../../packages/edge/src/ai/ai-errors";
import {
	AiAuthRequired,
	AiConfigInvalid,
	AiCredentialStoreFailed,
} from "../../../../../packages/edge/src/ai/ai-errors";
import {
	SttProfile,
	TtsProfile,
} from "../../../../../packages/edge/src/ai/speech/speech-contracts";
import type { JsonStore } from "../../../../../packages/edge/src/channels/channel-contracts";
import {
	normalizeMicrophone,
	SpeechSettings,
	SpeechSettingsRequest,
	type SpeechSettingsView,
} from "../../shared/speech";
import type { CredentialVault } from "../credentials/keychain";
import {
	normalizeSpeechSettings,
	regionSuggestion,
	sttConfiguration,
	ttsConfiguration,
} from "./profile-settings";
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
					...(regionSuggestion(state.settings)
						? { regionSuggestion: regionSuggestion(state.settings) }
						: {}),
				};
			},
		);
		return {
			hostTones: () => Effect.sync(() => state.settings.hostTones === true),
			microphone: () =>
				Effect.sync(() => normalizeMicrophone(state.settings.defaultMic)),
			profiles: Effect.fn("DesktopSpeech.profiles")(
				(): Effect.Effect<SpeechProfiles> =>
					lock.withPermits(1)(
						Effect.sync(() => ({
							...(state.stt ? { stt: state.stt } : {}),
							...(state.tts ? { tts: state.tts } : {}),
							speakAnswers: state.settings.speakAnswers,
						})),
					),
			),
			request: Effect.fn("DesktopSpeech.configure")(
				(input: unknown): Effect.Effect<SpeechSettingsView, AiError> =>
					lock.withPermits(1)(
						Effect.gen(function* () {
							const decoded = yield* Schema.decodeUnknown(
								SpeechSettingsRequest,
								{ onExcessProperty: "error" },
							)(input).pipe(
								Effect.mapError((cause) => new AiConfigInvalid(cause)),
							);
							if (decoded._tag === "Get") {
								if (loadError) return yield* loadError;
								yield* cleanup();
								return yield* view();
							}
							if (loadError && decoded._tag === "SelectMicrophone")
								return yield* loadError;
							const request =
								decoded._tag === "SelectMicrophone"
									? {
											_tag: "Save" as const,
											sttKey: undefined,
											sttXfy: undefined,
											ttsXfy: undefined,
											ttsKey: undefined,
											settings: {
												...state.settings,
												defaultMic: normalizeMicrophone(decoded.microphone),
											},
										}
									: {
											...decoded,
											settings: {
												...decoded.settings,
												defaultMic: normalizeMicrophone(
													decoded.settings.defaultMic ??
														state.settings.defaultMic,
												),
											},
										};
							const previous = state;
							const created: CredentialRef[] = [];
							const build = Effect.gen(function* () {
								const publicSettings = normalizeSpeechSettings(
									request.settings,
								);
								const buildProfile = <P extends SttProfile | TtsProfile>(
									config: Omit<P, "credentialRef" | "authGeneration">,
									old: P | undefined,
									key: string | undefined,
								) =>
									Effect.gen(function* () {
										const same =
											old?.provider === config.provider &&
											old?.baseUrl === config.baseUrl &&
											old?.region === config.region;
										const identity = key
											? yield* options.credentials.store(Redacted.make(key))
											: same && old
												? {
														reference: old.credentialRef,
														authGeneration: old.authGeneration,
													}
												: undefined;
										if (!identity) return yield* new AiAuthRequired();
										const profile = {
											...config,
											credentialRef: identity.reference,
											authGeneration: identity.authGeneration,
										};
										if (key) created.push(profile.credentialRef);
										return profile;
									});
								const sttSecret =
									publicSettings.stt?.provider === "xfy"
										? request.sttXfy
											? JSON.stringify(request.sttXfy)
											: undefined
										: request.sttKey;
								const ttsSecret =
									publicSettings.tts?.provider === "xfy"
										? request.ttsXfy
											? JSON.stringify(request.ttsXfy)
											: undefined
										: request.ttsKey;
								if (
									(request.sttXfy && publicSettings.stt?.provider !== "xfy") ||
									(request.ttsXfy && publicSettings.tts?.provider !== "xfy") ||
									(request.sttKey && publicSettings.stt?.provider === "xfy") ||
									(request.ttsKey && publicSettings.tts?.provider === "xfy")
								)
									return yield* new AiConfigInvalid();
								const stt = publicSettings.stt
									? yield* buildProfile<SttProfile>(
											sttConfiguration(publicSettings.stt),
											previous.stt,
											sttSecret,
										)
									: undefined;
								const tts = publicSettings.tts
									? yield* buildProfile<TtsProfile>(
											ttsConfiguration(publicSettings.tts),
											previous.tts,
											ttsSecret,
										)
									: undefined;
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
									settings: publicSettings,
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
								for (const reference of created)
									yield* options.credentials.remove(reference);
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
