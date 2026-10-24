import type { StripStringKey } from "../../overlays/voice/strings";

/**
 * Error copy for chat and voice failures (QBV:1095-1166, AI-167). DK's
 * numeric codes arrive as strings; open-quake catalog codes map onto the
 * nearest DK message. 4001, 4003 and 2014 are DecoKee account errors (out of
 * scope) and use the generic chat failure.
 */
/** A Map keeps `__proto__` and friends inert. */
const COPY: ReadonlyMap<string, StripStringKey> = new Map<
	string,
	StripStringKey
>([
	["1401", "quakeBotIconView.sttErrorUnauthorized"],
	["2003", "quakeBotIconView.sttErrorGeneric"],
	["1003", "quakeBotIconView.sttErrorNoAudioCapture"],
	["1002", "quakeBotIconView.sttErrorInvalidUserInput"],
	["3005", "quakeBotIconView.voiceStartFailed"],
	["2009", "quakeBotIconView.communicationCancelled"],
	["2010", "quakeBotIconView.openClawNotConnected"],
	["2011", "quakeBotIconView.sendChatFailed"],
	["2012", "quakeBotIconView.chatFailed"],
	["2013", "quakeBotIconView.chatResponseError"],
	["4001", "quakeBotIconView.chatFailed"],
	["4003", "quakeBotIconView.chatFailed"],
	["2014", "quakeBotIconView.chatFailed"],
	["VOICE.GRID.RUNTIME_UNAVAILABLE", "quakeBotIconView.voiceStartFailed"],
	["VOICE.KNOB.ROUTE_UNAVAILABLE", "quakeBotIconView.voiceStartFailed"],
	["VOICE.CAPTURE.PHASE_TIMEOUT", "quakeBotIconView.sttErrorNoAudioCapture"],
	["CHAT.RESPONSE.TIMEOUT", "quakeBotIconView.chatResponseError"],
	["CHAT.SESSION.BUSY", "quakeBotIconView.chatFailed"],
	["CHAT.TURN.CANCELLED", "quakeBotIconView.communicationCancelled"],
	["AI.PROVIDER.UNAVAILABLE", "quakeBotIconView.chatFailed"],
	["AI.PROVIDER.RATE_LIMITED", "quakeBotIconView.chatFailed"],
	["AI.PROVIDER.AUTH_REQUIRED", "quakeBotIconView.sttErrorUnauthorized"],
	["AI.PROVIDER.AUTH_REVOKED", "quakeBotIconView.sttErrorUnauthorized"],
	["AI.PROVIDER.PROTOCOL_INVALID", "quakeBotIconView.chatResponseError"],
]);
/** These render as System hints rather than agent bubbles (QBV:1095-1112). */
const HINTS: ReadonlySet<StripStringKey> = new Set([
	"quakeBotIconView.communicationCancelled",
	"quakeBotIconView.openClawNotConnected",
	"quakeBotIconView.sendChatFailed",
	"quakeBotIconView.chatFailed",
	"quakeBotIconView.chatResponseError",
]);

export type ErrorCopy =
	| { readonly _tag: "string"; readonly key: StripStringKey }
	| { readonly _tag: "errorCode"; readonly code: string };

export function errorCopy(code: string): ErrorCopy {
	const key = COPY.get(code);
	return key === undefined
		? { _tag: "errorCode", code }
		: { _tag: "string", key };
}
export const isHintCopy = (copy: ErrorCopy): boolean =>
	copy._tag === "string" && HINTS.has(copy.key);
