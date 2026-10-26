import { Option, Schema } from "effect";
import { SequenceLeaf } from "../../../../../../packages/device/src/actions/action-contracts.js";
import {
	ACTION_REGISTRY,
	createActionDraft,
} from "../../../../../../packages/device/src/actions/action-registry.js";
import {
	allowedInSequence,
	SEQUENCE_LIBRARY,
} from "../../../../../../packages/device/src/actions/sequence-library.js";
import {
	type AppLibraryGroup,
	appLibraryKey,
	appLibraryLabel,
} from "../../../../../../packages/device/src/profiles/app-library.js";
import {
	keyText,
	truncateKeyTitle,
} from "../../../../../../packages/device/src/profiles/key-editing-invariants.js";
import {
	createEmptyProfileKey,
	ProfileJsonObject,
	ProfileKey,
} from "../../../../../../packages/device/src/profiles/profile-contracts.js";
import { effectiveSpan } from "../../../../../../packages/device/src/profiles/profile-footprint.js";
import type { ProfileLocale } from "../../../../../../packages/device/src/profiles/profile-manager-contracts.js";
import type { ShortcutLibrary } from "../../../../../../packages/edge/src/shortcuts/shortcut-contracts.js";
import { executableChord } from "../../../../../../packages/edge/src/shortcuts/shortcut-invariants.js";
import type { EmojiReply } from "../../../shared/emoji";
import { keyArtwork } from "./key-artwork";

export type LibraryEntry = {
	readonly id: string;
	readonly key: ProfileKey;
	readonly label?: string;
	readonly activation?: "shortcuts" | "emoji";
	readonly disabled?: boolean;
};
export type LibraryGroup = {
	readonly id: string;
	readonly name: string;
	readonly entries: readonly LibraryEntry[];
	readonly emoji?: boolean;
};

export function functionLibraryKey(type: string, pageNumber = 1): ProfileKey {
	const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
	const registered = ACTION_REGISTRY.find((entry) => entry.id === type);
	const defaults = registered
		? createActionDraft(registered.id)
		: {
				type,
				actions:
					type === "createFolder"
						? [{ type: "folder", value: `folder:${crypto.randomUUID()}` }]
						: type === "delay"
							? [{ type: "time", value: 1000 }]
							: [],
			};
	const icon =
		type === "pageNo"
			? `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text x="32" y="46" text-anchor="middle" font-family="sans-serif" font-size="44" fill="white">${pageNumber}</text></svg>`)}`
			: keyArtwork(type === "brightness" ? "0-1" : `library:${type}:1`, type);
	return Schema.decodeUnknownSync(ProfileKey)({
		...empty,
		childrenName: type,
		config: {
			...empty.config,
			...defaults,
			title: {
				...empty.config.title,
				text: keyText(type === "delay" ? "delayed" : type, "en"),
				multiLanguage: true,
				i18nKey: type === "delay" ? "delayed" : type,
			},
			icon,
			...(type === "hotkeySwitch" ? { alterIcon: icon } : {}),
			size: defaults.size ?? effectiveSpan(type, [1, 1]),
			supportTouchEffect: registered?.supportTouchEffect ?? false,
			compatibility: {
				defaultIcon: icon,
				...(type === "hotkeySwitch" ? { defaultAlterIcon: icon } : {}),
				pendingConfiguration: true,
				...(type === "pageNo" ? { pageNumber } : {}),
			},
		},
	});
}
export function functionGroups(
	sequence: boolean,
	locale: ProfileLocale,
	pageNumber = 1,
): readonly LibraryGroup[] {
	const source = sequence
		? SEQUENCE_LIBRARY.map((group) => ({
				subMenu: group.subMenu,
				ids: [...group.ids],
			}))
		: [...new Set(ACTION_REGISTRY.map((entry) => entry.submenu))].map(
				(subMenu) => ({
					subMenu,
					ids: ACTION_REGISTRY.filter((entry) => entry.submenu === subMenu).map(
						(entry): string => entry.id,
					),
				}),
			);
	const groups: LibraryGroup[] = source.map((group) => ({
		id: `functions:${group.subMenu}`,
		name: keyText(group.subMenu, locale),
		entries: group.ids.map((id) => ({
			id,
			key: functionLibraryKey(id, pageNumber),
			...(sequence
				? {
						disabled:
							!Schema.is(Schema.encodedSchema(SequenceLeaf))(
								Schema.encodeSync(ProfileKey)(functionLibraryKey(id)).config,
							) && !["website", "hotkey", "open", "text"].includes(id),
					}
				: {}),
		})),
	}));
	if (!sequence)
		groups.push({
			id: "functions:layout",
			name: locale === "de" ? "Layout" : "Layout",
			entries: ["createFolder", "pageNo", "playAudio"].map((id) => ({
				id,
				key: functionLibraryKey(id, pageNumber),
			})),
		});
	return groups;
}
const placeholders = new Set([
	"plugin-1",
	"plugin-2",
	"文本处理插件",
	"图像识别插件",
]);
export function appGroups(
	stored: readonly AppLibraryGroup[],
	generated: readonly ShortcutLibrary[],
	emoji: EmojiReply | undefined,
	sequence: boolean,
): readonly LibraryGroup[] {
	const groups: LibraryGroup[] = stored
		.filter(
			(group) => group.subMenu !== "Excel" && !placeholders.has(group.subMenu),
		)
		.map((group) => ({
			id: `apps:${group.subMenu}`,
			name: group.subMenu,
			emoji: group.subMenu === "EmojiCustomLib",
			entries: group.children.map((key, index) => ({
				id: `apps:${group.subMenu}:${index}`,
				key: appLibraryKey(group, key),
				...(group.subMenu === "EmojiCustomLib"
					? { activation: "emoji" as const }
					: {}),
			})),
		}));
	for (const library of generated) {
		if (placeholders.has(library.id) || placeholders.has(library.name))
			continue;
		groups.push({
			id: `generated:${library.id}`,
			name: library.name,
			entries: library.rows.map((row) => {
				const empty = Schema.encodeSync(ProfileKey)(
					createEmptyProfileKey("1,1"),
				);
				return {
					id: `generated:${library.id}:${row.id}`,
					label: row.name,
					activation: "shortcuts",
					key: Schema.decodeUnknownSync(ProfileKey)({
						...empty,
						childrenName: row.config?.type ?? "hotkey",
						config: {
							...empty.config,
							...(row.config ?? {
								type: "hotkey",
								actions: [{ type: "key", value: executableChord(row.chord) }],
							}),
							icon: row.icon ?? "",
							title: {
								...empty.config.title,
								text: truncateKeyTitle(row.name),
							},
							userModifiedTitle: true,
						},
					}),
				};
			}),
		});
	}
	if (emoji?._tag === "ready") {
		// Rebuild the complete group from the latest snapshot. Removed children cannot linger.
		const entries: LibraryEntry[] = [];
		for (const pack of emoji.store.packages)
			for (const id of pack.emojiIds) {
				const item = emoji.store.items.find((item) => item.id === id);
				if (!item) continue;
				const empty = Schema.encodeSync(ProfileKey)(
					createEmptyProfileKey("1,1"),
				);
				entries.push({
					id: `emoji:${pack.id}:${id}`,
					activation: "emoji",
					key: Schema.decodeUnknownSync(ProfileKey)({
						...empty,
						childrenName: "emoji",
						config: {
							...empty.config,
							type: "emoji",
							icon: `emoji:${item.rendered}`,
							title: { ...empty.config.title, text: item.name },
							userModifiedTitle: true,
							actions: [
								{
									type: "emojiAction",
									value: item.mode ?? emoji.store.globalMode ?? 1,
								},
								{
									type: "emojiConfig",
									value: {
										packageId: pack.id,
										emojiId: id,
										hash: item.rendered,
									},
								},
							],
						},
					}),
				});
			}
		const old = groups.findIndex((group) => group.emoji);
		if (old >= 0) groups.splice(old, 1);
		groups.push({ id: "emoji", name: "EmojiCustomLib", emoji: true, entries });
	}
	return groups
		.map((group) => ({
			...group,
			entries: group.entries
				.filter((entry) => {
					if (!sequence) return true;
					const metadata: typeof ProfileJsonObject.Type = Option.getOrElse(
						entry.key.config.compatibility,
						() => ({}),
					);
					const retained: typeof ProfileJsonObject.Type = Option.getOrElse(
						entry.key.compatibility,
						() => ({}),
					);
					const source = Schema.is(ProfileJsonObject)(retained.source)
						? retained.source
						: {};
					const manifest = entry.key.config.actions.find(
						(action) => action.type === "pluginAction",
					)?.value;
					let actionMetadata: unknown;
					if (typeof manifest === "string") {
						try {
							actionMetadata = JSON.parse(manifest);
						} catch {
							// Legacy plugin manifests are inert data; malformed values cannot execute.
						}
					}
					const records = [
						metadata,
						retained,
						source,
						...(Schema.is(ProfileJsonObject)(actionMetadata)
							? [actionMetadata]
							: []),
					];
					const plugin = records.some((record) => record.isPlugin === true)
						? {
								SupportedInMultiActions: !records.some(
									(record) => record.SupportedInMultiActions === false,
								),
							}
						: undefined;
					return allowedInSequence(entry.key.config.type, plugin);
				})
				.map((entry) =>
					sequence
						? {
								...entry,
								disabled:
									(entry.key.config.type === "hotkey" &&
										entry.key.config.supportKnob === true) ||
									!Schema.is(Schema.encodedSchema(SequenceLeaf))(
										Schema.encodeSync(ProfileKey)(entry.key).config,
									),
							}
						: entry,
				),
		}))
		.filter((group) => group.entries.length > 0);
}
export function filterLibrary(
	groups: readonly LibraryGroup[],
	query: string,
	locale: ProfileLocale,
): readonly LibraryGroup[] {
	const term = query.trim().toLowerCase();
	if (!term) return groups;
	return groups
		.map((group) => ({
			...group,
			entries: group.entries.filter((entry) =>
				`${Option.getOrElse(entry.key.childrenName, () => entry.key.config.type)} ${entry.label ?? appLibraryLabel(entry.key, locale)}`
					.toLowerCase()
					.includes(term),
			),
		}))
		.filter((group) => group.entries.length > 0);
}

/** Inert import of the old AI plugin library. Never evaluate generated configuration. */
export function legacyAiGroups(
	source: string | null,
): readonly AppLibraryGroup[] {
	if (!source || source.length > 8 * 1024 * 1024) return [];
	const Plugin = Schema.Struct({
		id: Schema.String,
		name: Schema.String,
		config: Schema.Struct({
			subMenu: Schema.String,
			children: Schema.Array(ProfileJsonObject),
		}),
	});
	let input: unknown;
	try {
		input = JSON.parse(source);
	} catch {
		return [];
	}
	if (!Array.isArray(input)) return [];
	return input
		.flatMap((value: unknown) => {
			const decoded = Schema.decodeUnknownEither(Plugin)(value);
			return decoded._tag === "Right" ? [decoded.right] : [];
		})
		.filter(
			(plugin) =>
				!placeholders.has(plugin.id) &&
				!placeholders.has(plugin.name) &&
				plugin.config.subMenu !== "Excel",
		)
		.map((plugin) => ({
			subMenu: plugin.config.subMenu,
			children: plugin.config.children.flatMap((raw) => {
				const empty = Schema.encodeSync(ProfileKey)(
					createEmptyProfileKey("1,1"),
				);
				const config = Schema.is(ProfileJsonObject)(raw.config)
					? raw.config
					: {};
				const title = Schema.is(ProfileJsonObject)(config.title)
					? config.title
					: {};
				const key = Schema.decodeUnknownEither(ProfileKey)({
					...empty,
					...raw,
					compatibility: {
						...(Schema.is(ProfileJsonObject)(raw.compatibility)
							? raw.compatibility
							: {}),
						source: raw,
					},
					keyCode: typeof raw.keyCode === "string" ? raw.keyCode : "1,1",
					childrenName:
						typeof raw.childrenName === "string"
							? raw.childrenName
							: config.type,
					config: {
						...empty.config,
						...config,
						title: { ...empty.config.title, ...title },
					},
				});
				return key._tag === "Right" ? [key.right] : [];
			}),
		}))
		.filter((group) => group.children.length > 0);
}
