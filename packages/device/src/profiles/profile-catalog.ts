import { Array as EffectArray, Option, Schema } from "effect";
import chat from "./builtins/default_ai_copilot_chat_config.json";
import vivid from "./builtins/default_colorful_screen_config.json";
import discord from "./builtins/default_discord_config.json";
import clock from "./builtins/default_dk_desktop_clock.json";
import music from "./builtins/default_dk_player_config.json";
import claw from "./builtins/default_dkclaw_config.json";
import linux from "./builtins/default_linux_shortcut_config.json";
import mac from "./builtins/default_mac_shortcut_config.json";
import meeting from "./builtins/default_meeting_assistant_config.json";
import monitor from "./builtins/default_system_monitor_panel_config.json";
import windows from "./builtins/default_windows_shortcut_config.json";
import locales from "./builtins/locales.json";
import { Profile, ProfileJsonObject, ProfileKey } from "./profile-contracts.js";
import type {
	ProfileLocale,
	ProfilePlatform,
} from "./profile-manager-contracts.js";

const dictionaries: Readonly<
	Record<ProfileLocale, Readonly<Record<string, string>>>
> = locales;
export const profileText = (
	key: string,
	locale: ProfileLocale = "en",
): string => dictionaries[locale][key] ?? dictionaries.en[key] ?? key;
/** Recognize only known defaults; explicit edits, including CJK titles, stay verbatim. */
export function localizedAgentTitle(
	key: ProfileKey,
	locale: ProfileLocale,
): string | undefined {
	if (key.config.type !== "clawbot" || key.config.userModifiedTitle === true)
		return undefined;
	const agent = key.config.actions.find((action) => action.type === "agentId");
	if (typeof agent?.value !== "string") return undefined;
	const name = `openclawAgents.${agent.value}.name`;
	if (
		!Object.values(dictionaries).some(
			(copy) => copy[name] === key.config.title.text,
		)
	)
		return undefined;
	return profileText(name, locale);
}

export const BUILTIN_PROFILES = [
	{ id: "1-0", title: "discord", mode: 1 },
	{ id: "1-1", title: "meetingAssistant", mode: 1 },
	{ id: "1-4", title: "colorfulScreen", mode: 0 },
	{ id: "1-2", title: "shortcut", mode: 1 },
	{ id: "1-3", title: "systemMonitor", mode: 1 },
	{ id: "1-5", title: "aiCopilotChat", mode: 1 },
	{ id: "1-6", title: "DK-Player", mode: 1 },
	{ id: "1-7", title: "DK-Desktop-Clock", mode: 1 },
	{ id: "1-8", title: "DKClaw", mode: 1 },
] as const;
export const isBuiltinProfile = (id: string): boolean =>
	BUILTIN_PROFILES.some((p) => p.id === id);
const RawKey = Schema.Struct({
	keyCode: Schema.String,
	childrenName: Schema.optional(Schema.String),
	config: ProfileJsonObject,
});
const titleSchema = Schema.Struct({
	text: Schema.String,
	i18nKey: Schema.optional(Schema.String),
});

/** Layout/action facts recovered from DPD. The canonical projection keeps all extra fields inertly. */
export const builtinProfiles = (
	platform: ProfilePlatform,
	locale: ProfileLocale = "en",
): readonly Profile[] => {
	const arrays: Readonly<Record<string, unknown>> = {
		"1-0": discord,
		"1-1": meeting,
		"1-4": vivid,
		"1-2": platform === "darwin" ? mac : platform === "win32" ? windows : linux,
		"1-3": monitor,
		"1-5": chat,
		"1-6": music,
		"1-7": clock,
		"1-8": claw,
	};
	return BUILTIN_PROFILES.map((entry) => {
		const raw = Schema.decodeUnknownSync(Schema.Array(RawKey))(
			arrays[entry.id],
		);
		const keys = raw
			.filter((key) => key.keyCode !== "0,1")
			.map((key): ProfileKey => {
				const title = Schema.decodeUnknownSync(titleSchema)(key.config.title);
				const text =
					title.i18nKey &&
					!title.i18nKey.startsWith("defaultLinuxShortcutConfig.")
						? profileText(title.i18nKey, locale)
						: title.text;
				const actions = Schema.decodeUnknownSync(
					Schema.Array(
						Schema.Struct({ type: Schema.String, value: Schema.Unknown }),
					),
				)(key.config.actions ?? []).filter((a) => a.type !== "");
				return Schema.decodeUnknownSync(ProfileKey)({
					keyCode: key.keyCode,
					...(key.childrenName ? { childrenName: key.childrenName } : {}),
					config: {
						...key.config,
						...(entry.id === "1-0" && key.config.type === "gameMode"
							? { size: [4, 2] }
							: {}),
						// Windows/macOS Quick cells are locked; recovered Linux controls remain editable.
						...(entry.id === "1-2" &&
						(platform !== "linux" ||
							!["luminance", "buzzer", "mic"].includes(
								String(key.config.type),
							)) &&
						!key.config.basicEditableItems
							? {
									basicEditableItems: {
										title: false,
										grid: false,
										icon: false,
										allowDelete: false,
										allowDrag: false,
									},
								}
							: {}),
						title: {
							...Schema.decodeUnknownSync(ProfileJsonObject)(key.config.title),
							text,
						},
						actions,
					},
					compatibility: { catalog: true, source: key },
				});
			});
		const knob = raw.find((key) => key.keyCode === "0,1");
		return Schema.decodeUnknownSync(Profile)({
			id: entry.id,
			name: profileText(entry.title, locale),
			revision: 0,
			pages: [
				{
					id: "1",
					keys: keys.map((key) => Schema.encodeSync(ProfileKey)(key)),
				},
			],
			...(knob ? { knob: { keyCode: "0,1", config: knob.config } } : {}),
			compatibility: {
				builtin: entry.title,
				resourceId: entry.id,
				titleKey: entry.title,
				resourceName: `${Number(entry.id.slice(2)) + 1},1,1`,
				mode: entry.mode,
			},
		});
	});
};
// Display-only aliases for installed catalogs. Stored names and IDs stay untouched.
const agentProfileDefaultNames = new Set([
	"DKClaw",
	"DK Claw",
	"DK-Claw",
	"DK龙虾",
	...Object.values(locales).map((copy) => copy.DKClaw),
]);
const ambientProfileDefaultNames = new Set([
	"Vivid",
	"BB",
	"Lebendig",
	"Vif",
	"Vivace",
	"Vívido",
	"炫彩屏幕",
	"鮮やか",
	"생생한",
	...Object.values(locales).map((copy) => copy.colorfulScreen),
]);
export const profileLabel = (
	profile: Profile,
	locale: ProfileLocale,
): string => {
	const entry = BUILTIN_PROFILES.find((p) => p.id === profile.id);
	if (entry?.id === "1-8" && !agentProfileDefaultNames.has(profile.name))
		return profile.name;
	if (entry?.id === "1-4" && !ambientProfileDefaultNames.has(profile.name))
		return profile.name;
	return entry ? profileText(entry.title, locale) : profile.name;
};
export const translateProfile = (
	profile: Profile,
	locale: ProfileLocale,
): Profile => {
	const builtin = BUILTIN_PROFILES.find((entry) => entry.id === profile.id);
	return {
		...profile,
		name: profileLabel(profile, locale),
		// Older installed catalogs also need stable renderer identities on reads.
		compatibility: builtin
			? Option.some({
					...Option.getOrElse(profile.compatibility, () => ({})),
					resourceId: builtin.id,
					titleKey: builtin.title,
				})
			: profile.compatibility,
		pages: EffectArray.map(profile.pages, (page) => ({
			...page,
			keys: page.keys.map((key) => {
				if (key.config.userModifiedTitle === true) return key;
				const agentTitle = localizedAgentTitle(key, locale);
				if (agentTitle !== undefined)
					return {
						...key,
						config: {
							...key.config,
							title: { ...key.config.title, text: agentTitle },
						},
					};
				const source = Option.isSome(key.compatibility)
					? key.compatibility.value.source
					: undefined;
				const result = Schema.decodeUnknownEither(RawKey)(source);
				if (result._tag === "Left") return key;
				const title = Schema.decodeUnknownEither(titleSchema)(
					result.right.config.title,
				);

				if (
					title._tag === "Left" ||
					!title.right.i18nKey ||
					title.right.i18nKey.startsWith("defaultLinuxShortcutConfig.") ||
					key.config.title.text !== profileText(title.right.i18nKey, "en")
				)
					return key;
				return {
					...key,
					config: {
						...key.config,
						title: {
							...key.config.title,
							text: profileText(title.right.i18nKey, locale),
						},
					},
				};
			}),
		})),
	};
};
