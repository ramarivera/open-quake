import { Effect, Redacted, Schema, Stream } from "effect";
import type { ModelRow } from "../../../../../packages/edge/src/agents/agents-contracts";
import { CredentialRef } from "../../../../../packages/edge/src/ai/ai-contracts";
import type { AiCredentials } from "../../../../../packages/edge/src/ai/ai-credentials";
import { ChatInference } from "../../../../../packages/edge/src/chat/chat-ports";
import {
	EmojiInvalid,
	EmojiLibraryFailed,
} from "../../../../../packages/edge/src/emoji/emoji-errors";
import { profileFromModel } from "../chat/host";
import type { EmojiGenerationPort } from "./controller";
import {
	downloadEmojiVideo,
	type MediaLookup,
	type MediaRequest,
} from "./media-download";
import { videoToGif } from "./video-to-gif";

const taskResponse = Schema.Struct({
	output: Schema.Struct({
		task_id: Schema.optional(Schema.String),
		task_status: Schema.optional(Schema.String),
		video_url: Schema.optional(Schema.String),
	}),
});
const languages: Readonly<Record<string, string>> = {
	zh: "Chinese",
	en: "English",
	ja: "Japanese",
	ko: "Korean",
	de: "German",
	fr: "French",
	es: "Spanish",
	it: "Italian",
};
export const captionLanguage = (locale: string): string =>
	languages[locale.toLowerCase().split("-")[0] ?? "en"] ?? "English";
export function validateCaptionSuggestion(text: string): string {
	const value = text.trim();
	if (!value || Array.from(value).length > 10 || /[\r\n]/.test(value))
		throw new EmojiInvalid(
			"Caption suggestions must contain one to ten characters.",
		);
	return value;
}
export function createEmojiGeneration(options: {
	readonly models: () => Promise<readonly ModelRow[]>;
	readonly credentials: typeof AiCredentials.Service;
	readonly infer: (
		effect: Effect.Effect<
			string,
			EmojiInvalid | EmojiLibraryFailed,
			ChatInference
		>,
		signal: AbortSignal,
	) => Promise<string>;
	readonly fetch?: typeof globalThis.fetch;
	readonly mediaLookup?: MediaLookup;
	readonly mediaRequest?: MediaRequest;
	readonly decode?: typeof videoToGif;
	readonly endpoint?: string;
	readonly pollMs?: number;
	readonly deadlineMs?: number;
}): EmojiGenerationPort {
	const fetcher = options.fetch ?? globalThis.fetch;
	const endpoint = new URL(
		options.endpoint ?? "https://dashscope.aliyuncs.com/api/v1/",
	);
	if (
		endpoint.protocol !== "https:" &&
		!(
			endpoint.protocol === "http:" &&
			["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)
		)
	)
		throw new EmojiInvalid("Use a secure provider endpoint.");
	const bounded = async <A>(
		signal: AbortSignal | undefined,
		use: (signal: AbortSignal) => Promise<A>,
	): Promise<A> => {
		const deadline = AbortSignal.timeout(options.deadlineMs ?? 300_000);
		const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
		try {
			combined.throwIfAborted();
			return await use(combined);
		} catch (cause) {
			if (cause instanceof EmojiInvalid) throw cause;
			throw new EmojiLibraryFailed(cause);
		}
	};
	const bytes = async (
		response: Response,
		limit: number,
	): Promise<Uint8Array> => {
		if (!response.ok || !response.body)
			throw new EmojiInvalid("The provider request failed.");
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let length = 0;
		try {
			while (true) {
				const chunk = await reader.read();
				if (chunk.done) break;
				length += chunk.value.length;
				if (length > limit)
					throw new EmojiInvalid("The provider result is too large.");
				chunks.push(chunk.value);
			}
		} finally {
			await reader.cancel().catch(() => {});
		}
		return Buffer.concat(chunks);
	};
	return {
		generate: (input) =>
			bounded(input.signal, async (signal) => {
				const row = (await options.models()).find(
					(r) => r.provider === "qwen" && r.credentialRef,
				);
				if (!row)
					throw new EmojiInvalid(
						"Configure a Qwen model and credential before generating motion.",
					);
				const secret = await Effect.runPromise(
					options.credentials.resolve(
						Schema.decodeUnknownSync(CredentialRef)(row.credentialRef),
						0,
					),
					{ signal },
				);
				const headers = {
					Authorization: `Bearer ${Redacted.value(secret)}`,
					"Content-Type": "application/json",
					"X-DashScope-Async": "enable",
				};
				const request = async (path: string, body?: unknown) => {
					const response = await fetcher(new URL(path, endpoint), {
						method: body ? "POST" : "GET",
						headers,
						...(body ? { body: JSON.stringify(body) } : {}),
						signal,
						redirect: "error",
					});
					return Schema.decodeUnknownSync(taskResponse)(
						JSON.parse(
							Buffer.from(await bytes(response, 65536)).toString("utf8"),
						),
					);
				};
				let result = await request(
					"services/aigc/video-generation/video-synthesis",
					{
						model: "wan2.2-i2v-flash",
						input: {
							prompt: input.prompt,
							img_url: `data:${input.format};base64,${Buffer.from(input.bytes).toString("base64")}`,
						},
						parameters: {
							resolution: "480P",
							duration: 5,
							prompt_extend: true,
							watermark: false,
						},
					},
				);
				const id = result.output.task_id;
				if (!id || !/^[a-zA-Z0-9_-]{1,200}$/.test(id))
					throw new EmojiInvalid("The provider returned an invalid task.");
				while (result.output.task_status !== "SUCCEEDED") {
					if (
						["FAILED", "UNKNOWN", "CANCELED"].includes(
							result.output.task_status ?? "",
						)
					)
						throw new EmojiInvalid("Motion generation failed.");
					await new Promise<void>((resolve, reject) => {
						const abort = () => {
							clearTimeout(timer);
							reject(new EmojiInvalid("Generation cancelled."));
						};
						const timer = setTimeout(() => {
							signal.removeEventListener("abort", abort);
							resolve();
						}, options.pollMs ?? 3000);
						signal.addEventListener("abort", abort, { once: true });
						if (signal.aborted) abort();
					});
					result = await request(`tasks/${id}`);
				}
				const video = await downloadEmojiVideo(
					result.output.video_url ?? "",
					signal,
					{
						lookup: options.mediaLookup,
						request: options.mediaRequest,
					},
				);
				return (options.decode ?? videoToGif)(video, signal);
			}),
		suggest: (prompt, locale, signal) =>
			bounded(signal, async (signal) => {
				const row = (await options.models()).find((r) => r.role === "default");
				if (!row?.credentialRef)
					throw new EmojiInvalid(
						"Configure a daily model before requesting a caption.",
					);
				return options.infer(
					Effect.gen(function* () {
						const inference = yield* ChatInference;
						const profile = profileFromModel(row);
						const generation = yield* inference
							.open(profile, {
								profileId: profile.id,
								modelRole: "daily",
								requestedCapabilities: ["text"],
								controls: { thinking: false },
								sampling: {
									temperature: 0.1,
									maxOutputTokens: Math.min(row.maxTokens, 2048),
								},
								messages: [
									{
										role: "system",
										content: [
											{
												_tag: "text",
												text: `Write one funny emoji caption in ${captionLanguage(locale)}. Return only one line of at most 10 Unicode characters. No explanation.`,
											},
										],
									},
									{ role: "user", content: [{ _tag: "text", text: prompt }] },
								],
							})
							.pipe(Effect.mapError((cause) => new EmojiLibraryFailed(cause)));
						let text = "";
						yield* generation.events.pipe(
							Stream.runForEach((event) => {
								if (event._tag === "textDelta") text += event.textDelta;
								return text.length > 128
									? Effect.fail(
											new EmojiInvalid("Caption suggestion is too long."),
										)
									: Effect.void;
							}),
							Effect.mapError((cause) =>
								cause instanceof EmojiInvalid
									? cause
									: new EmojiLibraryFailed(cause),
							),
							Effect.ensuring(generation.cancel()),
						);
						return yield* Effect.try({
							try: () => validateCaptionSuggestion(text),
							catch: (cause) =>
								cause instanceof EmojiInvalid
									? cause
									: new EmojiLibraryFailed(cause),
						});
					}),
					signal,
				);
			}),
	};
}
