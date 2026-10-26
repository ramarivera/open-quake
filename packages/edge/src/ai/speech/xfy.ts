import { Clock, Deferred, Effect, Fiber, Schema, type Stream } from "effect";
import {
	AiConfigInvalid,
	type AiError,
	AiProtocolInvalid,
} from "../ai-errors.js";
import { MAX_AUDIO_BYTES, verifiedAudio } from "./speech-audio.js";
import type { SttProfile, TtsProfile } from "./speech-contracts.js";
import type { SpeechWebSocket } from "./speech-ports.js";
import { pcmResampler } from "./speech-resample.js";
import {
	decodeAudio,
	encodeAudio,
	object,
	phase,
	receiveObject,
	sendEvent,
	sendFrames,
	withSocket,
} from "./speech-session.js";
import type { Transcript } from "./speech-stt.js";

const Credentials = Schema.Struct({
	appId: Schema.NonEmptyTrimmedString,
	apiKey: Schema.NonEmptyTrimmedString,
	apiSecret: Schema.NonEmptyTrimmedString,
});
export const xfyCredentials = (secret: string) =>
	Schema.decodeUnknown(Schema.parseJson(Credentials))(secret).pipe(
		Effect.mapError((cause) => new AiConfigInvalid(cause)),
	);
export const signXfy = Effect.fn("Speech.signXfy")(function* (
	url: string,
	credentials: typeof Credentials.Type,
) {
	const target = new URL(url);
	const date = new Date(yield* Clock.currentTimeMillis).toUTCString();
	const content = `host: ${target.host}\ndate: ${date}\nGET ${target.pathname} HTTP/1.1`;
	const signature = yield* Effect.tryPromise({
		try: async () => {
			const key = await crypto.subtle.importKey(
				"raw",
				new TextEncoder().encode(credentials.apiSecret),
				{ name: "HMAC", hash: "SHA-256" },
				false,
				["sign"],
			);
			return new Uint8Array(
				await crypto.subtle.sign(
					"HMAC",
					key,
					new TextEncoder().encode(content),
				),
			);
		},
		catch: (cause) => new AiProtocolInvalid(cause),
	});
	target.searchParams.set(
		"authorization",
		btoa(
			`api_key="${credentials.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${encodeAudio(signature)}"`,
		),
	);
	target.searchParams.set("date", date);
	target.searchParams.set("host", target.host);
	return target.toString();
});
export function recognizeXfy(
	transport: typeof SpeechWebSocket.Service,
	profile: SttProfile,
	secret: string,
	frames: Stream.Stream<Uint8Array, AiError>,
	onTranscript: (t: Transcript) => Effect.Effect<void>,
) {
	return Effect.gen(function* () {
		const auth = yield* xfyCredentials(secret);
		const url = yield* signXfy(profile.baseUrl, auth);
		return yield* withSocket(transport, url, {}, (socket) =>
			Effect.gen(function* () {
				const result = yield* Deferred.make<string, AiError>();
				const segments = new Map<number, string>();
				let finishing = false;
				const reader = Effect.gen(function* () {
					while (true) {
						const event = yield* receiveObject(socket);
						if (event.code !== 0) return yield* new AiProtocolInvalid(event);
						const data = object(event.data),
							revision = object(data.result);
						if (revision.sn !== undefined) {
							if (
								typeof revision.sn !== "number" ||
								!Number.isSafeInteger(revision.sn) ||
								revision.sn < 0 ||
								revision.sn > 3000 ||
								!Array.isArray(revision.ws)
							)
								return yield* new AiProtocolInvalid();
							if (revision.pgs === "rpl") {
								const rg = revision.rg;
								if (
									!Array.isArray(rg) ||
									rg.length !== 2 ||
									typeof rg[0] !== "number" ||
									typeof rg[1] !== "number" ||
									rg[0] < 0 ||
									rg[1] < rg[0] ||
									rg[1] > 3000
								)
									return yield* new AiProtocolInvalid();
								for (const sn of segments.keys())
									if (sn >= rg[0] && sn <= rg[1]) segments.delete(sn);
							}
							let text = "";
							for (const word of revision.ws) {
								const choices = object(word).cw;
								const choice = Array.isArray(choices)
									? object(choices[0]).w
									: undefined;
								if (typeof choice !== "string")
									return yield* new AiProtocolInvalid();
								text += choice;
							}
							segments.set(revision.sn, text);
						}
						const text = [...segments.entries()]
							.sort(([a], [b]) => a - b)
							.map(([, t]) => t)
							.join("");
						if (text.length > 64000) return yield* new AiProtocolInvalid();
						yield* onTranscript({ text, final: data.status === 2 });
						if (data.status === 2) {
							if (!finishing) return yield* new AiProtocolInvalid();
							yield* Deferred.succeed(result, text);
							return;
						}
					}
				});
				const fiber = yield* reader.pipe(
					Effect.catchAll((e) => Deferred.fail(result, e)),
					Effect.forkScoped,
				);
				const convert = pcmResampler(24000, 16000);
				let first = true;
				const send = (audio: Uint8Array) => {
					const status = first ? 0 : 1;
					first = false;
					return sendEvent(socket, {
						...(status === 0
							? {
									common: { app_id: auth.appId },
									business: {
										language: profile.language,
										domain: "iat",
										accent: "mandarin",
										dwa: "wpgs",
									},
								}
							: {}),
						data: {
							status,
							format: "audio/L16;rate=16000",
							encoding: "raw",
							audio: encodeAudio(audio),
						},
					});
				};
				const sender = Effect.gen(function* () {
					const count = yield* sendFrames(frames, (b) => {
						const converted = convert(b);
						return converted.length ? send(converted) : Effect.void;
					});
					if (!count) return "";
					finishing = true;
					return yield* phase(
						Effect.gen(function* () {
							const tail = convert(new Uint8Array(), true);
							if (tail.length) yield* send(tail);
							yield* sendEvent(socket, {
								data: {
									status: 2,
									format: "audio/L16;rate=16000",
									encoding: "raw",
									audio: "",
								},
							});
							return yield* Deferred.await(result);
						}),
						"final",
					);
				});
				const text = yield* Effect.raceFirst(
					sender,
					Deferred.await(result).pipe(Effect.zipRight(Effect.never)),
				);
				yield* Fiber.interrupt(fiber);
				return text;
			}),
		);
	});
}
export function synthesizeXfy(
	transport: typeof SpeechWebSocket.Service,
	profile: TtsProfile,
	secret: string,
	text: string,
	onAudio: () => void,
) {
	return Effect.gen(function* () {
		const auth = yield* xfyCredentials(secret);
		return yield* withSocket(
			transport,
			yield* signXfy(profile.baseUrl, auth),
			{},
			(socket) =>
				Effect.gen(function* () {
					yield* sendEvent(socket, {
						common: { app_id: auth.appId },
						business: {
							aue: "raw",
							auf: "audio/L16;rate=16000",
							vcn: profile.voice,
							tte: "UTF8",
						},
						data: {
							text: encodeAudio(new TextEncoder().encode(text)),
							status: 2,
						},
					});
					const chunks: Uint8Array[] = [];
					const convert = pcmResampler(16000, 24000);
					let length = 0;
					while (true) {
						const event = yield* receiveObject(socket),
							data = object(event.data);
						if (event.code !== 0 || ![0, 1, 2].includes(Number(data.status)))
							return yield* new AiProtocolInvalid(event);
						const raw = yield* decodeAudio(data.audio ?? "");
						if (raw.length % 2) return yield* new AiProtocolInvalid();
						const bytes = convert(raw, data.status === 2);
						length += bytes.length;
						if (length > MAX_AUDIO_BYTES) return yield* new AiProtocolInvalid();
						if (bytes.length) onAudio();
						chunks.push(bytes);
						if (data.status === 2) break;
					}
					const output = new Uint8Array(length);
					let offset = 0;
					for (const c of chunks) {
						output.set(c, offset);
						offset += c.length;
					}
					return yield* verifiedAudio(output, "pcm");
				}),
		);
	});
}
