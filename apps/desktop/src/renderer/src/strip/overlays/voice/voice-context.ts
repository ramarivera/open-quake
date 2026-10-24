import { Option } from "effect";
import { useEffect, useState } from "react";
import type {
	VoiceSurfaceReply,
	VoiceSurfaceRequest,
} from "../../../../../shared/voice-surface";
import { errorCopy } from "../../tiles/clawBot/error-copy";
import type { VoiceText } from "./overlay-state";
import { type StripLocale, type StripStringKey, stripText } from "./strings";
import {
	initialVoiceView,
	type StripToast,
	type VoiceView,
} from "./voice-state";

/** What voice-aware tiles read from the strip; the preview gets an inert copy. */
export interface StripVoiceContext {
	readonly view: VoiceView;
	readonly locale: StripLocale;
	/** The management preview renders no live chat (AI-171). */
	readonly surface: "panel" | "preview";
	readonly motion: "full" | "reduce";
	/** knob model's FunctionWheel: chat cards go opaque while it is open (AI-207). */
	readonly wheelOpen: boolean;
	readonly request: (
		request: VoiceSurfaceRequest,
	) => Promise<VoiceSurfaceReply>;
	readonly toast: (key: StripToast["key"]) => void;
}
export const previewVoiceContext: StripVoiceContext = {
	view: initialVoiceView,
	locale: "en",
	surface: "preview",
	motion: "full",
	wheelOpen: false,
	request: async () => ({ _tag: "rejected", code: "VOICE.SURFACE.PREVIEW" }),
	toast: () => undefined,
};

export function voiceTextString(locale: StripLocale, text: VoiceText): string {
	switch (text._tag) {
		case "transcript":
			return text.text;
		case "string":
			return stripText(locale, text.key);
		case "errorCode": {
			const copy = errorCopy(text.code);
			return copy._tag === "string"
				? stripText(locale, copy.key)
				: stripText(locale, "aiIconViewTxt.errorCodeLine", { code: copy.code });
		}
	}
}

/** The overlay line, with " (3S)" … " (1S)" during an error countdown. */
export function overlayLine(view: VoiceView, locale: StripLocale): string {
	const countdown = view.overlay.countdown;
	if (Option.isSome(countdown))
		return `${voiceTextString(locale, countdown.value.base)} (${countdown.value.remaining}S)`;
	return Option.match(view.overlay.text, {
		onNone: () => stripText(locale, "voiceOverlay.placeholder"),
		onSome: (text) => voiceTextString(locale, text),
	});
}

export const toastText = (
	locale: StripLocale,
	toast: Pick<StripToast, "key" | "name">,
): string =>
	stripText(locale, toast.key satisfies StripStringKey, {
		name: Option.getOrElse(toast.name, () => ""),
	});

const readMotion = (): "full" | "reduce" =>
	document.documentElement.dataset.motion === "reduce" ? "reduce" : "full";

/** The app's motion preference (`useAppearance` sets `data-motion` on the root). */
export function useStripMotion(): "full" | "reduce" {
	const [motion, setMotion] = useState(readMotion);
	useEffect(() => {
		const observer = new MutationObserver(() => setMotion(readMotion()));
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-motion"],
		});
		return () => observer.disconnect();
	}, []);
	return motion;
}
