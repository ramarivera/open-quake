import type {
	GeneralPatch,
	GeneralSnapshot,
} from "../../../../../../packages/edge/src/settings/general-contracts";
import type {
	WizardDraft,
	WizardSnapshot,
} from "../../../../../../packages/edge/src/settings/wizard-contracts";
import type { SettingsBackendBridge } from "../../../shared/settings-backend";

export type { GeneralPatch, GeneralSnapshot, WizardDraft, WizardSnapshot };

/** The optional preferences/setup bridge; the renderer never assumes it exists. */
export type SettingsUiBridge = Omit<SettingsBackendBridge, "dispose">;

export function settingsBridge(): SettingsUiBridge | undefined {
	return typeof window === "undefined" ? undefined : window.quakeSettings;
}

export const FAILURE_CODES = [
	"QUAKE.SETTINGS.INVALID",
	"QUAKE.SETTINGS.READ_FAILED",
	"QUAKE.SETTINGS.PERSIST_FAILED",
	"QUAKE.SETTINGS.OS_APPLY_FAILED",
	"QUAKE.WIZARD.INCOMPLETE",
] as const;
export type FailureCode = (typeof FAILURE_CODES)[number];
export const OS_REASONS = [
	"unsupported",
	"denied",
	"timeout",
	"unverified",
	"unavailable",
] as const;
export type OsReason = (typeof OS_REASONS)[number];

/** What the UI may branch on. `unknown` covers transport loss and uncoded errors. */
export type SettingsUiFailure =
	| { readonly code: FailureCode; readonly reason?: OsReason }
	| { readonly code: "unknown" };

const member = <T extends string>(
	values: ReadonlyArray<T>,
	value: unknown,
): value is T => values.some((candidate) => candidate === value);

/** Classifies by catalog code only. Message text is never inspected. */
export function settingsFailure(error: unknown): SettingsUiFailure {
	if (typeof error !== "object" || error === null) return { code: "unknown" };
	const code = "code" in error ? error.code : undefined;
	if (!member(FAILURE_CODES, code)) return { code: "unknown" };
	const reason = "reason" in error ? error.reason : undefined;
	return code === "QUAKE.SETTINGS.OS_APPLY_FAILED" && member(OS_REASONS, reason)
		? { code, reason }
		: { code };
}
