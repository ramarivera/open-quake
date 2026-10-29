import { Option, Schema } from "effect";
import { createActionDraft } from "../../../../../../packages/device/src/actions/action-registry";
import {
	keyText,
	localizedKey,
} from "../../../../../../packages/device/src/profiles/key-editing-invariants";
import { builtinProfiles } from "../../../../../../packages/device/src/profiles/profile-catalog";
import {
	createEmptyProfileKey,
	EMPTY_PROFILE_TITLE,
	Profile,
	ProfileKey,
} from "../../../../../../packages/device/src/profiles/profile-contracts";
import type { ProfileLocale } from "../../../../../../packages/device/src/profiles/profile-manager-contracts";

/** An additive preset. Existing profiles and their layout never change. */
export function consoleProfile(locale: ProfileLocale, name: string): Profile {
	const agent = builtinProfiles("darwin", locale).find(
		(profile) => profile.id === "1-8",
	);
	const input = agent?.pages[0].keys.find(
		(key) => key.config.type === "quakeBotInput",
	);
	const routes =
		agent?.pages[0].keys.filter((key) => key.config.type === "clawbot") ?? [];
	if (!input || routes.length !== 4)
		throw new Error("Console preset requires bundled Agent controls");
	const clock = Schema.decodeUnknownSync(ProfileKey)({
		...Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1")),
		childrenName: "dkDesktopClock",
		config: {
			...Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1")).config,
			...createActionDraft("dkDesktopClock"),
			size: [2, 2],
			compatibility: { layout: "console" },
			title: {
				...EMPTY_PROFILE_TITLE,
				text: keyText("dkDesktopClock", locale),
			},
			actions: [
				{
					type: "clockStyle",
					value: {
						background: { mode: "none", themeId: "season", themes: {} },
						musicEnabled: false,
					},
				},
				{ type: "hourFormat", value: "24h" },
				{ type: "weather", value: { enabled: false } },
			],
		},
	});
	const volume = Schema.decodeUnknownSync(ProfileKey)({
		...Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,3")),
		childrenName: "vol",
		config: {
			...Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,3")).config,
			...createActionDraft("vol"),
			size: [2, 2],
			title: { ...EMPTY_PROFILE_TITLE, text: keyText("vol", locale) },
		},
	});
	return Schema.decodeUnknownSync(Profile)({
		id: "console-preset",
		name,
		revision: 0,
		pages: [
			{
				id: "1",
				keys: [
					clock,
					volume,
					{
						...input,
						keyCode: "1,5",
						config: {
							...input.config,
							size: [4, 1] as const,
							compatibility: Option.some({
								...Option.getOrElse(input.config.compatibility, () => ({})),
								layout: "console",
							}),
						},
					},
					...routes.map((key, index) => ({
						...localizedKey(key, locale),
						keyCode: `2,${index + 5}`,
						config: {
							...localizedKey(key, locale).config,
							icon:
								["0-112", "0-115", "0-104", "0-114"][index] ?? key.config.icon,
							size: [1, 1] as const,
						},
					})),
				].map((key) => Schema.encodeSync(ProfileKey)(key)),
			},
		],
	});
}
