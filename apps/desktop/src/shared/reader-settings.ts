import type { ReaderSettings } from "./voice-surface";

export function readerSettings(
	actions: readonly { readonly type: string; readonly value: unknown }[],
): ReaderSettings {
	const value = (type: string) => actions.find((a) => a.type === type)?.value;
	const number = (type: string, fallback: number, min: number, max: number) => {
		const raw = value(type);
		const n = raw === "" || raw === undefined ? fallback : Number(raw);
		return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
	};
	return {
		engine: value("ttsEngine") === "webSpeech" ? "webSpeech" : "qwen",
		rate: number("ttsRate", 1, 0.5, 2),
		pitch: number("ttsPitch", 1, 0, 2),
		volume: number("ttsVolume", 1, 0, 1),
		voiceHint:
			typeof value("ttsVoice") === "string"
				? String(value("ttsVoice")).slice(0, 128)
				: "",
	};
}
