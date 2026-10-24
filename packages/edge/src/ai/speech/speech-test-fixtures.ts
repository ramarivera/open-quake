import { Effect, Layer, Redacted, Schema } from "effect";
import { CredentialRef } from "../ai-contracts.js";
import { AiCredentials } from "../ai-credentials.js";
import { AiRepository } from "../ai-repository.js";
import { AiProviderService } from "../ai-service.js";
import {
	PCM_24K,
	type SttProfile,
	speechInstructions,
	type TtsProfile,
} from "./speech-contracts.js";
import { SpeechHttp, SpeechOutput } from "./speech-ports.js";
import { AiSpeechService } from "./speech-service.js";

export const ttsProfile: TtsProfile = {
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	model: "gpt-4o-mini-tts",
	voice: "marin",
	language: "de",
	instructions: speechInstructions("de"),
	format: "wav",
	descriptor: PCM_24K,
	credentialRef: Schema.decodeUnknownSync(CredentialRef)(
		"00000000-0000-4000-8000-000000000002",
	),
	authGeneration: 0,
};
export const dashscopeProfile: TtsProfile = {
	...ttsProfile,
	provider: "dashscope",
	baseUrl: "https://fixture.cn-beijing.maas.aliyuncs.com",
	model: "qwen-audio-3.1-tts-flash",
	voice: "longanlingxin_v3.1",
	format: "pcm",
};
export const sttProfile: SttProfile = {
	provider: "dashscope",
	baseUrl: "wss://fixture.cn-beijing.maas.aliyuncs.com",
	model: "qwen-audio-3.1-asr-flash-streaming",
	descriptor: PCM_24K,
	credentialRef: ttsProfile.credentialRef,
	authGeneration: 0,
};
export function wav(): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(1004);
	const view = new DataView(bytes.buffer);
	const chars = (offset: number, value: string) => {
		for (let i = 0; i < value.length; i++)
			view.setUint8(offset + i, value.charCodeAt(i));
	};
	chars(0, "RIFF");
	view.setUint32(4, bytes.length - 8, true);
	chars(8, "WAVEfmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, 24000, true);
	view.setUint32(28, 48000, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	chars(36, "data");
	view.setUint32(40, 960, true);
	return bytes;
}
export function fragmentedResponse(text: string, size = 7): Response {
	const bytes = new TextEncoder().encode(text);
	return new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				for (let i = 0; i < bytes.length; i += size)
					controller.enqueue(bytes.slice(i, i + size));
				controller.close();
			},
		}),
		{ headers: { "Content-Type": "text/event-stream" } },
	);
}
export const speechLayer = (
	http: typeof SpeechHttp.Service,
	output: Omit<typeof SpeechOutput.Service, "suspendForCapture"> &
		Partial<Pick<typeof SpeechOutput.Service, "suspendForCapture">>,
	credentials: typeof AiCredentials.Service = {
		resolve: () => Effect.succeed(Redacted.make("fixture-key")),
		revoked: () => Effect.never,
	},
) =>
	AiProviderService.DefaultWithoutDependencies.pipe(
		Layer.provide(AiRepository.Default),
		Layer.provide(
			AiSpeechService.Default.pipe(
				Layer.provide(
					Layer.mergeAll(
						Layer.succeed(SpeechHttp, http),
						Layer.succeed(SpeechOutput, {
							suspendForCapture: Effect.void,
							...output,
						}),
						Layer.succeed(AiCredentials, credentials),
					),
				),
			),
		),
	);
export const silentOutput: typeof SpeechOutput.Service = {
	suspendForCapture: Effect.void,
	acquire: Effect.succeed({
		ready: Effect.void,
		play: () => Effect.void,
		stop: Effect.void,
	}),
};
