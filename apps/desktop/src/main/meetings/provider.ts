import { Effect, Layer, Redacted } from "effect";
import type { ModelRow } from "../../../../../packages/edge/src/agents/agents-contracts";
import { AiCompatibleAdapter } from "../../../../../packages/edge/src/ai/adapters/adapter";
import { makeProviderAdapter } from "../../../../../packages/edge/src/ai/adapters/provider-adapter";
import type { AiCredentials } from "../../../../../packages/edge/src/ai/ai-credentials";
import { AiCredentials as Credentials } from "../../../../../packages/edge/src/ai/ai-credentials";
import { AiRepository } from "../../../../../packages/edge/src/ai/ai-repository";
import { AiProviderService } from "../../../../../packages/edge/src/ai/ai-service";
import { AiMeetingAdapter } from "../../../../../packages/edge/src/ai/meeting-adapter";
import { FILETRANS_MODEL } from "../../../../../packages/edge/src/ai/speech/dashscope-filetrans";
import { providerUrl } from "../../../../../packages/edge/src/ai/speech/meeting-http";
import { makeLiveMeetingAdapter } from "../../../../../packages/edge/src/ai/speech/meeting-live";
import type { ResolveMeetingConnection } from "../../../../../packages/edge/src/ai/speech/meeting-resources";
import type { SpeechWebSocket } from "../../../../../packages/edge/src/ai/speech/speech-ports";
import { defaultMeetingConfig } from "../../../../../packages/edge/src/meetings/meeting-defaults";
import { meetingError } from "../../../../../packages/edge/src/meetings/meeting-errors";
import { MeetingProvider } from "../../../../../packages/edge/src/meetings/meeting-provider";
import { profileFromModel } from "../chat/host";
import { desktopWebSocket } from "../speech/websocket";
import { meetingResources } from "./provider-resources";

export interface MeetingProviderOptions {
	readonly models: () => Effect.Effect<
		readonly ModelRow[],
		import("../../../../../packages/edge/src/ai/ai-errors").AiError
	>;
	readonly credentials: typeof AiCredentials.Service;
	readonly fetch?: typeof fetch;
	readonly socket?: typeof SpeechWebSocket.Service;
}
export function liveMeetingProviders(
	root: string,
	ffmpeg: string,
	options: MeetingProviderOptions,
) {
	const profiles = AiRepository.Default;
	const fetcher = options.fetch ?? globalThis.fetch;
	const rows = () =>
		options
			.models()
			.pipe(Effect.mapError((cause) => meetingError("Unavailable", cause)));
	const initialConfig = Effect.gen(function* () {
		const selected = (yield* rows()).find((r) => r.role === "default");
		if (
			!selected ||
			!["qwen", "openai"].includes(selected.provider) ||
			!selected.credentialRef
		)
			return undefined;
		const profile = yield* Effect.try({
			try: () => profileFromModel(selected),
			catch: (cause) => meetingError("Unavailable", cause),
		});
		return {
			...defaultMeetingConfig,
			profileId: profile.id,
			asrProvider:
				selected.provider === "openai"
					? ("openai" as const)
					: ("dashscope" as const),
			asrModel:
				selected.provider === "openai" ? "gpt-realtime-mini" : FILETRANS_MODEL,
			minutesModel: selected.model,
		};
	});
	const adapter = Layer.scoped(
		AiMeetingAdapter,
		Effect.gen(function* () {
			const repository = yield* AiRepository;
			const resolve: ResolveMeetingConnection = (config, translation = false) =>
				Effect.gen(function* () {
					const saved = yield* rows();
					const row = yield* Effect.try({
						try: () =>
							saved.find(
								(candidate) =>
									candidate.credentialRef &&
									profileFromModel(candidate).id === config.profileId,
							),
						catch: (cause) => meetingError("Unavailable", cause),
					});
					if (
						!row ||
						(translation
							? row.provider !== "qwen"
							: row.provider !==
								(config.asrProvider === "openai" ? "openai" : "qwen"))
					)
						return yield* meetingError("Unavailable");
					const profile = yield* Effect.try({
						try: () => profileFromModel(row),
						catch: (cause) => meetingError("Unavailable", cause),
					});
					if (!profile.credentialRef) return yield* meetingError("Unavailable");
					yield* repository
						.put(profile)
						.pipe(
							Effect.mapError((cause) => meetingError("Unavailable", cause)),
						);
					const secret = yield* options.credentials
						.resolve(profile.credentialRef, profile.authGeneration)
						.pipe(
							Effect.mapError((cause) => meetingError("Unavailable", cause)),
						);
					const base = new URL(providerUrl(row.baseUrl));
					const local = ["localhost", "127.0.0.1", "[::1]"].includes(
						base.hostname,
					);
					const qwen = row.provider === "qwen";
					if (
						!local &&
						qwen &&
						!/^dashscope\.(?:aliyuncs\.com|(?:cn-beijing|ap-southeast-1)\.maas\.aliyuncs\.com)$/.test(
							base.hostname,
						)
					)
						return yield* meetingError("Unavailable");
					const api = qwen ? new URL("/api/v1/", base) : new URL("/v1/", base);
					const ws = new URL(
						qwen ? "/api-ws/v1/realtime" : "/v1/realtime",
						base,
					);
					ws.protocol = base.protocol === "http:" ? "ws:" : "wss:";
					if (qwen)
						ws.searchParams.set(
							"model",
							translation ? config.translationModel : config.asrModel,
						);
					else ws.searchParams.set("model", config.asrModel);
					if (
						translation &&
						![
							"qwen3.5-livetranslate-flash-realtime",
							"qwen3-livetranslate-flash-realtime",
						].includes(config.translationModel)
					)
						return yield* meetingError("Unavailable");
					return {
						key: Redacted.value(secret),
						api: api.href,
						files: new URL("/compatible-mode/v1/", base).href,
						realtime: ws.href,
					};
				});
			return yield* makeLiveMeetingAdapter({
				http: { fetch: fetcher },
				socket: options.socket ?? desktopWebSocket,
				resources: meetingResources(root, ffmpeg),
				resolve,
			});
		}),
	).pipe(Layer.provide(profiles));
	const facade = AiProviderService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				adapter,
				profiles,
				Layer.succeed(Credentials, options.credentials),
				Layer.succeed(AiCompatibleAdapter, makeProviderAdapter(fetcher)),
			),
		),
	);
	const layer = MeetingProvider.DefaultWithoutDependencies.pipe(
		Layer.provide(Layer.mergeAll(facade, profiles)),
	);
	return { layer, initialConfig };
}
