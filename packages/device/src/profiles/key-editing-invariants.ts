import { Array as EffectArray, Option, Schema } from "effect";
import locales from "./key-locales.json";
import { profileText } from "./profile-catalog.js";
import type {
	Profile,
	ProfileEnvelope,
	ProfileJsonObject,
	ProfileKey,
	ProfileTitle,
} from "./profile-contracts.js";
import { ProfileLocale } from "./profile-manager-contracts.js";

const dictionaries: Readonly<
	Record<ProfileLocale, Readonly<Record<string, string>>>
> = locales;
export const keyText = (key: string, locale: ProfileLocale = "en"): string =>
	dictionaries[locale][key] ?? profileText(key, locale);

/** MGMT-258 uses UTF-16 units, with only this CJK range weighted twice. */
export const titleWeight = (text: string): number =>
	text.split("").reduce((n, c) => n + (/[\u4e00-\u9fa5]/.test(c) ? 2 : 1), 0);
export function truncateKeyTitle(text: string): string {
	let value = "",
		weight = 0;
	for (const point of text) {
		const next = titleWeight(point);
		if (weight + next > 20) break;
		value += point;
		weight += next;
	}
	return value;
}
const RawTitle = Schema.Struct({
	text: Schema.String,
	i18nKey: Schema.optional(Schema.String),
	multiLanguage: Schema.optional(Schema.Boolean),
});
const RawSource = Schema.Struct({ config: Schema.Struct({ title: RawTitle }) });
const legacy: Readonly<Record<string, string>> = {
	Start: "defaultMeetingAssistantConfig.start",
	Record: "defaultMeetingAssistantConfig.record",
	"Mic Mute": "defaultMeetingAssistantConfig.micMute",
	Translate: "defaultMeetingAssistantConfig.translate",
	Mark: "defaultMeetingAssistantConfig.mark",
};
const legacyAi: Readonly<Record<string, string>> = {
	"Content Writer": "contentWriter",
	Translate: "translate",
	Term: "term",
	Math: "math",
	Search: "search",
	Compliance: "compliance",
};
export function keyTitle(
	key: ProfileKey,
	locale: ProfileLocale,
	alternate = false,
): string {
	if (alternate && Option.isSome(key.config.alterTitle))
		return keyTitle(
			{
				...key,
				compatibility: Option.none(),
				config: {
					...key.config,
					title: key.config.alterTitle.value,
					userModifiedTitle: key.config.userModifiedAlterTitle,
				},
			},
			locale,
		);
	if (key.config.userModifiedTitle === true) return key.config.title.text;
	const text = key.config.title.text;
	const isLegacyLabel = (name: string): boolean =>
		ProfileLocale.literals.some((language) => text === keyText(name, language));
	if (key.config.type === "hotkey" && isLegacyLabel("hotkey"))
		return keyText("hotkey", locale);
	if (key.config.type === "clawbot" && (!text || isLegacyLabel("clawbot"))) {
		const agent = key.config.actions.find(
			(action) => action.type === "agentId",
		);
		if (typeof agent?.value === "string")
			return profileText(`openclawAgents.${agent.value}.name`, locale);
	}
	const source = Schema.decodeUnknownEither(RawSource)(
		Option.isSome(key.compatibility)
			? key.compatibility.value.source
			: undefined,
	);
	const title = key.config.title;
	const i18n =
		title.i18nKey ??
		(source._tag === "Right" ? source.right.config.title.i18nKey : undefined) ??
		(key.config.type === "aiChat" && legacyAi[title.text]
			? `defaultAiCopilotChatConfig.${legacyAi[title.text]}`
			: legacy[title.text]);
	if (i18n) {
		const translated = keyText(i18n, locale);
		if (translated !== i18n) return translated;
	}
	const children = Option.getOrElse(key.childrenName, () => "");
	if (title.text && title.text !== keyText(children, "en")) return title.text;
	const fallback = keyText(children, locale);
	return fallback !== children ? fallback : title.text;
}
export const localizedKey = (
	key: ProfileKey,
	locale: ProfileLocale,
): ProfileKey => ({
	...key,
	config: {
		...key.config,
		title: { ...key.config.title, text: keyTitle(key, locale) },
		alterTitle: Option.map(key.config.alterTitle, (title) => ({
			...title,
			text: keyTitle(key, locale, true),
		})),
	},
});
export const editKeyTitle = (
	key: ProfileKey,
	text: string,
	alternate = false,
): ProfileKey => {
	const title = alternate
		? Option.getOrElse(key.config.alterTitle, () => key.config.title)
		: key.config.title;
	const edited: ProfileTitle = {
		...title,
		text: truncateKeyTitle(text),
		...(text.trim() ? { display: true, pos: "top", style: "" } : {}),
	};
	return {
		...key,
		config: {
			...key.config,
			...(alternate
				? { userModifiedAlterTitle: true, alterTitle: Option.some(edited) }
				: { userModifiedTitle: true, title: edited }),
		},
	};
};
/** MGMT-261: explicit styling preserves translated/custom text origin. */
export const editKeyTitleStyle = (
	key: ProfileKey,
	style: Pick<ProfileTitle, "display" | "pos" | "size" | "color" | "style">,
	alternate = false,
): ProfileKey => {
	const title = alternate
		? Option.getOrElse(key.config.alterTitle, () => key.config.title)
		: key.config.title;
	const edited = { ...title, ...style, userModifiedStyle: true };
	return {
		...key,
		config: {
			...key.config,
			...(alternate ? { alterTitle: Option.some(edited) } : { title: edited }),
		},
	};
};
export const DEFAULT_KEY_TITLE_STYLE = {
	display: true,
	pos: "bot",
	size: 8,
	color: "#FFFFFF",
	style: "bold|italic|underline",
} as const;
/** MGMT-255: default metadata wins, then the matching built-in cell; both states remain drafts. */
export const resetKeyIcons = (
	key: ProfileKey,
	original?: ProfileKey,
): ProfileKey => {
	const metadata: Readonly<Record<string, unknown>> = Option.getOrElse(
		key.config.compatibility,
		() => ({}),
	);
	const source = Option.isSome(key.compatibility)
		? Schema.decodeUnknownEither(
				Schema.Struct({
					config: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
				}),
			)(key.compatibility.value.source)
		: undefined;
	const sourceConfig = source?._tag === "Right" ? source.right.config : {};
	const icon =
		metadata.defaultIcon ?? sourceConfig.defaultIcon ?? original?.config.icon;
	const alternate =
		metadata.defaultAlterIcon ??
		sourceConfig.defaultAlterIcon ??
		(original ? Option.getOrUndefined(original.config.alterIcon) : undefined);
	return {
		...key,
		config: {
			...key.config,
			...(typeof icon === "string" ? { icon } : {}),
			...(typeof alternate === "string"
				? { alterIcon: Option.some(alternate) }
				: {}),
			// A state without a default keeps its portable pixels AND source identity.
			// Deletion protection compares imported sources, not the rasterized preview.
			...(typeof icon === "string" || typeof alternate === "string"
				? {
						compatibility: Option.some({
							...metadata,
							...(typeof icon === "string" ? { iconSource: icon } : {}),
							...(typeof alternate === "string"
								? { alternateIconSource: alternate }
								: {}),
						}),
					}
				: {}),
		},
	};
};
export const keyEditable = (
	key: ProfileKey,
	field: "title" | "icon" | "allowDelete" | "grid" | "allowDrag",
): boolean =>
	Option.match(key.config.basicEditableItems, {
		onNone: () => true,
		onSome: (policy) => policy[field],
	}) &&
	(field !== "allowDelete" ||
		!["back", "emojiBack", "functionwheel", "colorfulScreenSettings"].includes(
			key.config.type,
		));

export interface KeyTarget {
	readonly token: string;
	readonly profileId: string;
	readonly pageId: string;
	readonly keyCode: string;
	readonly revision: number;
}
export interface KeyDraft {
	readonly target: KeyTarget;
	readonly key: ProfileKey;
	readonly pageKeys?: readonly ProfileKey[];
}
export const replaceProfileKey = (
	profile: Profile,
	pageId: string,
	key: ProfileKey,
): Profile => ({
	...profile,
	pages: EffectArray.map(profile.pages, (page) =>
		page.id === pageId
			? {
					...page,
					keys: [...page.keys.filter((k) => k.keyCode !== key.keyCode), key],
				}
			: page,
	),
});
export const previewEnvelope = (
	envelope: ProfileEnvelope,
	draft: Option.Option<KeyDraft>,
): ProfileEnvelope =>
	Option.match(draft, {
		onNone: () => envelope,
		onSome: ({ target, key, pageKeys }) => ({
			...envelope,
			profiles: EffectArray.map(envelope.profiles, (p) =>
				p.id === target.profileId && p.revision === target.revision
					? pageKeys
						? {
								...p,
								pages: EffectArray.map(p.pages, (page) =>
									page.id === target.pageId
										? { ...page, keys: pageKeys }
										: page,
								),
							}
						: replaceProfileKey(p, target.pageId, key)
					: p,
			),
		}),
	});
/** References include alternate states and nested/sub-action compatibility records. */
export function iconInUse(value: unknown, icons: ReadonlySet<string>): boolean {
	if (typeof value === "string") return icons.has(value);
	if (Array.isArray(value))
		return value.some((child) => iconInUse(child, icons));
	if (typeof value === "object" && value !== null)
		return Object.values(value).some((child) => iconInUse(child, icons));
	return false;
}
export const pageIndex = (
	current: number,
	count: number,
	delta: number,
): number => (count ? (((current + delta) % count) + count) % count : 0);

/** Row identity belongs to the editor; all executable and retained config fields still compare. */
export const sequencePayload = (
	steps: Option.Option<readonly (typeof ProfileJsonObject.Type)[]>,
): string =>
	JSON.stringify(
		Option.map(steps, (rows) =>
			rows.map(({ editorId: _editorId, ...payload }) => payload),
		),
	);
