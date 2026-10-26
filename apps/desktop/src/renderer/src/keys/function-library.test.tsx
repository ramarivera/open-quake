// @vitest-environment happy-dom
import { Option, Schema } from "effect";
import { act } from "react";
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
async function fixture() {
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
			libraries: [
				generated,
				{ ...generated, id: "plugin-1", name: "Placeholder" },
			],
		}),
	});
	vi.stubGlobal("quakeEmoji", { request: async () => emoji });
	const props = {
		locale: "de" as const,
		pageNumber: 1,
		sequence: false,
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
			source("plugin-1", "Default"),
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
