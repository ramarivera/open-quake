// @vitest-environment happy-dom
import { Option, Schema } from "effect";
import { act, createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
	AppLibrarySnapshot,
	defaultAppLibrary,
} from "../../../../../../packages/device/src/profiles/app-library";
import { emptyEmojiStore } from "../../../../../../packages/edge/src/emoji/emoji-contracts";
import type { EmojiReply } from "../../../shared/emoji";
import { button, click, input, mount, query } from "../../test/dom";
import { FunctionLibrary } from "./FunctionLibrary";
import {
	appGroups,
	functionGroups,
	functionLibraryKey,
	legacyAiGroups,
} from "./library-entries";
import { SequenceEditor } from "./SequenceEditor";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0)) await close();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});
const generated = {
	id: "user",
	name: "My shortcuts",
	app: "Editor",
	createdAt: "2026-10-26",
	rows: [{ id: "one", name: "Save file", app: "Editor", chord: "control+s" }],
};
async function fixture(sequence = false) {
	let libraries = [
		generated,
		{ ...generated, id: "plugin-1", name: "Placeholder" },
	];
	let changed = () => {};
	let emoji: EmojiReply = {
		_tag: "ready",
		store: {
			...emptyEmojiStore,
			packages: [{ id: "p", name: "Happy", emojiIds: ["e"], profileId: null }],
			items: [
				{
					id: "e",
					name: "Smile",
					original: "a".repeat(64),
					rendered: "b".repeat(64),
					caption: { text: "", size: 48, color: "0xffffffff", position: "bot" },
				},
			],
		},
		assets: {},
		notice: "",
		apps: [],
	};
	const choose = vi.fn(),
		activate = vi.fn();
	vi.stubGlobal("quakeKeyLibrary", {
		request: async () => ({
			_tag: "success",
			appLibrary: Schema.encodeSync(AppLibrarySnapshot)({
				version: 1,
				revision: 1,
				groups: defaultAppLibrary(),
			}),
		}),
		onLibraryChange: (callback: () => void) => {
			changed = callback;
			return () => {
				changed = () => {};
			};
		},
	});
	vi.stubGlobal("quakeIntegrations", {
		request: async () => ({
			type: "libraries",
			libraries,
		}),
	});
	vi.stubGlobal("quakeEmoji", { request: async () => emoji });
	const props = {
		locale: "de" as const,
		pageNumber: 1,
		sequence,
		onPointerDown: vi.fn(),
		onChoose: choose,
		onActivate: activate,
	};
	const f = await mount(<FunctionLibrary {...props} />);
	cleanup.push(f.close);
	return {
		...f,
		props,
		choose,
		activate,
		refresh: async (next: EmojiReply) => {
			emoji = next;
			libraries = [];
			await act(async () => changed());
		},
	};
}
it("MGMT-047/107/115/117/125 filters translated groups after 500ms and clears to collapsed groups", async () => {
	const f = await fixture();
	vi.useFakeTimers();
	await input(
		query(f.host, "#keys-library-search", HTMLInputElement),
		"STUMMSCHALTEN",
	);
	await act(async () => vi.advanceTimersByTimeAsync(499));
	expect(f.host.querySelector('[data-library-type="website"]')).not.toBeNull();
	await act(async () => vi.advanceTimersByTimeAsync(1));
	expect(f.host.querySelector('[data-library-type="website"]')).toBeNull();
	expect(
		f.host.querySelector('[data-library-type="apps:Discord:0"]')?.textContent,
	).toContain("Stummschalten");
	expect(
		Array.from(f.host.querySelectorAll(".function-library-group")).every(
			(group) => group.hasAttribute("open"),
		),
	).toBe(true);
	await input(query(f.host, "#keys-library-search", HTMLInputElement), "");
	expect(f.host.querySelector('[data-library-type="website"]')).not.toBeNull();
	expect(f.host.querySelectorAll(".function-library-group[open]")).toHaveLength(
		0,
	);
	expect(
		f.host.querySelector(".function-library-item img")?.getAttribute("width"),
	).toBe("20");
	await input(
		query(f.host, "#keys-library-search", HTMLInputElement),
		"missing",
	);
	await f.close();
	cleanup.pop();
	await act(async () => vi.advanceTimersByTimeAsync(500));
	expect(f.host.textContent).toBe("");
});
it("MGMT-119/124 composes live generated and emoji data, excludes placeholders and exposes activation", async () => {
	const f = await fixture();
	expect(f.host.textContent).toContain("Save file");
	expect(f.host.textContent).toContain("Smile");
	expect(f.host.textContent).not.toContain("Placeholder");
	await click(
		query(
			f.host,
			'[data-library-type="generated:user:one"]',
			HTMLButtonElement,
		),
	);
	expect(f.choose.mock.calls[0]?.[1].activation).toBe("shortcuts");
	await click(button(f.host, "KI-Kurzbefehle"));
	expect(f.activate).toHaveBeenCalledWith("shortcuts");
	await click(button(f.host, "Emojis"));
	expect(f.activate).toHaveBeenCalledWith("emoji");
	await f.refresh({
		_tag: "ready",
		store: emptyEmojiStore,
		assets: {},
		notice: "",
		apps: [],
	});
	expect(f.host.textContent).not.toContain("Smile");
	expect(f.host.textContent).not.toContain("Save file");
});
it("review: sequence library and mounted editor agree on every selectable default", async () => {
	const entries = functionGroups(true, "en").flatMap((group) => group.entries);
	const view = await mount(
		createElement(SequenceEditor, {
			value: [
				{ config: { type: "delay", actions: [{ type: "time", value: 1000 }] } },
			],
			onChange: () => {},
		}),
	);
	try {
		const options = [
			...view.host.querySelectorAll<HTMLOptionElement>("select option"),
		];
		expect(options).toHaveLength(entries.length);
		for (const entry of entries) {
			const option = options.find((option) => option.value === entry.id);
			expect(option).toBeDefined();
			expect(option?.disabled).toBe(entry.disabled);
		}
		expect(options.find((option) => option.value === "cmd")?.disabled).toBe(
			false,
		);
		expect(options.find((option) => option.value === "buzzer")?.disabled).toBe(
			true,
		);
	} finally {
		await view.close();
	}
});

it("MGMT-127 searches the sequence allowlist and removes explicit plugin exclusions", () => {
	const groups = functionGroups(true, "en");
	const ids = groups.flatMap((group) =>
		group.entries.map((entry) => entry.key.config.type),
	);
	expect(ids).toHaveLength(21);
	expect(ids).not.toContain("multiActions");
	expect(ids).not.toContain("playAudio");
	expect(ids).toContain("cmd");
	const plugin = (supported: boolean) => ({
		...functionLibraryKey("plugin.action"),
		config: {
			...functionLibraryKey("plugin.action").config,
			compatibility: Option.some({
				isPlugin: true,
				SupportedInMultiActions: supported,
			}),
		},
	});
	const app = appGroups(
		[{ subMenu: "Plugin", children: [plugin(false), plugin(true)] }],
		[],
		undefined,
		true,
	);
	expect(app[0]?.entries).toHaveLength(1);
	expect(app[0]?.entries[0]?.disabled).toBe(true);
});
it("MGMT-109 preserves registry sizes, actions and forced edit policy when building placement keys", () => {
	expect(
		Schema.encodeSync(AppLibrarySnapshot)({
			version: 1,
			revision: 0,
			groups: [
				{
					subMenu: "OBS",
					children: [
						functionLibraryKey("obsStats"),
						functionLibraryKey("obsScreenshot"),
					],
				},
			],
		}).groups[0]?.children.map((key) => [
			key.config.size,
			key.config.basicEditableItems,
		]),
	).toEqual([
		[
			[2, 1],
			{
				title: false,
				grid: false,
				icon: false,
				allowDelete: true,
				allowDrag: true,
			},
		],
		[
			[2, 2],
			{
				title: false,
				grid: false,
				icon: false,
				allowDelete: true,
				allowDrag: true,
			},
		],
	]);
});

it("MGMT-119 imports inert legacy AI groups and excludes placeholders and malformed entries", () => {
	const source = (id: string, name: string) => ({
		id,
		name,
		config: {
			subMenu: name,
			children: [
				{
					childrenName: "hotkey",
					config: {
						type: "hotkey",
						title: { text: "Mine" },
						actions: [{ type: "key", value: "control+s" }],
					},
				},
			],
		},
	});
	const groups = legacyAiGroups(
		JSON.stringify([
			{ id: "plugin-1", name: "Default" },
			{ id: "broken", name: "No config" },
			null,
			source("2", "文本处理插件"),
			source("real", "Mine"),
		]),
	);
	expect(groups.map((group) => group.subMenu)).toEqual(["Mine"]);
	expect(groups[0]?.children[0]?.config.actions).toEqual([
		{ type: "key", value: "control+s" },
	]);
	expect(legacyAiGroups("alert(1)")).toEqual([]);
});

it("MGMT-127 filters retained imported plugin metadata without enabling unsupported execution", () => {
	const plugin = (supported?: boolean) => ({
		...functionLibraryKey("plugin.action"),
		compatibility: Option.some({
			source: {
				isPlugin: true,
				...(supported === undefined
					? {}
					: { SupportedInMultiActions: supported }),
			},
		}),
	});
	const app = appGroups(
		[
			{
				subMenu: "Imported",
				children: [plugin(false), plugin(true), plugin()],
			},
		],
		[],
		undefined,
		true,
	);
	expect(app[0]?.entries.map((entry) => entry.id)).toEqual([
		"apps:Imported:1",
		"apps:Imported:2",
	]);
	expect(app[0]?.entries.every((entry) => entry.disabled)).toBe(true);
});

it("MGMT-127 reads the recovered pluginAction manifest through legacy import and library composition", () => {
	const groups = legacyAiGroups(
		JSON.stringify([
			{
				id: "installed-plugin-import",
				name: "Plugin imports",
				config: {
					subMenu: "Plugin imports",
					children: [false, true].map((supported) => ({
						isPlugin: true,
						childrenName: "Plugin command",
						config: {
							type: "plugin.action",
							actions: [
								{
									type: "pluginAction",
									value: JSON.stringify({ SupportedInMultiActions: supported }),
								},
							],
						},
					})),
				},
			},
		]),
	);
	const library = appGroups(groups, [], undefined, true);
	expect(library[0]?.entries.map((entry) => entry.id)).toEqual([
		"apps:Plugin imports:1",
	]);
	expect(library[0]?.entries[0]?.disabled).toBe(true);
});

it("MGMT-107/127/210 offers confirmed command steps and keeps unavailable operations disabled", async () => {
	const f = await fixture(true);
	vi.useFakeTimers();
	expect(f.host.querySelector('[data-library-type="multiActions"]')).toBeNull();
	expect(
		query(f.host, '[data-library-type="cmd"]', HTMLButtonElement).disabled,
	).toBe(false);
	await click(query(f.host, '[data-library-type="cmd"]', HTMLButtonElement));
	expect(f.choose).toHaveBeenCalledTimes(1);
	expect(f.choose.mock.calls[0]?.[1].key.config.type).toBe("cmd");
	await input(
		query(f.host, "#keys-library-search", HTMLInputElement),
		"GERÄTEMIKROFON",
	);
	await act(async () => vi.advanceTimersByTimeAsync(500));
	expect(f.host.querySelector('[data-library-type="website"]')).toBeNull();
	expect(f.host.querySelector('[data-library-type="mic"]')).not.toBeNull();
	const microphone = query(
		f.host,
		'[data-library-type="mic"]',
		HTMLButtonElement,
	);
	expect(microphone.disabled).toBe(true);
	await click(microphone);
	expect(f.choose).toHaveBeenCalledTimes(1);
	await input(query(f.host, "#keys-library-search", HTMLInputElement), "");
	expect(f.host.querySelector('[data-library-type="website"]')).not.toBeNull();
});

it("MGMT-127 disables directional app hotkeys while retaining ordinary executable sequence presets", async () => {
	const f = await fixture(true);
	const sequence = appGroups(defaultAppLibrary(), [], undefined, true);
	const ordinary = appGroups(defaultAppLibrary(), [], undefined, false);
	let directional = 0;
	for (const group of sequence) {
		for (const entry of group.entries) {
			if (entry.key.config.type !== "hotkey") continue;
			const row = query(
				f.host,
				`[data-library-type="${entry.id}"]`,
				HTMLButtonElement,
			);
			if (entry.key.config.supportKnob) {
				directional++;
				expect(row.disabled).toBe(true);
				expect(row.title).toContain("In Sequenzen noch nicht verfügbar");
				await click(row);
				expect(f.choose).not.toHaveBeenCalled();
				expect(
					ordinary.flatMap((g) => g.entries).find((e) => e.id === entry.id)
						?.disabled,
				).not.toBe(true);
			} else {
				expect(row.disabled).toBe(false);
			}
		}
	}
	expect(directional).toBeGreaterThan(0);
});
