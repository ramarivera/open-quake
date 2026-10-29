// @vitest-environment happy-dom
import { Option } from "effect";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { builtinProfiles } from "../../../../../../packages/device/src/profiles/profile-catalog";
import { createEmptyProfileKey } from "../../../../../../packages/device/src/profiles/profile-contracts";
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

const setup = async (child: ReactNode) => {
	const profile = builtinProfiles("linux").find((p) => p.id === "1-3");
	if (!profile) throw new Error("Missing SysView");
	const layout = stripLayout(profile, profile.pages[0]);
	const view = await mount(
		createElement("div", { className: "strip-slot" }, child),
	);
	const slot = required(view.container, ".strip-slot", HTMLDivElement);
	vi.spyOn(view.container, "getBoundingClientRect").mockReturnValue(
		new DOMRect(0, 0, 1920, 480),
	);
	const rect = layout.tiles[0]?.slot;
	if (!rect) throw new Error("Missing test tile");
	const x = rect.x + rect.width / 2;
	const y = rect.y + rect.height / 2;
	let event: (value: QuakeEvent) => void = () => {};
	const key = vi.fn();
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
	const pointer = (type: string, target: Element = slot) => {
		const input = new Event(type, { bubbles: true, cancelable: true });
		Object.assign(input, {
			button: 0,
			pointerId: 1,
			clientX: x,
			clientY: 480 - y,
		});
		target.dispatchEvent(input);
		return input;
	};
	// A DOM TouchEvent contact, which mount-strip-touch tracks by identifier.
	const touchContact = (type: string, target: Element = slot) => {
		const input = new Event(type, { bubbles: true, cancelable: true });
		const touch = { identifier: 7, clientX: x, clientY: 480 - y };
		Object.assign(input, { changedTouches: [touch], touches: [touch] });
		target.dispatchEvent(input);
		return input;
	};
	return {
		view,
		key,
		pointer,
		touchContact,
		emit: (value: QuakeEvent) => event(value),
		close: async () => {
			dispose();
			await view.unmount();
		},
	};
};

it.each(["status", "touch"] as const)(
	"open-quake-l86.22: %s takeover cancels a DOM tap and activates the vendor gesture once",
	async (kind) => {
		const panel = await setup("Tile");
		try {
			panel.pointer("pointerdown");
			expect(panel.key).toHaveBeenCalledWith(
				expect.objectContaining({ keyAction: 0 }),
			);
			const taps = vi.fn();
			panel.view.container.addEventListener("quake-strip-tile-tap", taps);
			if (kind === "status")
				panel.emit({ source: "mock", kind: "status", state: "connected" });
			const profile = builtinProfiles("linux").find((p) => p.id === "1-3");
			if (!profile) throw new Error("Missing SysView");
			const rect = stripLayout(profile, profile.pages[0]).tiles[0]?.slot;
			if (!rect) throw new Error("Missing tile");
			const x = rect.x + rect.width / 2,
				y = 480 - rect.y - rect.height / 2;
			panel.emit({
				source: "mock",
				kind: "touch",
				points: [{ x, y, action: 1 }],
			});
			expect(taps).not.toHaveBeenCalled();
			panel.emit({
				source: "mock",
				kind: "touch",
				points: [{ x, y, action: 0 }],
			});
			panel.pointer("pointerup");
			await new Promise((resolve) => setTimeout(resolve, 150));
			expect(taps).toHaveBeenCalledOnce();
			expect(panel.key.mock.calls.map(([detail]) => detail.keyAction)).toEqual([
				0, 1, 0, 1,
			]);
		} finally {
			await panel.close();
		}
	},
);

it.each(["status", "touch"] as const)(
	"open-quake-l86.22: %s takeover cancels the sub-target without a confirmed tap",
	async (kind) => {
		const panel = await setup(
			createElement(
				"button",
				{
					type: "button",
					"data-quake-overlay-touch": "target",
					"data-quake-sub-touch": "target",
				},
				"Target",
			),
		);
		const target = required(panel.view.container, "button", HTMLButtonElement);
		vi.spyOn(target, "getBoundingClientRect").mockReturnValue(
			new DOMRect(0, 0, 1920, 480),
		);
		const ends = vi.fn();
		target.addEventListener("quake-sub-touch-end", ends);
		try {
			panel.pointer("pointerdown", target);
			if (kind === "status")
				panel.emit({ source: "mock", kind: "status", state: "connected" });
			panel.emit({
				source: "mock",
				kind: "touch",
				points: [{ x: 100, y: 100, action: 1 }],
			});
			expect(ends).toHaveBeenCalledOnce();
			expect(ends.mock.calls[0]?.[0].detail).toMatchObject({
				cancelled: true,
				isEffective: false,
				confirmedTap: false,
			});
			panel.emit({
				source: "mock",
				kind: "touch",
				points: [{ x: 100, y: 100, action: 0 }],
			});
			panel.pointer("pointerup", target);
			expect(ends).toHaveBeenCalledTimes(2);
			expect(ends.mock.calls[1]?.[0].detail).toMatchObject({
				isEffective: true,
				confirmedTap: true,
			});
		} finally {
			await panel.close();
		}
	},
);

it("keeps native editing in panel text fields while vendor touch owns input", async () => {
	const panel = await setup(createElement("textarea"));
	try {
		panel.emit({ source: "mock", kind: "status", state: "connected" });
		const textarea = required(
			panel.view.container,
			"textarea",
			HTMLTextAreaElement,
		);
		expect(panel.pointer("pointerdown", textarea).defaultPrevented).toBe(false);
		expect(panel.key).not.toHaveBeenCalled();
	} finally {
		await panel.close();
	}
});

it("falls back to DOM input after repeated contacts without vendor reports", async () => {
	const panel = await setup("Tile");
	try {
		panel.emit({ source: "mock", kind: "status", state: "connected" });
		for (let index = 0; index < 3; index++) {
			panel.pointer("pointerdown");
			panel.pointer("pointerup");
		}
		expect(panel.key).not.toHaveBeenCalled();
		panel.pointer("pointerdown");
		expect(panel.key).toHaveBeenCalledWith(
			expect.objectContaining({ keyAction: 0 }),
		);
	} finally {
		await panel.close();
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

it("open-quake-l86.22: vendor takeover cancels a DOM touchstart contact without a confirmed tap", async () => {
	const panel = await setup("Tile");
	try {
		panel.touchContact("touchstart");
		expect(panel.key).toHaveBeenCalledWith(
			expect.objectContaining({ keyAction: 0 }),
		);
		const taps = vi.fn();
		panel.view.container.addEventListener("quake-strip-tile-tap", taps);
		const profile = builtinProfiles("linux").find((p) => p.id === "1-3");
		const rect =
			profile && stripLayout(profile, profile.pages[0]).tiles[0]?.slot;
		if (!rect) throw new Error("Missing tile");
		const x = rect.x + rect.width / 2,
			y = 480 - rect.y - rect.height / 2;
		panel.emit({
			source: "mock",
			kind: "touch",
			points: [{ x, y, action: 1 }],
		});
		expect(taps).not.toHaveBeenCalled();
		panel.emit({
			source: "mock",
			kind: "touch",
			points: [{ x, y, action: 0 }],
		});
		panel.touchContact("touchend");
		await new Promise((resolve) => setTimeout(resolve, 150));
		// Only the vendor gesture taps; the superseded DOM contact never confirms.
		expect(taps).toHaveBeenCalledOnce();
	} finally {
		await panel.close();
	}
});

it.each([0, 90])(
	"maps visible pointer positions to the same tiles as vendor input at rotation %i",
	async (rotation) => {
		vi.useFakeTimers();
		const profile = builtinProfiles("linux").find((p) => p.id === "1-3");
		if (!profile) throw Error("Missing profile");
		const page = {
			...profile.pages[0],
			keys: Array.from({ length: 16 }, (_, i) => {
				const key = createEmptyProfileKey(
					`${Math.floor(i / 8) + 1},${(i % 8) + 1}`,
				);
				return {
					...key,
					childrenName: Option.some("pageNo"),
					config: { ...key.config, type: "pageNo" },
				};
			}),
		};
		const layout = stripLayout(profile, page);
		const view = await mount(
			createElement("div", { className: "strip-slot" }, "Tile"),
		);
		const slot = required(view.container, ".strip-slot", HTMLDivElement);
		const bounds =
			rotation === 90
				? new DOMRect(20, 30, 240, 960)
				: new DOMRect(20, 30, 960, 240);
		vi.spyOn(view.container, "getBoundingClientRect").mockReturnValue(bounds);
		let input: (event: QuakeEvent) => void = () => {};
		let now = performance.now();
		vi.spyOn(performance, "now").mockImplementation(() => now);
		const key = vi.fn();
		const dispose = mountStripTouch(
			view.container,
			{
				version: "test",
				onQuakeEvent: (cb) => {
					input = cb;
					return () => {};
				},
			},
			rotation,
			() => layout,
			key,
		);
		try {
			for (const row of [1, 2]) {
				now += 700;
				const tile = layout.tiles.find((tile) =>
					tile.keyCode.startsWith(`${row},`),
				);
				if (!tile) throw Error("Missing row tile");
				const x = tile.slot.x + tile.slot.width / 2,
					y = tile.slot.y + tile.slot.height / 2;
				const clientX =
					bounds.x +
					(rotation === 90
						? (1 - y / 480) * bounds.width
						: (x / 1920) * bounds.width);
				const clientY =
					bounds.y +
					(rotation === 90
						? (x / 1920) * bounds.height
						: (y / 480) * bounds.height);
				key.mockClear();
				for (const type of ["pointerdown", "pointerup"]) {
					const event = new Event(type, { bubbles: true, cancelable: true });
					Object.assign(event, { button: 0, pointerId: 1, clientX, clientY });
					slot.dispatchEvent(event);
				}
				await vi.advanceTimersByTimeAsync(200);
				expect(
					key.mock.calls.map(([event]) => [event.keyCode, event.keyAction]),
				).toEqual([
					[tile.keyCode, 0],
					[tile.keyCode, 1],
				]);
				input({
					source: "hid",
					kind: "status",
					state: "disconnected",
					reason: "scope-closed",
				});
				key.mockClear();
				for (const action of [1, 0] as const)
					input({
						source: "hid",
						kind: "touch",
						points: [
							{
								x: rotation === 90 ? 1920 - x : x,
								y: rotation === 90 ? y : 480 - y,
								action,
							},
						],
					});
				await vi.advanceTimersByTimeAsync(200);
				expect(
					key.mock.calls.map(([event]) => [event.keyCode, event.keyAction]),
				).toEqual([
					[tile.keyCode, 0],
					[tile.keyCode, 1],
				]);
				input({
					source: "hid",
					kind: "status",
					state: "disconnected",
					reason: "scope-closed",
				});
			}
		} finally {
			dispose();
			await view.unmount();
			vi.useRealTimers();
		}
	},
);
