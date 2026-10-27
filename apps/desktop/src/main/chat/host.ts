import { createHash } from "node:crypto";
import { isIPv4 } from "node:net";
import { Cause, Effect, Either, Exit, Layer, Option, Schema } from "effect";
import { net } from "electron";
import { AssistantSettings } from "../../../../../packages/device/src/profiles/assistant-contracts";
import type { ModelRow } from "../../../../../packages/edge/src/agents/agents-contracts";
import { resolveModelRows } from "../../../../../packages/edge/src/agents/agents-invariants";
import { AiCompatibleAdapter } from "../../../../../packages/edge/src/ai/adapters/adapter";
import {
	AiFileAdapter,
	makeFileAdapter,
} from "../../../../../packages/edge/src/ai/adapters/files";
import { makeProviderAdapter } from "../../../../../packages/edge/src/ai/adapters/provider-adapter";
import type { SparkConnect } from "../../../../../packages/edge/src/ai/adapters/xfy";
import { AiConnectivity } from "../../../../../packages/edge/src/ai/ai-connectivity";
import {
	CredentialRef,
	type ProfileId,
	type ProviderProfile,
} from "../../../../../packages/edge/src/ai/ai-contracts";
import { AiCredentials } from "../../../../../packages/edge/src/ai/ai-credentials";
import {
	AiAuthRequired,
	AiConfigInvalid,
	type AiError,
	AiUnavailable,
} from "../../../../../packages/edge/src/ai/ai-errors";
import { PublicFileRequest } from "../../../../../packages/edge/src/ai/ai-file-contracts";
import { validateProfile } from "../../../../../packages/edge/src/ai/ai-invariants";
import { AiRepository } from "../../../../../packages/edge/src/ai/ai-repository";
import { ROLE_PRESETS } from "../../../../../packages/edge/src/ai/ai-role-presets";
import {
	AiVoiceService,
	AiVoiceTargets,
} from "../../../../../packages/edge/src/ai/ai-router-service";
import { providerSamplingValid } from "../../../../../packages/edge/src/ai/ai-sampling";
import { AiProviderService } from "../../../../../packages/edge/src/ai/ai-service";
import {
	inferenceProvider,
	localProviderListing,
	modelOptions,
	volcBaseUrl,
} from "../../../../../packages/edge/src/ai/provider-catalog";
import type {
	SessionId,
	TurnId,
} from "../../../../../packages/edge/src/chat/chat-contracts";
import {
	type ChatError,
	ChatInvalid,
} from "../../../../../packages/edge/src/chat/chat-errors";
import { ChatInferenceLive } from "../../../../../packages/edge/src/chat/chat-ports";
import {
	ChatRepository,
	fileChatStorageLayer,
} from "../../../../../packages/edge/src/chat/chat-repository";
import {
	type AssistantSelection,
	type ChatInput,
	ChatRpcFailure,
	type PublicChatHistory,
} from "../../../../../packages/edge/src/chat/chat-rpc";
import { ChatService } from "../../../../../packages/edge/src/chat/chat-service";
import { VoiceKnobRejected } from "../../../../../packages/edge/src/voice/surface/voice-surface-errors";
import type { PinnedDirectModel } from "../../../../../packages/edge/src/voice/surface/voice-surface-ports";
import { reconcileAssistantProvider } from "../../shared/assistant-provider";
import { connectSpark } from "../credentials/spark-socket";
import type { DesktopDiagnostics } from "../diagnostics";
import { prepareDesktopModule } from "../diagnostics/module";
import { type AssistantHaPort, executeAssistantHa } from "./assistant-ha";
import { desktopPersona } from "./persona";
import { shortcutDraft } from "./shortcut-draft";

const OWNER = "desktop-user";
/** Endpoint changes create a different profile. A turn never reads mutable renderer settings. */
export function profileFromModel(row: ModelRow): ProviderProfile {
	return {
		...profileMetadataFromModel(row),
		credentialRef: Schema.decodeUnknownSync(CredentialRef)(row.credentialRef),
	};
}
/** Listing metadata is independent of whether the host has a usable key. */
function profileMetadataFromModel(row: ModelRow): ProviderProfile {
	const hex = createHash("sha256")
		.update(
			JSON.stringify([
				row.id,
				row.provider,
				row.baseUrl,
				row.model,
				row.credentialRef,
				row.settings,
				row.controls,
			]),
		)
		.digest("hex");
	const id =
		`${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}` as ProfileId;
	const selectedProvider = inferenceProvider(row.provider, row.model);
	const baseUrl =
		selectedProvider === "volc" && !row.baseUrl
			? volcBaseUrl(row.settings?.entryMethod ?? "inference")
			: row.baseUrl;
	const url = new URL(baseUrl);
	const loopback =
		url.hostname === "localhost" ||
		url.hostname === "[::1]" ||
		(isIPv4(url.hostname) && url.hostname.startsWith("127."));
	return {
		version: 1,
		id,
		adapter:
			row.settings?.mediaKind && selectedProvider === "qwen"
				? "dashscope-media"
				: selectedProvider === "coze"
					? "coze"
					: selectedProvider === "xfy"
						? "xfy"
						: "openai-compatible",
		baseUrl,
		...(row.settings ? { settings: row.settings } : {}),
		...(row.controls ? { controls: row.controls } : {}),
		...(row.settings?.mediaKind
			? { models: { [row.settings.mediaKind]: row.model } }
			: {}),
		endpointPolicy: loopback ? "loopback" : "remote",
		modelId:
			selectedProvider === "volc"
				? (row.settings?.botId ?? row.model)
				: row.model,
		provider:
			selectedProvider === "openai" ||
			selectedProvider === "qwen" ||
			selectedProvider === "kimi" ||
			selectedProvider === "deepseek" ||
			selectedProvider === "zhipu" ||
			selectedProvider === "groq" ||
			selectedProvider === "volc" ||
			selectedProvider === "coze" ||
			selectedProvider === "xfy"
				? selectedProvider
				: "generic",
		auth: "apiKey",
		authGeneration: 0,
		capabilities: {
			text: "supported",
			tools: "unsupported",
			images: "unsupported",
			imageGeneration:
				row.settings?.mediaKind === "image" && selectedProvider === "qwen"
					? "supported"
					: "unsupported",
			videoGeneration:
				row.settings?.mediaKind === "video" && selectedProvider === "qwen"
					? "supported"
					: "unsupported",
			stt: "unsupported",
			tts: "unsupported",
		},
		sampling: {
			maxOutputTokens: Math.min(row.maxTokens, 65536),
			...(row.temperature === undefined
				? {}
				: { temperature: row.temperature }),
			...(row.topP === undefined ? {} : { topP: row.topP }),
		},
		samplingLimits: {
			maxOutputTokens: Math.min(row.maxTokens, 65536),
			temperature: { min: 0, max: 2 },
			topP: { min: 0, max: 1 },
		},
	};
}
export interface DirectChatOptions {
	readonly directory: string;
	readonly homeAssistant?: AssistantHaPort;
	readonly keySettings?: (
		serial: string,
		keyCode: string,
	) => Effect.Effect<AssistantSettings | undefined, AiError>;
	readonly credentials: typeof AiCredentials.Service;
	readonly models: (
		scope: string,
	) => Effect.Effect<readonly ModelRow[], AiError>;
	readonly diagnostics?: DesktopDiagnostics;
	readonly fetch?: typeof globalThis.fetch;
	readonly online?: () => boolean;
	readonly sparkConnect?: SparkConnect;
}
export const rpcFailure = (error: ChatError | AiError): ChatRpcFailure =>
	new ChatRpcFailure({ code: error.code, message: error.message });
export function prepareDirectChat(options: DirectChatOptions) {
	const persona = desktopPersona(options.directory);
	const visibleConsumers = new Set<symbol>();
	let selection: AssistantSelection | null = null;
	let selectionGeneration = 0;
	const sessionSettings = new Map<SessionId, AssistantSettings>();
	const profiles = AiRepository.Default;
	const inference = ChatInferenceLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(
					AiCompatibleAdapter,
					makeProviderAdapter(
						options.fetch,
						options.sparkConnect ?? connectSpark,
					),
				),
				Layer.succeed(AiCredentials, options.credentials),
				Layer.succeed(AiConnectivity, {
					online: () => Effect.sync(() => options.online?.() ?? net.isOnline()),
				}),
			),
		),
	);
	const providerDependencies = Layer.mergeAll(
		Layer.succeed(
			AiCompatibleAdapter,
			makeProviderAdapter(options.fetch, options.sparkConnect ?? connectSpark),
		),
		Layer.succeed(AiCredentials, options.credentials),
		Layer.succeed(AiFileAdapter, makeFileAdapter(options.fetch)),
		Layer.succeed(AiConnectivity, {
			online: () => Effect.sync(() => options.online?.() ?? net.isOnline()),
		}),
	);
	const facade = AiProviderService.DefaultWithoutDependencies.pipe(
		Layer.provideMerge(profiles),
		Layer.provide(providerDependencies),
	);
	const dependencies = Layer.mergeAll(
		facade,
		profiles,
		inference,
		ChatRepository.Default.pipe(
			Layer.provide(fileChatStorageLayer(options.directory)),
		),
	);

	const prepared = prepareDesktopModule(
		ChatService.DefaultWithoutDependencies.pipe(
			Layer.provideMerge(dependencies),
		),
		(runtime) => {
			const selectionLock = Effect.runSync(Effect.makeSemaphore(1));
			const draftLifetime = new AbortController();
			const drafts = new Set<Promise<string>>();
			let drafting = false;
			let disposal: Promise<void> | undefined;
			const submit = Effect.fn("DesktopChat.submit")(
				(
					input: ChatInput,
					scope = "main",
					pinned?: PinnedDirectModel,
					assistant?: AssistantSettings,
					isCurrent: () => boolean = () => true,
				) =>
					selectionLock.withPermits(1)(
						Effect.gen(function* () {
							const assertCurrent = Effect.suspend(() =>
								isCurrent() ? Effect.void : Effect.fail(new AiUnavailable()),
							);
							const keySettings =
								assistant ?? sessionSettings.get(input.sessionId);
							const requestedSettings =
								keySettings ??
								(scope === "main" ? yield* persona.readSaved() : undefined);
							const savedSettings = requestedSettings
								? yield* Schema.decodeUnknown(AssistantSettings, {
										onExcessProperty: "error",
									})(requestedSettings).pipe(
										Effect.mapError((cause) => new AiConfigInvalid(cause)),
									)
								: undefined;
							const selected =
								pinned ??
								(yield* Effect.gen(function* () {
									const rows = yield* options.models(
										keySettings || savedSettings?.modelRowId
											? "default"
											: scope,
									);
									const eligible = resolveModelRows(rows);
									const saved = savedSettings?.modelRowId
										? eligible.find((r) => r.id === savedSettings.modelRowId)
										: eligible.find((r) => r.role === "default");
									const settings = savedSettings
										? reconcileAssistantProvider(savedSettings, saved)
										: undefined;
									let row =
										saved && settings
											? {
													...saved,
													model: settings.modelId || saved.model,
													controls: {
														thinking: settings.thinking,
														webSearch: settings.webSearch,
													},
													...(providerSamplingValid({
														provider: saved.provider,
														model: settings.modelId || saved.model,
														temperature: settings.temperature,
														topP: settings.topP,
													})
														? {
																temperature: settings.temperature,
																topP: settings.topP,
															}
														: {}),
												}
											: saved;
									if (
										row &&
										settings &&
										!providerSamplingValid({
											provider: row.provider,
											model: row.model,
											temperature: settings.temperature,
											topP: settings.topP,
										})
									) {
										const {
											temperature: _temperature,
											topP: _topP,
											...withoutSampling
										} = row;
										row = withoutSampling;
									}
									if (!row?.model.trim()) return yield* new AiConfigInvalid();
									if (!row.credentialRef) return yield* new AiAuthRequired();
									const profile = yield* Effect.try({
										try: () => profileFromModel(row),
										catch: (cause) => new AiConfigInvalid(cause),
									});
									return { profile, maxTokens: row.maxTokens };
								}));
							const baseProfile = selected.profile;
							const settings =
								savedSettings && pinned
									? reconcileAssistantProvider(savedSettings, {
											provider: baseProfile.provider ?? "generic",
											model: baseProfile.modelId,
										})
									: savedSettings;
							const profile: ProviderProfile =
								settings && pinned
									? {
											...baseProfile,
											controls: {
												thinking: settings.thinking,
												webSearch: settings.webSearch,
											},
											sampling: {
												maxOutputTokens: baseProfile.sampling.maxOutputTokens,
												...(providerSamplingValid({
													provider: baseProfile.provider ?? "generic",
													model: baseProfile.modelId,
													temperature: settings.temperature,
													topP: settings.topP,
												})
													? {
															temperature: settings.temperature,
															topP: settings.topP,
														}
													: {}),
											},
										}
									: baseProfile;
							yield* AiRepository.put(profile);
							const submitChat = (
								beforeInference: Effect.Effect<
									undefined | { readonly answer: string },
									AiError
								> = Effect.succeed(undefined),
							) =>
								ChatService.submit(
									OWNER,
									{
										...input,
										...(settings
											? {
													contextTimeoutSeconds: settings.contextTimeoutSeconds,
													historyCount: settings.chatHistoryCount,
													systemPrompt:
														settings.roleId === -1
															? settings.customPrompt
															: settings.rolePrompt ||
																ROLE_PRESETS.find(
																	(r) => r.id === settings.roleId,
																)?.prompt ||
																"",
												}
											: {}),
										profileId: profile.id,
										modelId: profile.modelId,
										authGeneration: profile.authGeneration,
										mode: "normal",
										contextWindowTokens: 8192,
										// The model setting is an upper bound. Until context metadata is
										// available, reserve at most 1024 inside the conservative 8192 window.
										outputReserveTokens: Math.min(selected.maxTokens, 1024),
									},
									beforeInference,
								);
							if (!settings?.useAgent) return yield* submitChat();
							// Classification may select chat. Unsupported host actions fail explicitly;
							// classification cannot grant device or Home Assistant permissions.
							const routedProfile = {
								...profile,
								models: { ...profile.models, routing: profile.modelId },
							};
							const repository = AiRepository.make({
								get: (id) =>
									Effect.succeed(
										id === routedProfile.id
											? Option.some(routedProfile)
											: Option.none(),
									),
								put: () => Effect.fail(new AiConfigInvalid()),
							});
							const providerLayer =
								AiProviderService.DefaultWithoutDependencies.pipe(
									Layer.provide(
										Layer.mergeAll(
											Layer.succeed(AiRepository, repository),
											providerDependencies,
										),
									),
								);
							return yield* submitChat(
								Effect.gen(function* () {
									const providers = yield* AiProviderService;
									let actionResult: { readonly answer: string } | undefined;
									yield* AiVoiceService.submit({
										requestId: input.turnId,
										profileId: profile.id,
										text: input.text,
										mode: "auto",
										homeAssistantEnabled:
											settings.homeAssistantControl &&
											Boolean(options.homeAssistant),
									})
										.pipe(
											Effect.provide(
												AiVoiceService.DefaultWithoutDependencies.pipe(
													Layer.provide(
														Layer.mergeAll(
															Layer.succeed(AiProviderService, providers),
															Layer.succeed(AiRepository, repository),
														),
													),
													Layer.provide(
														Layer.succeed(AiVoiceTargets, {
															dispatch: Effect.fn("DesktopAssistant.dispatch")(
																function* (dispatch) {
																	if (dispatch.route === "normal")
																		return { operationId: input.turnId };
																	if (dispatch.route !== "operateEquipment")
																		return yield* new AiUnavailable();
																	actionResult = yield* executeAssistantHa(
																		options.homeAssistant,
																		settings,
																		profile.id,
																		input.text,
																		isCurrent,
																	).pipe(
																		Effect.provideService(
																			AiProviderService,
																			providers,
																		),
																	);
																	return { operationId: input.turnId };
																},
															),
														}),
													),
												),
											),
										)
										.pipe(Effect.asVoid, Effect.zipLeft(assertCurrent));
									return actionResult;
								}).pipe(Effect.provide(providerLayer)),
							);
						}),
					),
			);
			const publicHistory = (
				history: { readonly owner: string } & PublicChatHistory,
			): PublicChatHistory => {
				const { owner: _owner, ...value } = history;
				return value;
			};
			return {
				runtime,
				persona: {
					read: (generation?: number | null) =>
						Effect.gen(function* () {
							if (
								generation !== undefined &&
								generation !== (selection?.generation ?? null)
							)
								return yield* new ChatInvalid();
							const settings =
								selection && sessionSettings.get(selection.sessionId);
							return settings ?? (yield* persona.read());
						}),
					update: Effect.fn("DesktopChat.updatePersona")(function* (
						input: AssistantSettings,
						generation: number | null = null,
					) {
						// A draft can only update the selection that supplied it. Selected
						// edits are session-local; the saved key remains the restart source.
						if ((selection?.generation ?? null) !== generation)
							return yield* new ChatInvalid();
						const destination = selection;
						if (!destination) return yield* persona.update(input);
						const saved = yield* Schema.decodeUnknown(AssistantSettings, {
							onExcessProperty: "error",
						})(input).pipe(
							Effect.mapError((cause) => new AiConfigInvalid(cause)),
						);
						if (
							selection?.generation !== generation ||
							!sessionSettings.has(destination.sessionId)
						)
							return yield* new ChatInvalid();
						sessionSettings.set(destination.sessionId, saved);
						selection = { ...destination, settings: saved };
						return saved;
					}),
				},
				assistantVisible: () => Effect.sync(() => visibleConsumers.size > 0),
				assistantVisibility: (owner: symbol, visible: boolean) =>
					Effect.sync(() => {
						if (visible) visibleConsumers.add(owner);
						else visibleConsumers.delete(owner);
					}),
				selection: () => Effect.sync(() => selection),
				selectAssistant: (
					sessionId: SessionId,
					settings: AssistantSettings,
					transcript?: string,
				) =>
					Effect.sync(() => {
						sessionSettings.delete(sessionId);
						sessionSettings.set(sessionId, settings);
						while (sessionSettings.size > 32) {
							const first = sessionSettings.keys().next();
							if (!first.done) sessionSettings.delete(first.value);
						}
						selection = {
							generation: ++selectionGeneration,
							sessionId,
							settings,
							...(transcript === undefined ? {} : { transcript }),
						};
					}),
				acknowledgeSelection: (generation: number) =>
					Effect.sync(() => {
						if (
							selection?.generation === generation &&
							selection.transcript !== undefined
						) {
							const { transcript: _, ...current } = selection;
							selection = current;
						}
					}),
				preflight: () =>
					Effect.suspend(() =>
						(options.online?.() ?? net.isOnline())
							? Effect.void
							: Effect.fail(new AiUnavailable()),
					),
				providers: Effect.fn("DesktopChat.providers")(function* () {
					const rows = yield* options.models("default");
					return yield* Effect.forEach(rows, (row) =>
						Effect.gen(function* () {
							const parsed = Either.try(() => profileMetadataFromModel(row));
							if (
								Either.isLeft(parsed) ||
								Either.isLeft(validateProfile(parsed.right))
							)
								return {
									id: row.id,
									provider: row.provider,
									modelId: row.model,
									available: false,
									directCapable: false,
									state: "invalid" as const,
									options: modelOptions(row.provider, [row.model]),
								};
							const reference = Schema.decodeUnknownEither(CredentialRef)(
								row.credentialRef,
							);
							const profile = {
								...parsed.right,
								...(Either.isRight(reference)
									? { credentialRef: reference.right }
									: {}),
							};
							const listing = localProviderListing(
								[profile],
								["openai-compatible", "coze", "xfy", "dashscope-media"],
							)[0];
							if (!listing) return yield* new AiConfigInvalid();
							const ready = profile.credentialRef
								? yield* Effect.isSuccess(
										options.credentials.resolve(
											profile.credentialRef,
											profile.authGeneration,
										),
									)
								: false;
							return {
								...listing,
								id: row.id,
								available: listing.available && ready,
								state: ready ? ("ready" as const) : ("needs-key" as const),
								directCapable:
									listing.directCapable &&
									ready &&
									resolveModelRows([row]).length === 1,
							};
						}),
					);
				}),
				file: Effect.fn("DesktopChat.file")(function* (
					input: unknown,
					ownedProfileId: ProfileId,
				) {
					const request = yield* Schema.decodeUnknown(PublicFileRequest, {
						onExcessProperty: "error",
					})(input).pipe(
						Effect.mapError((cause) => new AiConfigInvalid(cause)),
					);
					const rows = yield* options.models("default");
					const row = rows.find((row) => row.id === request.modelRowId);
					if (!row) return yield* new AiConfigInvalid();
					const profile = yield* Effect.try({
						try: () => profileFromModel(row),
						catch: (cause) => new AiConfigInvalid(cause),
					});
					if (profile.id !== ownedProfileId)
						return yield* new AiConfigInvalid();
					return yield* AiProviderService.file({
						requestId: request.requestId,
						profileId: profile.id,
						operation: request.operation,
					});
				}),
				submit,
				keySettings: (serial: string, keyCode: string) =>
					options.keySettings?.(serial, keyCode) ?? Effect.succeed(undefined),
				pinKnobModel: Effect.fn("DesktopChat.pinKnobModel")(function* (
					providerId: string,
					modelId: string,
					assistant?: AssistantSettings,
				): Effect.fn.Return<PinnedDirectModel, VoiceKnobRejected> {
					const rows = yield* options
						.models("default")
						.pipe(
							Effect.mapError(
								(cause) => new VoiceKnobRejected("RouteIncomplete", cause),
							),
						);
					const eligible = resolveModelRows(rows);
					const followed = assistant && !assistant.modelRowId;
					const provider = followed
						? eligible.find((r) => r.role === "default")?.id
						: assistant?.modelRowId || providerId;
					const matches = eligible.filter((r) => r.id === provider);
					const row = matches.length === 1 ? matches[0] : undefined;
					if (!row?.model.trim() || !row.credentialRef)
						return yield* new VoiceKnobRejected("RouteIncomplete");
					const settings = assistant
						? reconcileAssistantProvider(assistant, row)
						: undefined;
					const model = settings ? settings.modelId || row.model : modelId;
					if (!model.trim() || model.length > 200)
						return yield* new VoiceKnobRejected("RouteIncomplete");
					const profile = yield* Effect.try({
						try: () => profileFromModel({ ...row, model }),
						catch: (cause) => new VoiceKnobRejected("RouteIncomplete", cause),
					});
					if (Either.isLeft(validateProfile(profile)) || !profile.credentialRef)
						return yield* new VoiceKnobRejected("RouteIncomplete");
					yield* options.credentials
						.resolve(profile.credentialRef, profile.authGeneration)
						.pipe(
							Effect.mapError(
								(cause) => new VoiceKnobRejected("RouteIncomplete", cause),
							),
						);
					return { profile, maxTokens: row.maxTokens };
				}),
				draftShortcuts: (
					request: string,
					signal?: AbortSignal,
				): Promise<string> => {
					const operation = runtime
						.runPromiseExit(
							Effect.acquireUseRelease(
								Effect.suspend(() => {
									if (drafting || draftLifetime.signal.aborted)
										return Effect.fail(new AiUnavailable());
									drafting = true;
									return Effect.void;
								}),
								() => shortcutDraft(request, options.models, profileFromModel),
								() =>
									Effect.sync(() => {
										drafting = false;
									}),
							),
							{
								signal: signal
									? AbortSignal.any([signal, draftLifetime.signal])
									: draftLifetime.signal,
							},
						)
						.then((result) => {
							if (Exit.isFailure(result)) throw Cause.squash(result.cause);
							return result.value;
						});
					drafts.add(operation);
					void operation
						.finally(() => drafts.delete(operation))
						.catch(() => {});
					return operation;
				},
				subscribe: Effect.fn("DesktopChat.subscribe")(
					(sessionId: SessionId, turnId: TurnId) =>
						ChatService.subscribe(OWNER, sessionId, turnId),
				),
				snapshot: Effect.fn("DesktopChat.snapshot")(
					(sessionId: SessionId, turnId: TurnId) =>
						ChatService.snapshot(OWNER, sessionId, turnId),
				),
				cancel: Effect.fn("DesktopChat.cancel")(
					(sessionId: SessionId, turnId: TurnId) =>
						ChatService.cancel(OWNER, sessionId, turnId),
				),
				close: Effect.fn("DesktopChat.close")((sessionId: SessionId) =>
					ChatService.close(OWNER, sessionId),
				),
				clear: Effect.fn("DesktopChat.clear")((sessionId: SessionId) =>
					ChatService.clear(OWNER, sessionId),
				),
				rename: Effect.fn("DesktopChat.rename")(
					(sessionId: SessionId, title: string) =>
						ChatService.rename(OWNER, sessionId, title),
				),
				history: Effect.fn("DesktopChat.history")((sessionId: SessionId) =>
					ChatService.history(OWNER, sessionId).pipe(Effect.map(publicHistory)),
				),
				list: Effect.fn("DesktopChat.list")(() =>
					ChatService.list(OWNER).pipe(
						Effect.map((items) => items.map(publicHistory)),
					),
				),
				dispose: () => {
					if (disposal) return disposal;
					draftLifetime.abort();
					disposal = Promise.allSettled([...drafts]).then(() =>
						runtime.dispose(),
					);
					return disposal;
				},
			};
		},
		options.diagnostics,
		"chat.request",
	);
	return prepared;
}

export function createDirectChat(
	...args: Parameters<typeof prepareDirectChat>
) {
	return prepareDirectChat(...args).standalone();
}
export type DirectChat = ReturnType<typeof createDirectChat>;
