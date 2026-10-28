import { Schema } from "effect";
import {
	SpeechSettingsRequest,
	type SpeechSettingsView,
	SttSettings,
	TtsSettings,
} from "../../../shared/speech";

type ProviderSettings = SttSettings | TtsSettings;
type SaveRequest = Extract<typeof SpeechSettingsRequest.Type, { _tag: "Save" }>;

/** Match main's credential identity without bringing secrets into saved settings. */
export function canReuseSpeechCredential(
	previous: ProviderSettings | undefined,
	current: ProviderSettings | undefined,
	stored: boolean,
): boolean {
	if (!stored || !previous || !current) return false;
	if ((previous.provider ?? "dashscope") !== (current.provider ?? "dashscope"))
		return false;
	if (
		("workspace" in previous ? previous.workspace : undefined) !==
		("workspace" in current ? current.workspace : undefined)
	)
		return false;
	return (
		(previous.provider === "azure"
			? (previous.region ?? "eastasia")
			: "region" in previous
				? previous.region
				: undefined) ===
		(current.provider === "azure"
			? (current.region ?? "eastasia")
			: "region" in current
				? current.region
				: undefined)
	);
}

/** Readiness is advisory; the main process still validates every request. */
export function speechDraftError(
	request: SaveRequest,
	view: SpeechSettingsView,
): string {
	const { settings } = request;
	if (settings.stt && !Schema.is(SttSettings)(settings.stt))
		return "Complete the recognition provider settings before saving.";
	if (settings.tts && !Schema.is(TtsSettings)(settings.tts))
		return "Complete the synthesis provider settings before saving.";
	if (!Schema.is(SpeechSettingsRequest)(request))
		return "Complete the provider settings and all three XFY credential fields before saving.";
	if (
		settings.stt &&
		!request.sttKey &&
		!request.sttXfy &&
		!canReuseSpeechCredential(
			view.settings.stt,
			settings.stt,
			view.sttCredential,
		)
	)
		return "Enter recognition credentials for this provider, workspace and region.";
	if (
		settings.tts &&
		!request.ttsKey &&
		!request.ttsXfy &&
		!canReuseSpeechCredential(
			view.settings.tts,
			settings.tts,
			view.ttsCredential,
		)
	)
		return "Enter synthesis credentials for this provider, workspace and region.";
	return "";
}
