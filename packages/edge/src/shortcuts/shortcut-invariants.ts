import { Schema } from "effect";
import {
	HOTKEY_KEYS,
	HOTKEY_MODIFIERS,
	isHotkeyChord,
} from "../../../device/src/actions/action-contracts.js";
import { findAction } from "../../../device/src/actions/action-registry.js";
import {
	ProfileAction,
	ProfileJson,
} from "../../../device/src/profiles/profile-contracts.js";
import { InputRejected } from "../channels/integration-errors.js";
import {
	type DraftResult,
	GeneratedConfig,
	ShortcutConfig,
	type ShortcutRow,
} from "./shortcut-contracts.js";

const aliases: Readonly<Record<string, string>> = {
	ctrl: "control",
	win: "meta",
	cmd: "command",
	super: "meta",
	right_super: "right_meta",
};
const modifiers = [
	"control",
	"right_control",
	"shift",
	"right_shift",
	"alt",
	"right_alt",
	"meta",
	"right_meta",
	"command",
	"right_command",
];
export const executableChord = (chord: string) =>
	chord
		.split("+")
		.map((t) =>
			t === "meta" ? "super" : t === "right_meta" ? "right_super" : t,
		)
		.join("+");
export function normalizeChord(input: string): string {
	const tokens = input
		.toLowerCase()
		.split("+")
		.map((t) => t.trim())
		.map((t) => aliases[t] ?? t);
	const key = tokens.at(-1);
	const mods = tokens.slice(0, -1);
	const invalid = tokens.find(
		(t) =>
			!HOTKEY_KEYS.includes(t) &&
			!HOTKEY_MODIFIERS.some((m) => m === t) &&
			!modifiers.includes(t),
	);
	if (invalid)
		throw new InputRejected(
			undefined,
			`Unsupported key: ${invalid.slice(0, 30)}`,
		);
	if (
		!key ||
		mods.some((m) => !modifiers.includes(m)) ||
		new Set(tokens).size !== tokens.length
	)
		throw new InputRejected(undefined, "Shortcut");
	const chord = [...modifiers.filter((m) => mods.includes(m)), key].join("+");
	if (!isHotkeyChord(executableChord(chord)))
		throw new InputRejected(undefined, "Shortcut");
	return chord;
}
export const displayChord = (chord: string): readonly string[] =>
	chord
		.split("+")
		.filter(Boolean)
		.map(
			(t) =>
				({
					control: "Ctrl",
					shift: "Shift",
					alt: "Alt",
					meta: "Win",
					command: "Cmd",
				})[t] ?? t.toUpperCase(),
		);
export function decodeDraft(
	text: string,
	app: string,
	id: () => string,
): DraftResult {
	try {
		const first = text.indexOf("{");
		const last = text.lastIndexOf("}");
		if (first < 0 || last < first) throw new InputRejected();
		const parsed: unknown = JSON.parse(text.slice(first, last + 1));
		const decoded = Schema.decodeUnknownSync(GeneratedConfig)(parsed);
		const rows: ShortcutRow[] = [];
		let dropped = 0;
		for (const [index, item] of decoded.ConfigData.entries()) {
			try {
				let config = Schema.decodeUnknownSync(ShortcutConfig)({
					type: item.config.functionType,
					actions: item.config.actions.map((raw) => {
						const action = Schema.decodeUnknownSync(
							Schema.Union(
								ProfileAction,
								Schema.Struct({
									operationName: Schema.String,
									operationValue: ProfileJson,
								}),
							),
						)(raw);
						return "type" in action
							? action
							: { type: action.operationName, value: action.operationValue };
					}),
					...(item.config.subActions
						? { subActions: item.config.subActions }
						: {}),
				});
				if (config.type === "hotkey" || config.type === "hotkeySwitch") {
					config = {
						...config,
						actions: config.actions.map((action) =>
							action.type === "key" && typeof action.value === "string"
								? {
										...action,
										value: executableChord(normalizeChord(action.value)),
									}
								: action,
						),
					};
				}
				validateShortcutConfig(config);
				const first = config.actions.find((a) => a.type === "key");
				const chord =
					config.type === "hotkey" && typeof first?.value === "string"
						? normalizeChord(first.value)
						: "";
				rows.push({
					id: id(),
					name: item.title.trim() || `Shortcut ${index + 1}`,
					app,
					chord,
					...(config.type === "hotkey" ? {} : { config }),
					...(item.icon && /^mdi-[a-z0-9-]{1,80}$/.test(item.icon)
						? { icon: item.icon }
						: {}),
				});
			} catch {
				dropped++;
			}
		}
		return { title: decoded.ConfigTitle, rows, dropped };
	} catch (cause) {
		throw new InputRejected(cause, "Invalid configuration");
	}
}
export const conflictIds = (
	rows: readonly ShortcutRow[],
): ReadonlySet<string> => {
	const counts = new Map<string, number>();
	for (const row of rows)
		if (row.chord) counts.set(row.chord, (counts.get(row.chord) ?? 0) + 1);
	return new Set(
		rows
			.filter((r) => r.chord && (counts.get(r.chord) ?? 0) > 1)
			.map((r) => r.id),
	);
};
export const validLibraryName = (name: string) =>
	!!name.trim() && /^[一-龥a-zA-Z0-9\s\-_]+$/.test(name) && name.length <= 100;

export function validateShortcutConfig(
	config: typeof ShortcutConfig.Type,
): void {
	const entry = findAction(config.type);
	if (
		![
			"hotkey",
			"hotkeySwitch",
			"website",
			"text",
			"timer",
			"panelBrightness",
			"playPause",
			"stopPlay",
			"skipBackward",
			"skipForward",
			"fastBackward",
			"fastForward",
			"repeatPlay",
			"randomPlay",
		].includes(config.type) ||
		!entry ||
		entry.gate === "unresolved" ||
		["emoji", "assistant", "multiActions"].includes(config.type) ||
		entry.decode(config)._tag === "Left"
	)
		throw new InputRejected(undefined, "Unsupported generated action");
}
