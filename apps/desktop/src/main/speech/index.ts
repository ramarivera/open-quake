export {
	type CaptureDriver,
	type CaptureSession,
	captureFrames,
} from "./capture";
export { createSpeechCredentials } from "./credentials";
export type { SpeechDiagnostics } from "./diagnostics";
export {
	type AudioWorker,
	createDesktopAudioOutput,
	createElectronCaptureDriver,
	desktopSpeechPorts,
} from "./electron-audio";
export { DesktopSpeechError, DesktopSpeechErrors } from "./errors";
export { createDesktopSpeech, type DesktopSpeechOptions } from "./factory";
export {
	createProductionVoiceRuntime,
	type ProductionVoiceOptions,
	type SpeechProfiles,
} from "./runtime";
export {
	createSpeechSettings,
	emptySpeechSettings,
	type SpeechSettingsController,
} from "./settings";
export { registerSpeechSettings } from "./settings-ipc";
