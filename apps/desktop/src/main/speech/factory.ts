import { Effect, Layer } from "effect";
import { AiCredentials } from "../../../../../packages/edge/src/ai/ai-credentials";
import type {
	SpeechHttp,
	SpeechOutput,
	SpeechWebSocket,
} from "../../../../../packages/edge/src/ai/speech/speech-ports";
import { AiSpeechService } from "../../../../../packages/edge/src/ai/speech/speech-service";
import { AudioOutput } from "../../../../../packages/edge/src/audio/output-service";
import type {
	CredentialVault,
	JsonStore,
} from "../../../../../packages/edge/src/channels/channel-contracts";
import { SoundboardRepository } from "../../../../../packages/edge/src/soundboard/soundboard-repository";
import { makeSoundboardService } from "../../../../../packages/edge/src/soundboard/soundboard-service";
import { SoundboardFilesLive } from "../soundboard/files";
import { soundboardKeyActions } from "../soundboard/key-actions";
import { SoundboardPlayerLive } from "../soundboard/player";
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
		| "sendTranscript"
		| "sendText"
		| "cancelText"
		| "diagnostics"
		| "speechError"
		| "pinDirectModel"
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
	const audioOutput = yield* AudioOutput.pipe(
		Effect.provide(AudioOutput.Default),
	);
	yield* Effect.addFinalizer(() => audioOutput.close());
	const soundboard = yield* makeSoundboardService.pipe(
		Effect.provide(SoundboardRepository.Default),
		Effect.provide(SoundboardPlayerLive),
		Effect.provide(SoundboardFilesLive),
		Effect.provideService(AudioOutput, audioOutput),
	);
	const soundboardKeys = soundboardKeyActions(soundboard);
	const credentials = yield* createSpeechCredentials(options.credentials);
	const layer = AiSpeechService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(AiCredentials, credentials),
				options.ports ?? desktopSpeechPorts(audioOutput),
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
	return { ...controller, settings, audioOutput, soundboardKeys };
});
