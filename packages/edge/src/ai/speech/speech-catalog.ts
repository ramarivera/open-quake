/** Audited AIConfigSettings.vue catalog. Kept pure so settings can import it. */
export const AZURE_VOICES: Readonly<Record<string, readonly string[]>> = {
	"en-US": [
		"en-US-JennyNeural",
		"en-US-GuyNeural",
		"en-US-AriaNeural",
		"en-US-DavisNeural",
	],
	"zh-CN": [
		"zh-CN-XiaoxiaoNeural",
		"zh-CN-YunyangNeural",
		"zh-CN-YunxiNeural",
		"zh-CN-YunjianNeural",
		"zh-CN-HuihuiNeural",
		"zh-CN-XiaoyiNeural",
		"zh-CN-XiaochenNeural",
		"zh-CN-XiaomengNeural",
		"zh-CN-XiaomoNeural",
	],
	"zh-TW": [
		"zh-TW-HsiaoChenNeural",
		"zh-TW-YunJheNeural",
		"zh-TW-HsiaoYuNeural",
	],
};
export function azureVoice(language: string, selected?: string): string {
	const voices = AZURE_VOICES[language] ?? [];
	return selected && voices.includes(selected) ? selected : (voices[0] ?? "");
}
