import { Effect, Layer } from "effect";
import { AiCredentials } from "../../../../../packages/edge/src/ai/ai-credentials";
import type {
	SpeechHttp,
	SpeechOutput,
	SpeechWebSocket,
} from "../../../../../packages/edge/src/ai/speech/speech-ports";
import { AiSpeechService } from "../../../../../packages/edge/src/ai/speech/speech-service";
import type {
	CredentialVault,
	JsonStore,
} from "../../../../../packages/edge/src/channels/channel-contracts";
import type { CaptureDriver } from "./capture";
import { createSpeechCredentials } from "./credentials";
import {
	createElectronCaptureDriver,
	desktopSpeechPorts,
} from "./electron-audio";
import {
	createProductionVoiceRuntime,
	type ProductionVoiceOptions,
} from "./runtime";
import { createSpeechSettings } from "./settings";

export interface DesktopSpeechOptions
	extends Pick<
		ProductionVoiceOptions,
		"sendTranscript" | "sendText" | "cancelText" | "diagnostics" | "speechError"
	> {
	readonly storage: JsonStore;
	/** The existing app-owned safeStorage vault, e.g. systemCredentialVault(userData/credentials). */
	readonly credentials: CredentialVault;
	readonly capture?: CaptureDriver;
	readonly ports?: Layer.Layer<SpeechHttp | SpeechWebSocket | SpeechOutput>;
}
/** Root composition in one acquisition. No provider, window, mic or speaker is opened here. */
export const createDesktopSpeech = Effect.fn("DesktopSpeech.create")(function* (
	options: DesktopSpeechOptions,
) {
	const credentials = yield* createSpeechCredentials(options.credentials);
	const layer = AiSpeechService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(AiCredentials, credentials),
				options.ports ?? desktopSpeechPorts(),
			),
		),
	);
	const speech = yield* AiSpeechService.pipe(
		Effect.provide(
			options.diagnostics
				? layer.pipe(Layer.provideMerge(options.diagnostics.layer))
				: layer,
		),
	);
	let reset: Effect.Effect<void> = Effect.void;
	const settings = yield* createSpeechSettings({
		storage: options.storage,
		credentials,
		changed: Effect.suspend(() => reset),
	});
	const controller = yield* createProductionVoiceRuntime({
		...options,
		speech,
		capture: options.capture ?? createElectronCaptureDriver(),
		profiles: settings.profiles,
	});
	reset = controller.reset();
	return { ...controller, settings };
});
