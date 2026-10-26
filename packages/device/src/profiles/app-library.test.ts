import { describe, expect, it } from "@effect/vitest";
import { Option, Schema } from "effect";
import { validateAction } from "../actions/action-invariants.js";
import {
	allowedInSequence,
	SEQUENCE_LIBRARY,
} from "../actions/sequence-library.js";
import {
	appGroupIcon,
	appIconScore,
	appLibraryKey,
	appLibraryLabel,
	defaultAppLibrary,
	mergeMissingDefaultAppMenu,
} from "./app-library.js";
import { keyText, keyTitle } from "./key-editing-invariants.js";
import { createEmptyProfileKey, ProfileKey } from "./profile-contracts.js";
import { ProfileLocale } from "./profile-manager-contracts.js";

describe("MGMT-110/386/391 persistent app defaults", () => {
	it("merges OBS-first and partial groups once, preserving object identity and edits", () => {
		const obs = { subMenu: "obsStudio", children: [] };
		const custom = {
			subMenu: "User",
			children: [createEmptyProfileKey("1,1")],
		};
		const emoji = { subMenu: "EmojiCustomLib", children: [] };
		const discord = { subMenu: "Discord", children: [] };
		for (const existing of [[obs], [obs, custom, emoji, discord], []]) {
			const merged = mergeMissingDefaultAppMenu(existing);
			expect(merged.slice(0, existing.length)).toEqual(existing);
			for (let i = 0; i < existing.length; i++)
				expect(merged[i]).toBe(existing[i]);
			expect(
				merged.filter((group) => group.subMenu === "Discord"),
			).toHaveLength(1);
			expect(
				merged.filter((group) => group.subMenu === "Premiere Pro"),
			).toHaveLength(1);
			expect(mergeMissingDefaultAppMenu(merged)).toBe(merged);
		}
	});
	it("MGMT-387/388 has all 18 independent presets with executable canonical chords", () => {
		const groups = defaultAppLibrary();
		expect(groups.map((group) => group.children.length)).toEqual([9, 9]);
		for (const group of groups)
			for (const key of group.children)
				if (key.config.type === "hotkey")
					expect(
						validateAction("hotkey", Schema.encodeSync(ProfileKey)(key).config)
							._tag,
					).toBe("Right");
		const premiere = groups[1];
		expect(
			premiere?.children
				.filter((key) => key.keyCode === "1,4")
				.map((key) => key.config.title.text),
		).toEqual(["Play/Stop", "Trim"]);
		expect(
			premiere?.children[0]?.config.actions.map((action) => action.value),
		).toEqual(["equal", "minus"]);
		expect(
			premiere?.children[7]?.config.actions.map((action) => action.value),
		).toEqual(["alt+minus", "alt+equal"]);
		expect(
			premiere?.children.filter((key) => key.config.supportKnob),
		).toHaveLength(6);
	});
});

it("MGMT-121/123 resolves labels without changing renamed defaults or stored locks", () => {
	const group = defaultAppLibrary()[0];
	if (!group) throw new Error("Missing Discord fixture");
	const mute = group.children[0],
		game = group.children[4];
	if (!mute || !game) throw new Error("Missing preset");
	const renamed = {
		...mute,
		config: {
			...mute.config,
			title: { ...mute.config.title, text: "My mute" },
		},
	};
	expect(appLibraryLabel(appLibraryKey(group, mute), "de")).toBe(
		"Stummschalten",
	);
	expect(appLibraryLabel(appLibraryKey(group, renamed), "de")).toBe("My mute");
	const imported = {
		...game,
		keyCode: "2,8",
		config: {
			...game.config,
			basicEditableItems: Option.some({
				title: true,
				grid: true,
				icon: true,
				allowDrag: false,
				allowDelete: true,
			}),
		},
	};
	const restored = appLibraryKey(group, imported);
	expect(Option.getOrThrow(restored.config.basicEditableItems)).toMatchObject({
		title: false,
		grid: false,
		allowDrag: false,
	});
	expect(Option.getOrThrow(imported.config.basicEditableItems).title).toBe(
		true,
	);
	const empty = createEmptyProfileKey("1,1");
	expect(
		appLibraryLabel({ ...empty, childrenName: Option.some("obsScene") }, "en"),
	).toBe("Scene");
	const explicit = {
		...mute,
		config: {
			...mute.config,
			userModifiedTitle: true,
			title: { ...mute.config.title, text: "" },
		},
	};
	expect(appLibraryLabel(explicit, "de")).toBe("");
});

it.each([
	["Discord", "discord", 100],
	["Premiere", "Adobe Premiere Pro", 90],
	["Discord shortcuts", "Discord", 85],
	["Discord快捷操作配置", "Discord Canary", 35],
	["ab工具", "abcdefg", 20],
	["", "Discord", 0],
	["Unknown", "Discord", 0],
])("MGMT-122 scores %s against %s", (group, app, expected) =>
	expect(appIconScore(group, app)).toBe(expected),
);
it("MGMT-122 requires >30, keeps inventory-order ties, and rejects unusable artwork", () => {
	const icon = "data:image/png;base64,AAAA";
	const apps = [
		{ name: "abcdefg", data: icon },
		{ name: "Discord", data: icon },
		{ name: "discord", data: icon },
	];
	expect(appGroupIcon("ab工具", apps)).toBeUndefined();
	expect(appGroupIcon("Discord", apps)).toBe(apps[1]);
	expect(appGroupIcon("EmojiCustomLib", apps)).toBeUndefined();
	expect(
		appGroupIcon("Discord", [{ name: "Discord", data: "file:///private" }]),
	).toBeUndefined();
});
it("MGMT-127 declares all active recovered entries and filters plugin opt-outs", () => {
	expect(SEQUENCE_LIBRARY.flatMap((group) => [...group.ids])).toHaveLength(21);
	for (const group of SEQUENCE_LIBRARY)
		for (const id of group.ids) expect(allowedInSequence(id)).toBe(true);
	for (const id of [
		"multiActions",
		"goToPage",
		"previousPage",
		"hotkeySwitch",
		"assistant",
	])
		expect(allowedInSequence(id)).toBe(false);
	expect(allowedInSequence("plugin.action", {})).toBe(true);
	expect(
		allowedInSequence("plugin.action", { SupportedInMultiActions: true }),
	).toBe(true);
	expect(
		allowedInSequence("plugin.action", { SupportedInMultiActions: false }),
	).toBe(false);
});

it("MGMT-121 preserves unmarked renamed preset titles through profile serialization and both title consumers", () => {
	const group = defaultAppLibrary()[0],
		mute = group?.children[0];
	if (!group || !mute) throw new Error("Missing preset");
	for (const text of ["My mute", "", "Mein Stummschalter"]) {
		const source = {
			...mute,
			config: { ...mute.config, title: { ...mute.config.title, text } },
		};
		const placed = appLibraryKey(group, source);
		const rebooted = Schema.decodeUnknownSync(ProfileKey)(
			Schema.encodeSync(ProfileKey)(placed),
		);
		for (const locale of ProfileLocale.literals) {
			expect(keyTitle(rebooted, locale)).toBe(text);
			expect(appLibraryLabel(rebooted, locale)).toBe(text);
		}
		expect(source.config.userModifiedTitle).toBeUndefined();
	}
});
it("MGMT-121 recognizes localized defaults without classifying them as renamed user titles", () => {
	const group = defaultAppLibrary()[0],
		mute = group?.children[0];
	if (!group || !mute?.config.title.i18nKey)
		throw new Error("Missing preset");
	for (const language of ProfileLocale.literals) {
		const source = {
			...mute,
			config: {
				...mute.config,
				title: {
					...mute.config.title,
					text: keyText(mute.config.title.i18nKey, language),
				},
			},
		};
		const recovered = appLibraryKey(group, source);
		expect(keyTitle(recovered, "de")).toBe("Stummschalten");
		expect(appLibraryLabel(recovered, "en")).toBe("Mute");
		expect(source.config.title.text).toBe(
			keyText(mute.config.title.i18nKey, language),
		);
	}
});
