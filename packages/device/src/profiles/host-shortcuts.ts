import { Option, Schema } from "effect";
import macShortcutDefaults from "./builtins/default_mac_shortcut_config.json";
import { builtinProfiles } from "./profile-catalog.js";
import type { Profile, ProfileKey } from "./profile-contracts.js";
import type { ProfilePlatform } from "./profile-manager-contracts.js";

/** The recovered launcher binding is the source of truth for overview ownership. */
export const MAC_APPS_COMMAND = macShortcutDefaults
	.find((key) => key.keyCode === "1,7")
	?.config.actions.find((action) => action.type === "text")?.value;

const catalogs = new Map<ProfilePlatform, readonly Profile[]>();
const catalogFor = (platform: ProfilePlatform) => {
	let catalog = catalogs.get(platform);
	if (!catalog) {
		catalog = builtinProfiles(platform);
		catalogs.set(platform, catalog);
	}
	return catalog;
};

/** Only recovered, untouched default commands follow the host. User bindings win. */
export function adaptHostShortcuts(
	profile: Profile,
	platform: ProfilePlatform,
): Profile {
	const target = catalogFor(platform).find((p) => p.id === "1-2");
	if (!target) return profile;
	const defaults = (["darwin", "win32", "linux"] as const).flatMap(
		(host) => catalogFor(host).find((p) => p.id === "1-2")?.pages[0].keys ?? [],
	);
	const adapt = (key: ProfileKey): ProfileKey => {
		const source = Option.isSome(key.compatibility)
			? key.compatibility.value.source
			: undefined;
		const decoded = Schema.decodeUnknownEither(
			Schema.Struct({
				keyCode: Schema.String,
				config: Schema.Struct({
					type: Schema.String,
					actions: Schema.Array(
						Schema.Struct({ type: Schema.String, value: Schema.Unknown }),
					),
					title: Schema.Struct({ text: Schema.String }),
				}),
			}),
		)(source);
		if (
			decoded._tag === "Left" ||
			!Option.isSome(key.compatibility) ||
			key.compatibility.value.catalog !== true
		)
			return key;
		const raw = decoded.right;
		const original = defaults.find(
			(candidate) =>
				candidate.keyCode === raw.keyCode &&
				candidate.config.type === raw.config.type &&
				candidate.config.type === key.config.type &&
				(JSON.stringify(candidate.config.actions) ===
					JSON.stringify(raw.config.actions) ||
					(raw.keyCode === "1,7" &&
						raw.config.type === "cmd" &&
						raw.config.actions.length === 1 &&
						raw.config.actions[0]?.type === "text" &&
						raw.config.actions[0]?.value ===
							"osascript -e 'tell application \"Launchpad\" to activate'")) &&
				JSON.stringify(raw.config.actions) ===
					JSON.stringify(key.config.actions),
		);
		const replacement = target.pages[0].keys.find(
			(candidate) => candidate.keyCode === original?.keyCode,
		);
		if (!original || !replacement) return key;
		const defaultTitle =
			key.config.userModifiedTitle !== true &&
			(key.config.title.text === original.config.title.text ||
				key.config.title.text === raw.config.title.text);
		if (
			replacement.config.type === key.config.type &&
			JSON.stringify(replacement.config.actions) ===
				JSON.stringify(key.config.actions) &&
			(!defaultTitle || key.config.title.text === replacement.config.title.text)
		)
			return key;
		return {
			...key,
			childrenName: replacement.childrenName,
			compatibility: replacement.compatibility,
			config: {
				...key.config,
				type: replacement.config.type,
				actions: replacement.config.actions,
				title: defaultTitle
					? {
							...key.config.title,
							text: replacement.config.title.text,
							...(replacement.config.title.i18nKey
								? { i18nKey: replacement.config.title.i18nKey }
								: {}),
						}
					: key.config.title,
			},
		};
	};
	let changed = false;
	const pages = profile.pages.map((page) => ({
		...page,
		keys: page.keys.map((key) => {
			const next = adapt(key);
			changed ||= next !== key;
			return next;
		}),
	}));
	return changed
		? {
				...profile,
				revision: profile.revision + 1,
				pages: [pages[0] ?? profile.pages[0], ...pages.slice(1)],
			}
		: profile;
}
