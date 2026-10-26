// @vitest-environment happy-dom
import { act, createElement } from "react";
import { expect, it, vi } from "vitest";
import { defaultAppearance } from "../theme/appearance";
import type { AppearanceController } from "../theme/useAppearance";
import { click, element, mount } from "./dom-test";
import { UiSettings } from "./UiSettings";

it("CENTER-005 dismisses on Escape and outside pointer, restores focus and removes listeners", async () => {
	const controller: AppearanceController = {
		appearance: defaultAppearance,
		setTheme: vi.fn(),
		setFontScale: vi.fn(),
		setSidebarWidth: vi.fn(),
		setMotion: vi.fn(),
		importTheme: vi.fn(),
		notice: "",
		reducedMotion: false,
	};
	const add = vi.spyOn(document, "addEventListener");
	const remove = vi.spyOn(document, "removeEventListener");
	const view = await mount(createElement(UiSettings, { controller }));
	const trigger = element<HTMLButtonElement>("button[title='UI Settings']");
	await click(trigger);
	await click(element("input[name=mc-theme][value=light]"));
	expect(controller.setTheme).toHaveBeenCalledWith("light");
	await click(element("input[name=mc-font][value=large]"));
	expect(controller.setFontScale).toHaveBeenCalledWith("large");
	await act(async () => {
		element("#mc-ui-settings").dispatchEvent(
			new PointerEvent("pointerdown", { bubbles: true }),
		);
	});
	expect(document.querySelector("#mc-ui-settings")).not.toBeNull();
	await act(async () => {
		document.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
	});
	expect(document.querySelector("#mc-ui-settings")).toBeNull();
	expect(document.activeElement).toBe(trigger);
	await click(trigger);
	await act(async () => {
		document.body.dispatchEvent(
			new PointerEvent("pointerdown", { bubbles: true }),
		);
	});
	expect(document.querySelector("#mc-ui-settings")).toBeNull();
	expect(document.activeElement).toBe(trigger);
	await click(trigger);
	await view.unmount();
	for (const [name, listener] of add.mock.calls.filter(
		([name]) => name === "pointerdown" || name === "keydown",
	)) {
		expect(
			remove.mock.calls.some(
				([removedName, removedListener]) =>
					removedName === name && removedListener === listener,
			),
		).toBe(true);
	}
});
