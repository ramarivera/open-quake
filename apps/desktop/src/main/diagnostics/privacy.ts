import type { Cause } from "effect";
import { ActionErrors } from "../../../../../packages/device/src/actions/action-errors.js";
import {
	DeviceErrors,
	toSafeDiagnosticCause,
} from "../../../../../packages/device/src/device-errors.js";
import { DisplayErrors } from "../../../../../packages/device/src/display/display-errors.js";
import { HardwareErrors } from "../../../../../packages/device/src/hardware/hardware-errors.js";
import { KnobErrors } from "../../../../../packages/device/src/knob/knob-errors.js";
import { LightingErrors } from "../../../../../packages/device/src/lighting/lighting-errors.js";
import { ProfileErrors } from "../../../../../packages/device/src/profiles/profile-errors.js";
import { RuntimeErrors } from "../../../../../packages/edge/src/agent-http/runtime-errors.js";
import { AgentErrors } from "../../../../../packages/edge/src/agents/agents-errors.js";
import { AiErrors } from "../../../../../packages/edge/src/ai/ai-errors.js";
import { SpeechErrors } from "../../../../../packages/edge/src/ai/speech/speech-errors.js";
import { IntegrationErrors } from "../../../../../packages/edge/src/channels/integration-errors.js";
import { ChatErrors } from "../../../../../packages/edge/src/chat/chat-errors";
import { emojiErrors } from "../../../../../packages/edge/src/emoji/emoji-errors.js";
import { MaintenanceErrors } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import { MeetingErrors } from "../../../../../packages/edge/src/meetings/meeting-errors.js";
import { VoiceSurfaceErrors } from "../../../../../packages/edge/src/voice/surface/voice-surface-errors.js";
import { DesktopSpeechErrors } from "../speech/errors.js";
import { knownErrorTags, knownLogEvents, knownSpans } from "./known-names.js";

const sourceCodes = new Set([
	"EACCES",
	"EPERM",
	"EIO",
	"ENODEV",
	"ENOENT",
	"EBUSY",
	"ENOSPC",
	"EMFILE",
	"ENFILE",
	"ECONNREFUSED",
	"ECONNRESET",
	"ETIMEDOUT",
	"ENOTFOUND",
	"EAI_AGAIN",
	"EPIPE",
	"ABORT_ERR",
	"ERR_NETWORK",
	"ERR_TLS_CERT_ALTNAME_INVALID",
	"CERT_HAS_EXPIRED",
	"DEPTH_ZERO_SELF_SIGNED_CERT",
	"UNABLE_TO_VERIFY_LEAF_SIGNATURE",
	"UND_ERR_CONNECT_TIMEOUT",
	"UND_ERR_HEADERS_TIMEOUT",
	"UND_ERR_BODY_TIMEOUT",
	"UND_ERR_SOCKET",
]);

const identities = new Map<string, { code: string; category: string }>(
	[
		DeviceErrors,
		AiErrors,
		ChatErrors,
		SpeechErrors,
		DesktopSpeechErrors,
		RuntimeErrors,
		VoiceSurfaceErrors,
		ActionErrors,
		DisplayErrors,
		HardwareErrors,
		KnobErrors,
		LightingErrors,
		ProfileErrors,
		AgentErrors,
		IntegrationErrors,
		emojiErrors,
		MaintenanceErrors,
		MeetingErrors,
	]
		.flatMap((catalog) => Object.values(catalog))
		.map(({ code, category }) => [code, { code, category }]),
);

export interface SafeError {
	readonly name: string;
	readonly _tag?: string;
	readonly code?: string;
	readonly category?: string;
	readonly sourceCode?: string;
	readonly status?: number;
	readonly cause?: SafeError;
	readonly truncated?: true;
}

/** Read data fields only. Getters, proxies and custom JSON/string renderers aren't trusted. */
function field(input: unknown, key: string): unknown {
	try {
		if (typeof input !== "object" || input === null) return undefined;
		return Object.getOwnPropertyDescriptor(input, key)?.value;
	} catch {
		return undefined;
	}
}

/** Preserve catalog identities and the private original-cause chain without messages or paths. */
export function safeError(input: unknown, depth = 0): SafeError {
	if (depth >= 5) return { name: "TruncatedCause", truncated: true };
	const projected = toSafeDiagnosticCause(input);
	const code = field(input, "code");
	const identity = typeof code === "string" ? identities.get(code) : undefined;
	const sourceCode =
		typeof code === "string" && sourceCodes.has(code)
			? code
			: projected.sourceCode;
	const status = field(input, "status");
	const tag = field(input, "_tag");
	const original = field(input, "originalCause");
	const cause = original === undefined ? field(input, "cause") : original;
	return {
		name: projected.name,
		...identity,
		...(identity && typeof tag === "string" && knownErrorTags.has(tag)
			? { _tag: tag }
			: {}),
		...(sourceCode ? { sourceCode } : {}),
		...(typeof status === "number" &&
		Number.isInteger(status) &&
		status >= 100 &&
		status <= 599
			? { status }
			: {}),
		...(cause === undefined ? {} : { cause: safeError(cause, depth + 1) }),
	};
}

export interface SafeCause {
	readonly kind:
		| "Empty"
		| "Fail"
		| "Die"
		| "Interrupt"
		| "Sequential"
		| "Parallel"
		| "Truncated";
	readonly error?: SafeError;
	readonly left?: SafeCause;
	readonly right?: SafeCause;
}
/** Keep failure topology, including defects and cancellation; cap wide as well as deep causes. */
export function safeCause(cause: Cause.Cause<unknown>): SafeCause {
	let remaining = 24;
	const visit = (current: Cause.Cause<unknown>, depth: number): SafeCause => {
		if (--remaining < 0 || depth >= 8) return { kind: "Truncated" };
		switch (current._tag) {
			case "Empty":
				return { kind: "Empty" };
			case "Fail":
				return { kind: "Fail", error: safeError(current.error) };
			case "Die":
				return { kind: "Die", error: safeError(current.defect) };
			case "Interrupt":
				return { kind: "Interrupt" };
			case "Sequential":
			case "Parallel":
				return {
					kind: current._tag,
					left: visit(current.left, depth + 1),
					right: visit(current.right, depth + 1),
				};
		}
	};
	return visit(cause, 0);
}

export const diagnosticOperations = [
	"app.startup",
	"app.shutdown",
	"app.background",
	"chat.request",
	"voice.request",
	"voice.knob",
	"voice.device",
	"voice.reset",
	"agent.request",
	"agent.connection",
	"agent.conversation",
	"speech.capture",
	"speech.recognize",
	"speech.synthesize",
	"speech.playback",
	"speech.shutdown",
] as const;
export type DiagnosticOperation = (typeof diagnosticOperations)[number];
const operations = new Set<string>(diagnosticOperations);
export const safeSpanName = (name: string): string =>
	knownSpans.has(name) || operations.has(name) ? name : "redacted.span";

export function safeLogEvent(messages: readonly unknown[]): string {
	return (
		messages.find(
			(value): value is string =>
				typeof value === "string" && knownLogEvents.has(value),
		) ?? "effect.log"
	);
}
