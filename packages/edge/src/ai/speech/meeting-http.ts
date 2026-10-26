import { Effect } from "effect";
import { meetingError } from "../../meetings/meeting-errors.js";
import type { SpeechHttp } from "./speech-ports.js";

export function providerUrl(value: string, base?: string): string {
	const url = new URL(value, base);
	if (
		url.username ||
		url.password ||
		url.hash ||
		(url.protocol !== "https:" &&
			!(
				url.protocol === "http:" &&
				["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
			))
	)
		throw meetingError("Invalid");
	return url.href;
}
export const meetingRequest = (
	http: typeof SpeechHttp.Service,
	url: string,
	init: RequestInit = {},
	timeoutMs = 30000,
) =>
	Effect.tryPromise({
		try: (signal) =>
			http.fetch(providerUrl(url), {
				...init,
				redirect: "error",
				signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
			}),
		catch: (cause) => meetingError("TranscriptionFailed", cause),
	});
export const responseJson = (response: Response) =>
	Effect.tryPromise({
		try: async () => {
			if (!response.ok || !response.body)
				throw meetingError("TranscriptionFailed");
			const reader = response.body.getReader();
			const chunks: Uint8Array[] = [];
			let length = 0;
			try {
				while (true) {
					const part = await reader.read();
					if (part.done) break;
					length += part.value.length;
					if (length > 8_000_000) throw meetingError("TranscriptionFailed");
					chunks.push(part.value);
				}
			} finally {
				await reader.cancel();
			}
			const data = new Uint8Array(length);
			let offset = 0;
			for (const chunk of chunks) {
				data.set(chunk, offset);
				offset += chunk.length;
			}
			return JSON.parse(new TextDecoder().decode(data)) as unknown;
		},
		catch: (cause) => meetingError("TranscriptionFailed", cause),
	});

/** Untrusted result URLs stay on public Alibaba OSS. A deliberately configured
 * loopback provider may only return its own exact origin, for offline providers. */
export const transcriptUrl = (value: string, api: string) =>
	Effect.try({
		try: () => {
			const url = new URL(providerUrl(value));
			const base = new URL(api);
			if (
				base.protocol === "http:" &&
				["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) &&
				url.origin === base.origin
			)
				return url.href;
			// Reject arbitrary DNS names as well as IP literals. This also prevents
			// rebinding through attacker-controlled domains, without a DNS-check/fetch race.
			if (
				url.protocol !== "https:" ||
				url.port ||
				!/^[-a-z0-9]+\.oss-(?:cn-beijing|cn-shanghai|cn-hangzhou|ap-southeast-1|us-east-1|eu-central-1)\.aliyuncs\.com$/.test(
					url.hostname,
				)
			)
				throw meetingError("Invalid");
			return url.href;
		},
		catch: (cause) => meetingError("TranscriptionFailed", cause),
	});

/** Alibaba documents dashscope-file-* OSS buckets for temporary uploads:
 * https://www.alibabacloud.com/help/en/model-studio/get-temporary-file-url */
export const uploadPolicyUrl = (value: string, api: string) =>
	transcriptUrl(value, api).pipe(
		Effect.flatMap((href) => {
			const url = new URL(href);
			if (url.origin === new URL(api).origin && url.protocol === "http:")
				return Effect.succeed(href);
			return /^dashscope-file-[a-z0-9-]+\.oss-/.test(url.hostname) &&
				url.pathname === "/" &&
				!url.search
				? Effect.succeed(href)
				: Effect.fail(meetingError("TranscriptionFailed"));
		}),
	);
