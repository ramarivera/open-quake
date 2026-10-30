import { Option, Schema } from "effect";
import { keyText } from "./key-editing-invariants.js";
import { createEmptyProfileKey, ProfileKey } from "./profile-contracts.js";
import { ProfileLocale } from "./profile-manager-contracts.js";

/** Local resource bound, not a DK-Suite interoperability limit. Includes inline artwork. */
export const APP_LIBRARY_MAX_BYTES = 8 * 1024 * 1024;

export const AppLibraryGroup = Schema.Struct({
	subMenu: Schema.NonEmptyString.pipe(Schema.maxLength(200)),
	children: Schema.Array(ProfileKey).pipe(Schema.maxItems(512)),
});
export type AppLibraryGroup = typeof AppLibraryGroup.Type;
export const AppLibraryGroups = Schema.Array(AppLibraryGroup).pipe(
	Schema.maxItems(128),
);
export const AppLibrarySnapshot = Schema.Struct({
	version: Schema.Literal(1),
	revision: Schema.Int.pipe(Schema.nonNegative()),
	groups: AppLibraryGroups,
});
export type AppLibrarySnapshot = typeof AppLibrarySnapshot.Type;

// Interoperability facts from DefaultAppMenuData.js. Artwork is generated locally.
const preset = (
	code: string,
	text: string,
	label: string,
	chords: readonly string[],
	game = false,
): ProfileKey => {
	const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey(code));
	return Schema.decodeUnknownSync(ProfileKey)({
		...empty,
		childrenName: game ? "gameMode" : "hotkey",
		...(game
			? {
					compatibility: {
						unsupported: true,
						reason: "Game Mode runtime is not available",
					},
				}
			: {}),
		config: {
			...empty.config,
			type: game ? "gameMode" : "hotkey",
			title: {
				...empty.config.title,
				text,
				multiLanguage: true,
				i18nKey: `defaultAppMenu.${label}`,
			},
			supportKnob: chords.length === 2,
			actions: chords.map((value) => ({ type: "key", value })),
			...(game ? { basicEditableItems: { title: false, grid: false } } : {}),
		},
	});
};
export const defaultAppLibrary = (): readonly AppLibraryGroup[] => [
	{
		subMenu: "Discord",
		children: [
			preset("1,1", "Mute", "mute", ["control+alt+m"]),
			preset("1,2", "Deafen", "deafen", ["control+alt+d"]),
			preset("1,3", "Nav Back", "navBack", ["control+alt+leftbracket"]),
			preset("1,4", "Camera", "camera", ["control+alt+k"]),
			preset("1,5", "Game Mode", "gameMode", [], true),
			preset("2,1", "Push To Talk", "pushToTalk", ["control+alt+p"]),
			preset("2,2", "Streamer Mode", "streamerMode", ["control+alt+s"]),
			preset("2,3", "Nav Forward", "navForward", ["control+alt+rightbracket"]),
			preset("2,4", "Screen Share", "screenShare", ["control+shift+alt+s"]),
		],
	},
	{
		subMenu: "Premiere Pro",
		children: [
			preset("1,1", "Time Line", "timeLine", ["equal", "minus"]),
			preset("1,2", "Video Ctrl", "videoCtrl", ["left", "right"]),
			preset("1,3", "Fast Play", "fastPlay", ["j", "l"]),
			preset("1,4", "Play/Stop", "playStop", ["space"]),
			preset("1,4", "Trim", "trim", ["alt+left", "alt+right"]),
			preset("2,1", "Add Cut", "addCut", ["control+k"]),
			preset("2,2", "Cut Jump", "cutJump", ["up", "down"]),
			preset("2,3", "Line Zoom", "lineZoom", ["alt+minus", "alt+equal"]),
			preset("2,4", "Undo", "undo", ["control+z"]),
		],
	},
];
export function mergeMissingDefaultAppMenu(
	existing: readonly AppLibraryGroup[],
	defaults = defaultAppLibrary(),
): readonly AppLibraryGroup[] {
	const seen = new Set(existing.map((group) => group.subMenu));
	const missing = defaults.filter((group) => !seen.has(group.subMenu));
	return missing.length ? [...existing, ...missing] : existing;
}
/** Exact pre-correction preset texts; saved library keys keep localizing. */
const legacyPresetTexts: Readonly<Record<string, string>> = {
	"defaultAppMenu.deafen": "Defean",
};
/** Restore vendor locks by action identity without weakening a user's stricter locks. */
export function appLibraryKey(
	group: AppLibraryGroup,
	key: ProfileKey,
): ProfileKey {
	const defaults = defaultAppLibrary().find(
		(value) => value.subMenu === group.subMenu,
	);
	const locked = defaults?.children.find(
		(value) =>
			Option.getOrUndefined(value.childrenName) ===
				Option.getOrUndefined(key.childrenName) &&
			Option.isSome(value.config.basicEditableItems),
	);
	const fingerprint =
		!key.config.userModifiedTitle &&
		defaults?.children.find(
			(value) =>
				value.keyCode === key.keyCode &&
				(value.config.title.text === key.config.title.text ||
					legacyPresetTexts[value.config.title.i18nKey ?? ""] ===
						key.config.title.text ||
					(!!value.config.title.i18nKey &&
						ProfileLocale.literals.some(
							(locale) =>
								key.config.title.text ===
								keyText(value.config.title.i18nKey ?? "", locale),
						))),
		);
	const renamed =
		!!defaults &&
		!fingerprint &&
		key.config.title.i18nKey?.startsWith("defaultAppMenu.");
	return {
		...key,
		config: {
			...key.config,
			...(renamed ? { userModifiedTitle: true } : {}),
			title: fingerprint
				? {
						...key.config.title,
						multiLanguage: true,
						i18nKey: fingerprint.config.title.i18nKey,
					}
				: defaults && key.config.title.i18nKey?.startsWith("defaultAppMenu.")
					? { ...key.config.title, multiLanguage: false }
					: key.config.title,
			basicEditableItems: locked
				? Option.some({
						...Option.getOrThrow(locked.config.basicEditableItems),
						...Option.getOrElse(key.config.basicEditableItems, () => ({})),
						title: false,
						grid: false,
					})
				: key.config.basicEditableItems,
		},
	};
}
export function appLibraryLabel(
	key: ProfileKey,
	locale: ProfileLocale,
): string {
	const title = key.config.title;
	if (key.config.userModifiedTitle) return title.text;
	if (title.multiLanguage && title.i18nKey) {
		const translated = keyText(title.i18nKey, locale);
		if (translated !== title.i18nKey) return translated;
	}
	return (
		title.text ||
		keyText(
			Option.getOrElse(key.childrenName, () => key.config.type),
			locale,
		)
	);
}
const suffixes = [
	"快捷操作配置",
	"快捷操作",
	"操作配置",
	"配置",
	"设置",
	"管理",
	"工具",
	"助手",
	"插件",
	"应用",
	"软件",
	"程序",
];
export function appIconScore(group: string, name: string): number {
	const query = group.toLowerCase().trim(),
		app = name.toLowerCase().trim();
	if (!query || !app) return 0;
	if (query === app) return 100;
	if (app.includes(query)) return 90;
	if (query.includes(app)) return 85;
	let keyword = query;
	for (const suffix of suffixes) keyword = keyword.replace(suffix, "");
	keyword = keyword.replace(/[\s\-_.()[\]]+/g, "").trim();
	return Math.max(
		...(keyword.length < 2 ? [query] : [keyword, query]).map((word) =>
			app.includes(word) ? Math.min(70, (word.length / app.length) * 70) : 0,
		),
	);
}
export function appGroupIcon<
	A extends { readonly name: string; readonly data: string },
>(group: string, apps: readonly A[]): A | undefined {
	if (group === "EmojiCustomLib") return undefined;
	let best: A | undefined,
		score = 30;
	for (const app of apps) {
		const next = appIconScore(group, app.name);
		if (next > score && /^data:image\/(png|jpeg|webp);base64,/.test(app.data)) {
			best = app;
			score = next;
		}
	}
	return best;
}
