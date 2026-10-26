// @vitest-environment happy-dom
import { Layer, ManagedRuntime } from "effect";
import { createElement } from "react";
import { expect, it, vi } from "vitest";
import {
	type EmojiStore,
	emptyEmojiStore,
} from "../../../../../../../packages/edge/src/emoji/emoji-contracts";
import {
	EmojiRepository,
	emojiStorageLayer,
} from "../../../../../../../packages/edge/src/emoji/emoji-repository";
import { EmojiLibrary } from "../../../../../../../packages/edge/src/emoji/emoji-service";
import type { EmojiBridge, EmojiReply } from "../../../../shared/emoji";
import { button, click, element, input, mount } from "../dom-test";
import { EmojiPage } from "./EmojiPage";

it("CENTER-089 cancels app drafts, saves deduplicated settings, reloads and removes through the real library", async () => {
	let saved: EmojiStore = { ...emptyEmojiStore, appMatch: false };
	const runtime = ManagedRuntime.make(
		EmojiLibrary.DefaultWithoutDependencies.pipe(
			Layer.provideMerge(
				EmojiRepository.Default.pipe(
					Layer.provide(
						emojiStorageLayer({
							read: async () => saved,
							write: async (next) => {
								saved = next;
							},
						}),
					),
				),
			),
		),
	);
	const slack = {
		name: "Slack",
		path: "/Applications/Slack.app",
		identifier: "slack",
	};
	let picked = [slack];
	const request = vi.fn<EmojiBridge["request"]>(
		async (command): Promise<EmojiReply> => {
			if (command.type === "command")
				await runtime.runPromise(EmojiLibrary.command(command.command));
			const store = await runtime.runPromise(EmojiLibrary.read());
			return {
				_tag: "ready",
				store,
				assets: {},
				notice: "",
				apps:
					command.type === "installed-apps"
						? [slack]
						: command.type === "pick-app"
							? picked
							: [],
			};
		},
	);
	Object.defineProperty(window, "quakeEmoji", {
		configurable: true,
		value: {
			request,
			press: async () => ({ _tag: "ignored" }),
		} satisfies EmojiBridge,
	});
	try {
		let page = await mount(createElement(EmojiPage));
		await click(button("App Match Settings"));
		await click(button("Choose file…"));
		expect(element("dialog").textContent).toContain("Slack.app");
		await click(button("Close", element("dialog")));
		expect(saved.apps).toEqual([]);
		await click(button("App Match Settings"));
		await click(button("Add App"));
		await input(
			element<HTMLInputElement>("dialog input:not([type=checkbox])"),
			"slack",
		);
		await click(button("Slack", element("dialog")));
		picked = [{ ...slack, path: "/Other/Slack.app" }];
		await click(button("Choose file…"));
		expect(element("dialog").textContent).toContain("already been added");
		picked = [
			{ ...slack, path: "/APPLICATIONS/SLACK.APP", identifier: "other" },
		];
		await click(button("Choose file…"));
		expect(element("dialog").textContent).toContain("Apps (1)");
		picked = [];
		await click(button("Choose file…"));
		expect(element("dialog").textContent).toContain("Apps (1)");
		await click(element<HTMLInputElement>("dialog input[type=checkbox]"));
		await input(element<HTMLSelectElement>("dialog select"), "0");
		await click(button("Save", element("dialog")));
		expect(saved).toMatchObject({
			appMatch: true,
			apps: [slack],
			globalMode: 0,
		});
		await page.unmount();
		page = await mount(createElement(EmojiPage));
		await click(button("App Match Settings"));
		expect(
			element<HTMLInputElement>("dialog input[type=checkbox]").checked,
		).toBe(true);
		expect(element("dialog").textContent).toContain("Slack.app");
		await click(button("Delete", element("dialog")));
		await click(button("Save", element("dialog")));
		expect(saved.apps).toEqual([]);
		await page.unmount();
	} finally {
		Reflect.deleteProperty(window, "quakeEmoji");
		await runtime.dispose();
	}
});
