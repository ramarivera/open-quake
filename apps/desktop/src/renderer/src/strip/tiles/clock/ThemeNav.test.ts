// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { dispatch, mount, nativeTouch, required } from "../../../test/mount";
import { ThemeNav } from "./ThemeNav";

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => vi.unstubAllGlobals());

it("WIDGETS-039: releases cancelled contacts and saves exactly once per native or pointer action", async () => {
	const save = vi.fn();
	const view = await mount(
		createElement(ThemeNav, {
			name: "Season",
			previousLabel: "Previous",
			nextLabel: "Next",
			onCycle: save,
		}),
	);
	const button = required(
		view.container,
		'[data-testid="clock-theme-next"]',
		HTMLButtonElement,
	);
	try {
		await dispatch(button, nativeTouch("start"));
		expect(button.classList.contains("is-pressed")).toBe(true);
		await dispatch(button, nativeTouch("end", false));
		expect(button.classList.contains("is-pressed")).toBe(false);
		expect(save).not.toHaveBeenCalled();
		await dispatch(button, nativeTouch("start"));
		await dispatch(button, nativeTouch("end"));
		expect(save.mock.calls).toEqual([[1]]);
		// A compatibility click for the same native contact must not save twice.
		await dispatch(button, new MouseEvent("click", { bubbles: true }));
		expect(save.mock.calls).toEqual([[1]]);
		await dispatch(button, new PointerEvent("pointerdown", { bubbles: true }));
		expect(button.classList.contains("is-pressed")).toBe(true);
		await dispatch(
			button,
			new PointerEvent("pointercancel", { bubbles: true }),
		);
		expect(button.classList.contains("is-pressed")).toBe(false);
		await dispatch(button, new MouseEvent("click", { bubbles: true }));
		expect(save).toHaveBeenCalledTimes(1);
		await dispatch(button, new PointerEvent("pointerdown", { bubbles: true }));
		await dispatch(button, new PointerEvent("pointerup", { bubbles: true }));
		expect(save).toHaveBeenCalledTimes(1);
		await dispatch(button, new MouseEvent("click", { bubbles: true }));
		expect(save.mock.calls).toEqual([[1], [1]]);
	} finally {
		await view.unmount();
	}
	await dispatch(button, nativeTouch("end"));
	expect(save).toHaveBeenCalledTimes(2);
});

it.each(["Enter", " "])(
	"WIDGETS-039: keyboard %s uses the browser activation click once",
	async (key) => {
		const save = vi.fn();
		const view = await mount(
			createElement(ThemeNav, {
				name: "Season",
				previousLabel: "Previous",
				nextLabel: "Next",
				onCycle: save,
			}),
		);
		try {
			const button = required(view.container, "button", HTMLButtonElement);
			await dispatch(
				button,
				new KeyboardEvent("keydown", { key, bubbles: true }),
			);
			await dispatch(
				button,
				new KeyboardEvent("keyup", { key, bubbles: true }),
			);
			expect(save).not.toHaveBeenCalled();
			// DOM emulators don't synthesize keyboard default actions.
			await dispatch(
				button,
				new MouseEvent("click", { bubbles: true, detail: 0 }),
			);
			expect(save.mock.calls).toEqual([[-1]]);
		} finally {
			await view.unmount();
		}
	},
);
