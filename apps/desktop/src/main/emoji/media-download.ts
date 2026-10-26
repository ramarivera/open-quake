import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import type { IncomingMessage } from "node:http";
import { type RequestOptions, request } from "node:https";
import { BlockList, isIP } from "node:net";
import { EmojiInvalid } from "../../../../../packages/edge/src/emoji/emoji-errors";

// Exact result origins shown in Alibaba's Wan image-to-video API reference:
// https://www.alibabacloud.com/help/en/model-studio/legacy-image-to-video-api-reference/
// https://www.alibabacloud.com/help/en/model-studio/text-to-video-api-reference
const origins = new Set([
	"https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com",
	"https://dashscope-result-sh.oss-cn-shanghai.aliyuncs.com",
	"https://dashscope-result-sh.oss-accelerate.aliyuncs.com",
]);
const blocked = new BlockList();
for (const [address, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.88.99.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
] as const)
	blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [
	["2001::", 23],
	["2001:db8::", 32],
	["2002::", 16],
	["3fff::", 20],
] as const)
	blocked.addSubnet(address, prefix, "ipv6");
const isPublic = (address: string): boolean => {
	const family = isIP(address);
	return family === 4
		? !blocked.check(address, "ipv4")
		: family === 6 &&
				globalV6.check(address, "ipv6") &&
				!blocked.check(address, "ipv6");
};
export type MediaLookup = (
	hostname: string,
) => Promise<readonly LookupAddress[]>;
export type MediaRequest = (
	url: URL,
	options: RequestOptions,
	respond: (response: IncomingMessage) => void,
) => {
	once: (event: "error", listener: (cause: Error) => void) => unknown;
	end: () => void;
};

/** No ambient proxy, bearer token, redirect, second DNS lookup or shared socket. */
export async function downloadEmojiVideo(
	rawUrl: string,
	callerSignal: AbortSignal,
	ports: {
		readonly lookup?: MediaLookup | undefined;
		readonly request?: MediaRequest | undefined;
	} = {},
): Promise<Uint8Array> {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new EmojiInvalid("The provider returned an invalid asset URL.");
	}
	if (url.username || url.password || !origins.has(url.origin))
		throw new EmojiInvalid("The provider returned an unapproved media origin.");
	const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(30_000)]);
	signal.throwIfAborted();
	const resolve =
		ports.lookup ??
		((hostname) => lookup(hostname, { all: true, verbatim: true }));
	const response = await new Promise<IncomingMessage>((accept, reject) => {
		const req = (ports.request ?? request)(
			url,
			{
				agent: false,
				signal,
				lookup: (hostname, options, callback) => {
					// Resolve inside the connection hook and pass only these validated addresses
					// to the socket. Validating before a separate fetch would allow DNS rebinding.
					void resolve(hostname).then(
						(addresses) => {
							if (signal.aborted) {
								callback(new EmojiInvalid("Media download cancelled."), "");
								return;
							}
							const first = addresses[0];
							if (
								!first ||
								addresses.some((entry) => !isPublic(entry.address))
							) {
								callback(
									new EmojiInvalid(
										"The media origin resolved to a non-public address.",
									),
									"",
								);
								return;
							}
							callback(
								null,
								options.all ? [...addresses] : first.address,
								first.family,
							);
						},
						() =>
							callback(
								new EmojiInvalid("The media origin could not be resolved."),
								"",
							),
					);
				},
			},
			accept,
		);
		req.once("error", reject);
		req.end();
	});
	const limit = 32 * 1024 * 1024;
	try {
		// Reject every redirect, including redirects back to another approved origin.
		if (
			!response.statusCode ||
			response.statusCode < 200 ||
			response.statusCode >= 300
		)
			throw new EmojiInvalid("The provider media request failed.");
		if (Number(response.headers["content-length"]) > limit)
			throw new EmojiInvalid("The provider result is too large.");
		const chunks: Uint8Array[] = [];
		let size = 0;
		for await (const chunk of response) {
			signal.throwIfAborted();
			if (!(chunk instanceof Uint8Array))
				throw new EmojiInvalid("Invalid media bytes.");
			size += chunk.length;
			if (size > limit)
				throw new EmojiInvalid("The provider result is too large.");
			chunks.push(chunk);
		}
		signal.throwIfAborted();
		return Buffer.concat(chunks);
	} finally {
		response.destroy();
	}
}
