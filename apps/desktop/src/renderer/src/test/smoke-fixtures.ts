import type { VoiceSurfaceEvent } from "../../../shared/voice-surface";
import type { StripLocale } from "../strip/overlays/voice/strings";
import { keyInfo } from "../strip/overlays/voice/useVoiceSurface";
import {
	initialVoiceView,
	reduceVoice,
	type VoiceView,
} from "../strip/overlays/voice/voice-state";
import { copilotLayout } from "../strip/render-test-fixtures";
import {
	appendHint,
	type ConversationState,
	initialConversation,
} from "../strip/tiles/clawBot/conversation";
export const delay = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));
export const locales: readonly StripLocale[] = [
	"en",
	"zh",
	"de",
	"es",
	"fr",
	"it",
	"ja",
	"ko",
];
export const keys = new Map(
	copilotLayout.tiles.map((t) => [
		t.keyCode,
		{ ...keyInfo(t), voiceInput: true },
	]),
);
export const feed = (view: VoiceView, event: VoiceSurfaceEvent) =>
	reduceVoice(view, { _tag: "event", event }, keys, Date.now());
export const stage = (
	keyCode: string,
	stage: Extract<VoiceSurfaceEvent, { _tag: "Stage" }>["stage"],
): VoiceSurfaceEvent => ({
	_tag: "Stage",
	serial: "QK",
	keyCode,
	captureId: "capture",
	stage,
});
export const rendered = (text: string) =>
	appendHint(initialConversation, { _tag: "literal", text }, Date.now());
export const view = (conversation: ConversationState) => ({
	...initialVoiceView,
	conversation,
});

/** Normalize expected CSS colors using Chromium's serialization, including color-mix. */
export function cssColor(color: string): string {
	const probe = document.createElement("span");
	probe.hidden = true;
	probe.style.backgroundColor = color;
	document.body.append(probe);
	const resolved = getComputedStyle(probe).backgroundColor;
	probe.remove();
	return resolved;
}
