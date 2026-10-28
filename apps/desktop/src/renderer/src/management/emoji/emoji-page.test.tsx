// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { emptyEmojiStore } from "../../../../../../../packages/edge/src/emoji/emoji-contracts";
import type { EmojiReply, EmojiRequest } from "../../../../shared/emoji";
import { click, input, mount, query, settle } from "../../../test/dom";
import { EmojiPage } from "./EmojiPage";

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	vi.unstubAllGlobals();
});
it.each(["中".repeat(11), "a".repeat(21)])(
	"keeps an overlong rename %s intact without invoking the domain, then saves a corrected name",
	async (draft) => {
		const store = {
			...emptyEmojiStore,
			packages: [{ id: "pack", name: "Pack", emojiIds: [], profileId: "" }],
		};
		const request = vi.fn(
			async (_input: EmojiRequest): Promise<EmojiReply> => ({
				_tag: "ready",
				store,
				assets: {},
				notice: "",
				apps: [],
			}),
		);
		vi.stubGlobal("quakeEmoji", { request });
		const view = await mount(<EmojiPage />);
		close = view.close;
		await settle(() =>
			expect(
				query(view.host, 'button[title="Rename Pack"]', HTMLButtonElement),
			).toBeDefined(),
		);
		await click(
			query(view.host, 'button[title="Rename Pack"]', HTMLButtonElement),
		);
		const field = query(
			view.host,
			'input[aria-label="Rename Pack"]',
			HTMLInputElement,
		);
		await input(field, draft);
		expect(field.value).toBe(draft);
		expect(field.maxLength).toBe(-1);
		const errorId = field.getAttribute("aria-describedby");
		expect(errorId).toBeTruthy();
		expect(view.host.querySelector(`[id="${errorId}"]`)?.textContent).toContain(
			"20 weighted units",
		);
		const other = query(
			view.host,
			'button[title="New emoji package"]',
			HTMLButtonElement,
		);
		other.focus();
		await view.render(<EmojiPage />);
		expect(document.activeElement).toBe(other);
		const before = request.mock.calls.length;
		await act(async () => field.blur());
		expect(request).toHaveBeenCalledTimes(before);
		expect(field.getAttribute("aria-invalid")).toBe("true");
		expect(
			field.parentElement?.querySelector('[role="alert"]')?.textContent,
		).toBe("Package names must be at most 20 weighted units.");
		field.focus();
		await input(field, "中".repeat(10));
		await act(async () => field.blur());
		expect(request).toHaveBeenLastCalledWith({
			type: "command",
			command: { type: "rename-package", id: "pack", name: "中".repeat(10) },
		});
	},
);
