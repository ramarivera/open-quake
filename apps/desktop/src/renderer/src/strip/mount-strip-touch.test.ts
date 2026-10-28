// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { builtinProfiles } from "../../../../../../packages/device/src/profiles/profile-catalog";
import type { QuakeEvent } from "../../../preload/quake";
import { mount, required } from "../test/mount";
import { TestResizeObserver } from "../test/resize-observer";
import { stripLayout } from "./geometry";
import { mountStripTouch } from "./mount-strip-touch";

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("ResizeObserver", TestResizeObserver);
	TestResizeObserver.instances = [];
});

it("ignores mirrored DOM pointer input while the vendor touch connection is healthy", async () => {
	const profile = builtinProfiles("linux").find((p) => p.id === "1-3");
	if (!profile) throw new Error("Missing SysView");
	const layout = stripLayout(profile, profile.pages[0]);
	const view = await mount(
		createElement("div", { className: "strip-slot" }, "Tile"),
	);
	const slot = required(view.container, ".strip-slot", HTMLDivElement);
	vi.spyOn(view.container, "getBoundingClientRect").mockReturnValue(
		new DOMRect(0, 0, 1920, 480),
	);
	const slotRect = layout.tiles[0]?.slot;
	if (!slotRect) throw new Error("Missing test tile");
	const x = slotRect.x + slotRect.width / 2;
	const y = slotRect.y + slotRect.height / 2;
	let event: (value: QuakeEvent) => void = () => {};
	const key = vi.fn();
	const taps = vi.fn();
	let now = performance.now();
	vi.spyOn(performance, "now").mockImplementation(() => now);
	view.container.addEventListener("quake-strip-tile-tap", taps);
	const dispose = mountStripTouch(
		view.container,
		{
			version: "test",
			onQuakeEvent: (callback) => {
				event = callback;
				return () => {};
			},
		},
		0,
		() => layout,
		key,
	);
	const pointer = (type: string) => {
		const input = new Event(type, { bubbles: true, cancelable: true });
		Object.assign(input, {
			button: 0,
			pointerId: 1,
			clientX: x,
			clientY: 480 - y,
		});
		slot.dispatchEvent(input);
	};
	try {
		event({ source: "mock", kind: "status", state: "connected" });
		pointer("pointerdown");
		pointer("pointerup");
		expect(key).not.toHaveBeenCalled();
		expect(taps).not.toHaveBeenCalled();
		for (const action of [1, 0] as const)
			event({
				source: "mock",
				kind: "touch",
				points: [{ x, y: 480 - y, action }],
			});
		expect(key).toHaveBeenCalledWith(expect.objectContaining({ keyAction: 0 }));
		expect(key).toHaveBeenCalledTimes(1);
		expect(taps).toHaveBeenCalledOnce();
		event({
			source: "mock",
			kind: "status",
			state: "disconnected",
			reason: "scope-closed",
		});
		expect(key).toHaveBeenCalledTimes(2);
		now += 601;
		pointer("pointerdown");
		expect(key).toHaveBeenCalledTimes(3);
	} finally {
		dispose();
		await view.unmount();
	}
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("SCREEN-061: real DOM adapter refreshes element/parent/gadget bounds, discovers children and disposes non-bubbling routing", async () => {
	const profile = builtinProfiles("linux").find((p) => p.id === "1-3");
	if (!profile) throw new Error("Missing SysView");
	const layout = stripLayout(profile, profile.pages[0]);
	const view = await mount(
		createElement(
			"div",
			{
				className: "gadget-container",
				"data-state": "tile",
				"data-key-code": "1,1",
			},
			createElement(
				"div",
				null,
				createElement(
					"button",
					{
						type: "button",
						"data-quake-sub-touch": "target",
						"data-support-quake-move": "false",
					},
					"Target",
				),
			),
		),
	);
	const tile = required(view.container, ".gadget-container", HTMLDivElement);
	const parent = required(tile, "div", HTMLDivElement);
	const button = required(tile, "button", HTMLButtonElement);
	vi.spyOn(view.container, "getBoundingClientRect").mockReturnValue(
		new DOMRect(0, 0, 1920, 480),
	);
	let left = 100;
	vi.spyOn(button, "getBoundingClientRect").mockImplementation(
		() => new DOMRect(left, 100, 60, 60),
	);
	let event: (value: QuakeEvent) => void = () => {};
	const off = vi.fn();
	const key = vi.fn();
	const bubbled = vi.fn();
	view.container.addEventListener("quake-sub-touch-end", bubbled);
	const starts = vi.fn();
	const ends = vi.fn();
	button.addEventListener("quake-sub-touch-start", starts);
	button.addEventListener("quake-sub-touch-end", ends);
	const dispose = mountStripTouch(
		view.container,
		{
			version: "test",
			onQuakeEvent: (callback) => {
				event = callback;
				return off;
			},
		},
		0,
		() => layout,
		key,
	);
	const tap = (x: number) => {
		for (const action of [1, 0])
			event({ source: "mock", kind: "touch", points: [{ x, y: 350, action }] });
	};
	try {
		tap(130);
		expect(starts).toHaveBeenCalledOnce();
		expect(ends).toHaveBeenCalledOnce();
		const received: unknown = ends.mock.calls[0]?.[0];
		expect(received).toBeInstanceOf(CustomEvent);
		if (!(received instanceof CustomEvent))
			throw new Error("Missing native event");
		expect(received.bubbles).toBe(false);
		expect(received.detail).toMatchObject({
			keyCode: "1,1",
			subElementId: "target",
			x: 130,
			y: 130,
			startX: 130,
			startY: 130,
			isEffective: true,
			confirmedTap: true,
		});
		expect(bubbled).not.toHaveBeenCalled();
		expect(key).not.toHaveBeenCalled();
		for (const element of [button, parent, tile]) {
			left += 100;
			element.classList.toggle("changed");
			await new Promise((resolve) => setTimeout(resolve, 0));
			tap(left + 30);
		}
		expect(ends).toHaveBeenCalledTimes(4);
		left = 650;
		TestResizeObserver.instances[0]?.resize();
		tap(680);
		expect(ends).toHaveBeenCalledTimes(5);
		const child = document.createElement("button");
		child.dataset.quakeSubTouch = "new-child";
		vi.spyOn(child, "getBoundingClientRect").mockReturnValue(
			new DOMRect(800, 100, 60, 60),
		);
		const childEnd = vi.fn();
		child.addEventListener("quake-sub-touch-end", childEnd);
		parent.append(child);
		await new Promise((resolve) => setTimeout(resolve, 0));
		// Local discovery is throttled to 500 ms in the current production registry.
		vi.spyOn(performance, "now").mockReturnValue(performance.now() + 501);
		tap(830);
		expect(childEnd).toHaveBeenCalledOnce();
	} finally {
		dispose();
		await view.unmount();
	}
	expect(off).toHaveBeenCalledOnce();
	expect(TestResizeObserver.instances[0]?.targets.size).toBe(0);
	const count = ends.mock.calls.length;
	tap(680);
	expect(ends).toHaveBeenCalledTimes(count);
});
