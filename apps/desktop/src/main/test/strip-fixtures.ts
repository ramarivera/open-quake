import type {
	EncodedProfileEnvelope,
	Profile,
	ProfileKey,
} from "../../shared/profiles";

type EncodedKey = typeof ProfileKey.Encoded;
type EncodedProfile = typeof Profile.Encoded;

/**
 * Built-in-like profiles for strip tests and the native smoke. Layouts follow
 * DK-Suite 0.4.95's DefaultProfileData.js (macOS Quick page, MeetAI, clock);
 * the glyphs are drawn here, never copied from DK-Suite artwork.
 */
const glyph = (color: string, body: string): string =>
	`data:image/svg+xml,${encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108"><g fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`,
	)}`;
const BLUE = "#4f8bff";
const GREEN = "#2fd08a";
const RED = "#ff5d6c";
const AMBER = "#ffb23f";
const VIOLET = "#a77bff";
const CYAN = "#33c6ef";
const PINK = "#ff74b8";

export const STRIP_GLYPHS = {
	globe: glyph(
		BLUE,
		'<circle cx="54" cy="54" r="38"/><path d="M16 54h76M54 16c-20 22-20 54 0 76M54 16c20 22 20 54 0 76"/>',
	),
	help: glyph(
		CYAN,
		'<circle cx="54" cy="54" r="38"/><path d="M42 44a12 12 0 1 1 18 10c-4 3-6 5-6 10"/><path d="M54 77v1"/>',
	),
	screenshot: glyph(
		VIOLET,
		'<path d="M20 36V24a4 4 0 0 1 4-4h12M72 20h12a4 4 0 0 1 4 4v12M88 72v12a4 4 0 0 1-4 4H72M36 88H24a4 4 0 0 1-4-4V72"/><circle cx="54" cy="54" r="12"/>',
	),
	launchpad: glyph(
		AMBER,
		'<rect x="18" y="18" width="24" height="24" rx="6"/><rect x="66" y="18" width="24" height="24" rx="6"/><rect x="18" y="66" width="24" height="24" rx="6"/><rect x="66" y="66" width="24" height="24" rx="6"/>',
	),
	windows: glyph(
		BLUE,
		'<rect x="14" y="26" width="48" height="36" rx="5"/><rect x="46" y="46" width="48" height="36" rx="5"/>',
	),
	forceQuit: glyph(
		RED,
		'<path d="M54 16v34"/><path d="M33 30a34 34 0 1 0 42 0"/>',
	),
	lock: glyph(
		GREEN,
		'<rect x="22" y="48" width="64" height="44" rx="8"/><path d="M34 48V36a20 20 0 0 1 40 0v12"/><path d="M54 66v8"/>',
	),
	search: glyph(
		CYAN,
		'<circle cx="46" cy="46" r="26"/><path d="M66 66l24 24"/>',
	),
	emoji: glyph(
		AMBER,
		'<circle cx="54" cy="54" r="38"/><path d="M38 62c8 12 24 12 32 0"/><path d="M42 44v2M66 44v2"/>',
	),
	clipboard: glyph(
		VIOLET,
		'<rect x="24" y="22" width="60" height="70" rx="8"/><path d="M42 16h24v14H42zM38 52h32M38 68h22"/>',
	),
	expose: glyph(
		PINK,
		'<rect x="14" y="16" width="34" height="30" rx="5"/><rect x="60" y="16" width="34" height="30" rx="5"/><rect x="14" y="62" width="34" height="30" rx="5"/><rect x="60" y="62" width="34" height="30" rx="5"/>',
	),
	projection: glyph(
		GREEN,
		'<rect x="14" y="20" width="80" height="52" rx="6"/><path d="M40 92h28M54 72v20"/>',
	),
	translate: glyph(
		CYAN,
		'<path d="M14 26h40M34 18v8M22 26c4 16 14 26 26 30M46 26c-4 16-14 26-26 30"/><path d="M58 92l16-40 16 40M64 78h20"/>',
	),
	minutes: glyph(
		BLUE,
		'<path d="M30 14h36l18 18v62H30z"/><path d="M42 50h30M42 64h30M42 78h18"/>',
	),
	record: glyph(
		RED,
		'<circle cx="54" cy="54" r="38"/><circle cx="54" cy="54" r="16"/>',
	),
	mic: glyph(
		GREEN,
		'<rect x="40" y="14" width="28" height="50" rx="14"/><path d="M26 52a28 28 0 0 0 56 0M54 80v14"/>',
	),
	mark: glyph(AMBER, '<path d="M30 92V16M30 20h46l-10 16 10 16H30"/>'),
	chat: glyph(
		VIOLET,
		'<path d="M18 24h72v46H50L32 88V70H18z"/><path d="M36 42h36M36 56h24"/>',
	),
	terminal: glyph(
		GREEN,
		'<rect x="14" y="20" width="80" height="68" rx="8"/><path d="M30 44l14 12-14 12M52 70h22"/>',
	),
	camera: glyph(
		PINK,
		'<rect x="14" y="30" width="80" height="56" rx="8"/><path d="M38 30l6-12h20l6 12"/><circle cx="54" cy="58" r="14"/>',
	),
} as const;

const title = (text: string): EncodedKey["config"]["title"] => ({
	text,
	pos: "bot",
	size: 8,
	color: "#FFFFFF",
	display: text !== "",
	style: "bold|italic|underline",
	resourceId: 0,
});
const tile = (
	keyCode: string,
	type: string,
	text: string,
	icon: string,
	size: readonly [number, number] = [1, 1],
): EncodedKey => ({
	keyCode,
	childrenName: type,
	config: {
		type,
		title: title(text),
		size: [size[0], size[1]],
		display: true,
		supportTouchEffect: true,
		icon,
		actions: [],
		compatibility: { fixture: true },
	},
});
const empty = (keyCode: string, display = true): EncodedKey => ({
	keyCode,
	config: {
		type: "",
		title: title(""),
		size: [1, 1],
		display,
		icon: "",
		actions: [],
	},
});

/** DEFAULT_MAC_SHORTCUT_CONFIG's layout: twelve 1×1 keys, four empty slots. */
export const quickProfile: EncodedProfile = {
	id: "fixture-quick",
	name: "Quick",
	revision: 0,
	pages: [
		{
			id: "quick-1",
			keys: [
				tile("1,1", "website", "Website", STRIP_GLYPHS.globe),
				tile("1,2", "website", "Help", STRIP_GLYPHS.help),
				tile("1,3", "hotkey", "Screenshot", STRIP_GLYPHS.screenshot),
				tile("1,4", "cmd", "Launchpad", STRIP_GLYPHS.launchpad),
				tile("1,5", "hotkey", "Mission Control", STRIP_GLYPHS.windows),
				tile("1,6", "hotkey", "Force Quit", STRIP_GLYPHS.forceQuit),
				empty("1,7"),
				empty("1,8"),
				tile("2,1", "hotkey", "Lock Screen", STRIP_GLYPHS.lock),
				tile("2,2", "hotkey", "Search", STRIP_GLYPHS.search),
				tile("2,3", "hotkey", "Emoji", STRIP_GLYPHS.emoji),
				tile("2,4", "hotkey", "Clip Board", STRIP_GLYPHS.clipboard),
				tile("2,5", "hotkey", "Exposé", STRIP_GLYPHS.expose),
				tile("2,6", "hotkey", "Projection", STRIP_GLYPHS.projection),
				empty("2,7"),
				empty("2,8"),
			],
		},
	],
	compatibility: { titleKey: "shortcut" },
};

/** DEFAULT_MEETING_ASSISTANT_CONFIG: a 5×2 live translate panel plus five keys. */
export const meetAiProfile: EncodedProfile = {
	id: "fixture-meetai",
	name: "MeetAI",
	revision: 0,
	pages: [
		{
			id: "meetai-1",
			keys: [
				tile(
					"1,1",
					"liveAudioTranslateDisplay",
					"",
					STRIP_GLYPHS.translate,
					[5, 2],
				),
				...["1,2", "1,3", "1,4", "1,5"].map((code) => empty(code)),
				tile("1,6", "meetingMinutes", "Start", STRIP_GLYPHS.minutes, [1, 2]),
				tile("1,7", "tempMeetingMinutes", "Record", STRIP_GLYPHS.record),
				tile("1,8", "mic", "Mic Mute", STRIP_GLYPHS.mic),
				...["2,1", "2,2", "2,3", "2,4", "2,5", "2,6"].map((code) =>
					empty(code),
				),
				tile("2,7", "liveAudioTranslate", "Translate", STRIP_GLYPHS.translate),
				tile("2,8", "meetingRecordMark", "Mark", STRIP_GLYPHS.mark),
			],
		},
	],
	compatibility: { resourceId: "1-1", titleKey: "meetingAssistant" },
};

/** Edge anchoring: every span here grows inward (parity decision 2). */
export const spansProfile: EncodedProfile = {
	id: "fixture-spans",
	name: "Studio",
	revision: 0,
	pages: [
		{
			id: "spans-1",
			keys: [
				tile("2,1", "hotkey", "Chat", STRIP_GLYPHS.chat, [2, 2]),
				empty("1,1", false),
				empty("1,2", false),
				empty("2,2", false),
				tile("2,3", "hotkey", "Terminal", STRIP_GLYPHS.terminal, [1, 2]),
				empty("1,3", false),
				tile("1,4", "hotkey", "Camera", STRIP_GLYPHS.camera),
				empty("2,4"),
				tile("2,8", "quakeBot", "", STRIP_GLYPHS.chat),
			],
		},
	],
};

/** DEFAULT_DK_DESKTOP_CLOCK: one full-bleed clock key. */
export const clockProfile: EncodedProfile = {
	id: "fixture-clock",
	name: "DK-Desktop-Clock",
	revision: 0,
	pages: [
		{
			id: "clock-1",
			keys: [tile("1,1", "dkDesktopClock", "", "", [8, 2])],
		},
	],
};

/** DEFAULT_COLORFUL_SCREEN_CONFIG: the vivid screen shows the wallpaper. */
export const vividProfile: EncodedProfile = {
	id: "fixture-vivid",
	name: "Vivid",
	revision: 0,
	pages: [
		{
			id: "vivid-1",
			keys: [tile("1,1", "colorfulScreen", "", "")],
		},
	],
};

export const STRIP_FIXTURE_PROFILES: readonly EncodedProfile[] = [
	quickProfile,
	meetAiProfile,
	spansProfile,
	clockProfile,
	vividProfile,
];

/** All fixtures, with `serial` (when given) selecting `active`'s first page. */
export function stripFixtureEnvelope(
	active: EncodedProfile = quickProfile,
	serial?: string,
): EncodedProfileEnvelope {
	return {
		schemaVersion: 1,
		profiles: [
			active,
			...STRIP_FIXTURE_PROFILES.filter((profile) => profile !== active),
		],
		activeByDevice: serial
			? {
					[serial]: { profileId: active.id, pageId: active.pages[0].id },
				}
			: {},
	};
}
