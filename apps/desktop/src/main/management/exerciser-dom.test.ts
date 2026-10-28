// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { enumerateControls } from "./exerciser-dom";

afterEach(() => {
	document.body.replaceChildren();
	vi.restoreAllMocks();
});
function withChromiumRetainedRects(html: string) {
	document.body.innerHTML = `<main>${html}</main>`;
	const rect = new DOMRect(0, 0, 100, 30);
	// Chromium can retain descendants' rectangles while details is closed.
	vi.spyOn(Element.prototype, "getClientRects").mockReturnValue(
		Object.assign([rect], {
			item: (index: number) => (index === 0 ? rect : null),
		}),
	);
}
it("enumerates the Emojis action only while its disclosure and ancestors are open", () => {
	withChromiumRetainedRects(
		'<details id="library"><summary>Add</summary><button>Emojis</button><details open><summary>Nested</summary><button>Inside</button></details></details>',
	);
	expect(enumerateControls().map((control) => control.label)).toEqual(["Add"]);
	document.querySelector("details")?.setAttribute("open", "");
	expect(enumerateControls().map((control) => control.label)).toContain(
		"Emojis",
	);
});
it("enumerates JSON input only after Import profile is opened", () => {
	withChromiumRetainedRects(
		'<details><summary>Import profile</summary><label for="keys-import-json">JSON</label><textarea id="keys-import-json"></textarea></details>',
	);
	expect(
		enumerateControls().some(
			(control) => control.identity === "keys-import-json",
		),
	).toBe(false);
	document.querySelector("details")?.setAttribute("open", "");
	expect(
		enumerateControls().some(
			(control) => control.identity === "keys-import-json",
		),
	).toBe(true);
});
