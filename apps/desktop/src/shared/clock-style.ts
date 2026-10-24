/**
 * DK-Suite 0.4.95 desktop-clock style contract (`shared/clockContract.js` and
 * `shared/clockThemePatch.js`). Pure and total: main, preload and renderer all
 * import it, so the theme order and the patch rules have a single owner.
 */

export const THEME_IDS = [
	"season",
	"cyber",
	"anime",
	"tactical",
	"aurora",
] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export const DEFAULT_THEME: ThemeId = "season";

export const IMAGE_EXTENSIONS = [
	"jpg",
	"jpeg",
	"png",
	"gif",
	"webp",
	"bmp",
] as const;
export const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "mkv"] as const;
export type MediaKind = "image" | "video";
/** DK-Suite rejects shorter videos ("should be longer than 2 seconds"). */
export const MIN_VIDEO_MS = 2000;

export interface ClockMediaSlot {
	readonly kind: MediaKind;
	readonly path: string;
}
export type ClockThemeSlots = Partial<Record<ThemeId, ClockMediaSlot>>;
export interface ClockBackground {
	readonly mode: "none" | "theme";
	readonly themeId: ThemeId;
	readonly themes: ClockThemeSlots;
}
export interface ClockStyle {
	readonly background: ClockBackground;
	/** Kept for DK import parity; the music card belongs to open-quake-lih.7. */
	readonly musicEnabled: boolean;
}
export const DEFAULT_CLOCK_STYLE: ClockStyle = {
	background: { mode: "theme", themeId: DEFAULT_THEME, themes: {} },
	musicEnabled: false,
};

export function isThemeId(value: unknown): value is ThemeId {
	return THEME_IDS.some((id) => id === value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extensionOf(path: string): string {
	return /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
}

/** Image and video extensions never overlap; unknown extensions are null. */
export function mediaKindOfPath(path: string): MediaKind | null {
	const ext = extensionOf(path);
	if (IMAGE_EXTENSIONS.some((e) => e === ext)) return "image";
	if (VIDEO_EXTENSIONS.some((e) => e === ext)) return "video";
	return null;
}

function sanitizeSlot(slot: unknown): ClockMediaSlot | null {
	if (!isRecord(slot)) return null;
	const { kind, path } = slot;
	if (kind !== "image" && kind !== "video") return null;
	if (typeof path !== "string" || !path.trim()) return null;
	return { kind, path };
}

/**
 * Accepts the v0.4 shape (`mode/themeId/themes`) and migrates the v0.3 shape
 * (`mode none|builtin|image|video` + `source`), as `normalizeClockStyle` does.
 * Garbage becomes theme/season with no slots and music off. Never throws.
 */
export function normalizeClockStyle(value: unknown): ClockStyle {
	const v = isRecord(value) ? value : {};
	const bg = isRecord(v.background) ? v.background : {};
	const musicEnabled = v.musicEnabled === true;
	const isV04 =
		bg.mode === "theme" || bg.themeId !== undefined || bg.themes !== undefined;
	if (isV04) {
		const themes: Partial<Record<ThemeId, ClockMediaSlot>> = {};
		if (isRecord(bg.themes))
			for (const id of THEME_IDS) {
				const slot = sanitizeSlot(bg.themes[id]);
				if (slot) themes[id] = slot;
			}
		return {
			background: {
				mode: bg.mode === "none" ? "none" : "theme",
				themeId: isThemeId(bg.themeId) ? bg.themeId : DEFAULT_THEME,
				themes,
			},
			musicEnabled,
		};
	}
	const theme = (
		themeId: ThemeId,
		themes: ClockThemeSlots = {},
	): ClockStyle => ({
		background: { mode: "theme", themeId, themes },
		musicEnabled,
	});
	switch (bg.mode) {
		case "none":
			return {
				background: { mode: "none", themeId: DEFAULT_THEME, themes: {} },
				musicEnabled,
			};
		case "image":
		case "video": {
			const source =
				typeof bg.source === "string" && bg.source.trim() ? bg.source : null;
			if (!source) return theme(DEFAULT_THEME);
			const kind = mediaKindOfPath(source) ?? bg.mode;
			return theme(DEFAULT_THEME, { [DEFAULT_THEME]: { kind, path: source } });
		}
		default:
			return theme(isThemeId(bg.source) ? bg.source : DEFAULT_THEME);
	}
}

export type ResolvedBackground =
	| { readonly kind: "none" }
	| { readonly kind: "builtin"; readonly themeId: ThemeId }
	| {
			readonly kind: MediaKind;
			readonly themeId: ThemeId;
			readonly slot: ClockMediaSlot;
	  };

/** Custom sources always carry their theme so a failure falls back to *its* art. */
export function resolveBackground(
	background: ClockBackground,
): ResolvedBackground {
	if (background.mode === "none") return { kind: "none" };
	const themeId = background.themeId;
	const slot = background.themes[themeId];
	return slot
		? { kind: slot.kind, themeId, slot }
		: { kind: "builtin", themeId };
}

/** ◀/▶ order with wrap; `none` (null) starts from season. */
export function cycleTheme(current: ThemeId | null, delta: 1 | -1): ThemeId {
	const index = THEME_IDS.indexOf(current ?? DEFAULT_THEME);
	const next = (index + delta + THEME_IDS.length) % THEME_IDS.length;
	return THEME_IDS[next] ?? DEFAULT_THEME;
}

/** The persisted theme as the tile's `theme` prop: a theme id or "none". */
export function activeThemeOf(style: ClockStyle): ThemeId | "none" {
	return style.background.mode === "none" ? "none" : style.background.themeId;
}

// ---- Narrow theme patch (`clockThemePatch.js`, BR-48) ----

export const CLOCK_TILE_TYPE = "dkDesktopClock";
export const CLOCK_KEY_CODE = "1,1";
export const THEME_PATCH_REASONS = [
	"bad-config",
	"invalid-keycode",
	"invalid-theme",
	"cell-missing",
	"cell-not-clock",
	"no-target",
	"write-failed",
] as const;
export type ThemePatchReason = (typeof THEME_PATCH_REASONS)[number];

export interface ClockAction {
	readonly type: string;
	readonly value: unknown;
}
export interface ClockKey {
	readonly keyCode: string;
	readonly childrenName?: string;
	readonly config: {
		readonly type: string;
		readonly actions: readonly ClockAction[];
	};
}
export type ThemePatchResult =
	| {
			readonly ok: true;
			readonly keys: readonly ClockKey[];
			readonly changed: boolean;
	  }
	| { readonly ok: false; readonly reason: ThemePatchReason };

const KEYCODE = /^\d+,\d+$/;

export function isClockKey(key: ClockKey): boolean {
	return (
		key.config.type === CLOCK_TILE_TYPE || key.childrenName === CLOCK_TILE_TYPE
	);
}

function withTheme(action: ClockAction, themeId: ThemeId): ClockAction {
	const value = isRecord(action.value) ? action.value : {};
	const background = isRecord(value.background) ? value.background : {};
	return {
		...action,
		value: { ...value, background: { ...background, mode: "theme", themeId } },
	};
}

/**
 * Returns the same-order key array with only the target key's
 * `clockStyle.background.{themeId,mode}` changed. Every other action, slot and
 * key is carried over untouched; a key without `clockStyle` gains the default.
 * Callers decode stored keys first; an undecodable store is `bad-config`.
 */
export function buildClockThemePatch(
	keys: readonly ClockKey[],
	keyCode: string,
	themeId: string,
): ThemePatchResult {
	const code = keyCode.trim();
	if (!KEYCODE.test(code)) return { ok: false, reason: "invalid-keycode" };
	if (!isThemeId(themeId)) return { ok: false, reason: "invalid-theme" };
	const index = keys.findIndex((key) => key.keyCode === code);
	const target = keys[index];
	if (!target) return { ok: false, reason: "cell-missing" };
	if (!isClockKey(target)) return { ok: false, reason: "cell-not-clock" };
	const actions = target.config.actions;
	const hasStyle = actions.some((action) => action.type === "clockStyle");
	const nextActions = hasStyle
		? actions.map((action) =>
				action.type === "clockStyle" ? withTheme(action, themeId) : action,
			)
		: [
				...actions,
				{
					type: "clockStyle",
					value: {
						background: { mode: "theme", themeId, themes: {} },
						musicEnabled: false,
					},
				},
			];
	const next: ClockKey = {
		...target,
		config: { ...target.config, actions: nextActions },
	};
	const patched = keys.map((key, i) => (i === index ? next : key));
	return {
		ok: true,
		keys: patched,
		changed: JSON.stringify(patched) !== JSON.stringify(keys),
	};
}
