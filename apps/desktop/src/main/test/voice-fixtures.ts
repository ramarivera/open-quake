import type {
	EncodedProfileEnvelope,
	Profile,
	ProfileKey,
} from "../../shared/profiles";
import { STRIP_GLYPHS } from "./strip-fixtures";

type EncodedKey = typeof ProfileKey.Encoded;
type EncodedProfile = typeof Profile.Encoded;

/**
 * DK-Suite 0.4.95's AI Copilot and DKClaw default layouts (AUDIT_AI §3.0,
 * DefaultProfileData.js) for voice tests and the voice native smoke. Glyphs
 * are drawn by `strip-fixtures`; nothing is copied from DK-Suite artwork.
 */
const key = (
	keyCode: string,
	type: string,
	text: string,
	icon: string,
	size: readonly [number, number] = [1, 1],
	actions: EncodedKey["config"]["actions"] = [],
): EncodedKey => ({
	keyCode,
	childrenName: type,
	config: {
		type,
		title: {
			text,
			pos: "bot",
			size: 8,
			color: "#FFFFFF",
			display: text !== "",
			style: "bold|italic|underline",
			resourceId: 0,
		},
		size: [size[0], size[1]],
		display: true,
		supportTouchEffect: true,
		icon,
		actions,
		compatibility: { fixture: true },
	},
});
const empty = (keyCode: string, display = true): EncodedKey => ({
	keyCode,
	config: {
		type: "",
		title: {
			text: "",
			pos: "bot",
			size: 8,
			color: "#FFFFFF",
			display: false,
			style: "",
			resourceId: 0,
		},
		size: [1, 1],
		display,
		icon: "",
		actions: [],
	},
});
const covered = (codes: readonly string[]) =>
	codes.map((code) => empty(code, false));

/** AI Copilot view 5×2 at (1,1); six aiChat role keys at columns 6–8. */
export const copilotProfile: EncodedProfile = {
	id: "fixture-copilot",
	name: "AI Copilot",
	revision: 0,
	pages: [
		{
			id: "copilot-1",
			keys: [
				key("1,1", "aiChatView", "", STRIP_GLYPHS.chat, [5, 2]),
				...covered([
					"1,2",
					"1,3",
					"1,4",
					"1,5",
					"2,1",
					"2,2",
					"2,3",
					"2,4",
					"2,5",
				]),
				key("1,6", "aiChat", "Translate", STRIP_GLYPHS.translate),
				key("1,7", "aiChat", "Writer", STRIP_GLYPHS.clipboard),
				key("1,8", "aiChat", "Coder", STRIP_GLYPHS.terminal),
				key("2,6", "aiChat", "Search", STRIP_GLYPHS.search),
				key("2,7", "aiChat", "Explain", STRIP_GLYPHS.help),
				key("2,8", "aiChat", "Summary", STRIP_GLYPHS.minutes),
			],
		},
	],
	compatibility: { titleKey: "aiCopilot" },
};

const agent = (agentId: string) => [
	{ type: "voiceInput", value: true },
	{ type: "agentId", value: agentId },
];
/** ClawBotView 4×2 at (1,1), ClawBotInput 2×2 at (1,7), clawbot agents at (1,5)…(2,6). */
export const dkClawProfile: EncodedProfile = {
	id: "fixture-dkclaw",
	name: "DKClaw",
	revision: 0,
	pages: [
		{
			id: "dkclaw-1",
			keys: [
				key("1,1", "quakeBot", "", STRIP_GLYPHS.chat, [4, 2]),
				...covered(["1,2", "1,3", "1,4", "2,1", "2,2", "2,3", "2,4"]),
				key(
					"1,5",
					"clawbot",
					"Weather",
					STRIP_GLYPHS.globe,
					[1, 1],
					agent("weather"),
				),
				key(
					"1,6",
					"clawbot",
					"Coder",
					STRIP_GLYPHS.terminal,
					[1, 1],
					agent("code"),
				),
				key("2,5", "clawbot", "Chat", STRIP_GLYPHS.chat, [1, 1], agent("chat")),
				key(
					"2,6",
					"clawbot",
					"Assistant",
					STRIP_GLYPHS.help,
					[1, 1],
					agent("assistant"),
				),
				key("1,7", "quakeBotInput", "", STRIP_GLYPHS.clipboard, [2, 2]),
				...covered(["1,8", "2,7", "2,8"]),
			],
		},
	],
	compatibility: { titleKey: "dkClaw" },
};

export function voiceFixtureEnvelope(
	active: EncodedProfile,
	serial?: string,
): EncodedProfileEnvelope {
	const first = active.pages[0];
	return {
		schemaVersion: 1,
		profiles: [
			active,
			...[copilotProfile, dkClawProfile].filter(
				(profile) => profile !== active,
			),
		],
		activeByDevice:
			serial && first
				? { [serial]: { profileId: active.id, pageId: first.id } }
				: {},
	};
}
