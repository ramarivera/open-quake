import { Either } from "effect";
import { validateAction } from "./action-invariants.js";

const record = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);
export type ActionImportDiagnostic =
	| "next-track-type"
	| "hotkey-placeholder"
	| "empty-text-enter"
	| "unsupported-or-incomplete";
export interface NormalizedActionImport {
	readonly original: unknown;
	readonly normalized: unknown;
	readonly diagnostics: ReadonlyArray<ActionImportDiagnostic>;
}
/** en/zh hotkeyMatching and observingKeys, cited in README.md. */
export const HOTKEY_IMPORT_PLACEHOLDERS = [
	"Please enter hotkeys for matching",
	"Observing the typed keys...",
	"请输入热键进行匹配",
	"正在观察键入的按键...",
] as const;
export interface HotkeyImportSentinels {
	/** Exact translations of hotkeyMatching/observingKeys from the import locale, not fuzzy matches. */
	readonly localizedPlaceholders: ReadonlyArray<string>;
}
/** JSON import boundary. The caller keeps original as compatibility data, never in diagnostics. */
export function normalizeActionImport(
	input: unknown,
	sentinels: HotkeyImportSentinels = { localizedPlaceholders: [] },
): NormalizedActionImport {
	const original: unknown = structuredClone(input);
	const normalized: unknown = structuredClone(input);
	const diagnostics: ActionImportDiagnostic[] = [];
	if (!record(normalized) || !record(normalized.config))
		return { original, normalized, diagnostics: ["unsupported-or-incomplete"] };
	const config = normalized.config;
	const actions = config.actions;
	if (!Array.isArray(actions))
		return { original, normalized, diagnostics: ["unsupported-or-incomplete"] };
	const [first, second] = actions;
	if (
		normalized.childrenName === "skipForward" &&
		config.type === "skipBackward" &&
		actions.length === 1 &&
		record(first) &&
		first.type === "key" &&
		first.value === "audio_next"
	) {
		config.type = "skipForward";
		diagnostics.push("next-track-type");
	}
	if (normalized.childrenName === "hotkey" && config.type === "hotkey") {
		for (const action of actions) {
			if (
				record(action) &&
				action.type === "key" &&
				(action.value === null ||
					action.value === undefined ||
					(typeof action.value === "string" &&
						action.value !== "" &&
						[
							...HOTKEY_IMPORT_PLACEHOLDERS,
							...sentinels.localizedPlaceholders,
						].includes(action.value)))
			) {
				action.value = "";
				diagnostics.push("hotkey-placeholder");
			}
		}
	}
	if (
		normalized.childrenName === "text" &&
		config.type === "text" &&
		actions.length === 2 &&
		record(first) &&
		first.type === "text" &&
		record(second) &&
		Object.keys(second).length === 0
	) {
		config.actions = [first];
		diagnostics.push("empty-text-enter");
	}
	const id =
		typeof normalized.childrenName === "string" ? normalized.childrenName : "";
	if (Either.isLeft(validateAction(id, config)))
		diagnostics.push("unsupported-or-incomplete");
	return { original, normalized, diagnostics };
}
