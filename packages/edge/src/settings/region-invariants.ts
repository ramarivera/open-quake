/** Local advisory defaults. Never resolves credentials or selects a live profile. */
export function regionSuggestions(region: string): {
	provider?: string;
	speech?: string;
} {
	if (!/^[A-Z]{2}$/.test(region)) return {};
	return region === "CN"
		? { provider: "DeepSeek", speech: "QWen" }
		: { provider: "OpenAI", speech: "OpenAI" };
}
export function regionModels(region: string) {
	if (!/^[A-Z]{2}$/.test(region)) return undefined;
	return region === "CN"
		? {
				chat: "deepseek-v4-flash",
				stt: "qwen-audio-3.1-asr-flash-streaming",
				tts: "qwen-audio-3.1-tts-flash",
				liveTranslation: "qwen3.5-livetranslate-flash-realtime",
			}
		: {
				chat: "gpt-5.1",
				stt: "gpt-4o-transcribe",
				tts: "gpt-4o-mini-tts",
				liveTranslation: "gpt-4o-transcribe",
			};
}
