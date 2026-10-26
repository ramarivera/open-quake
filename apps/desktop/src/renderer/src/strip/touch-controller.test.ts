// @vitest-environment happy-dom
import { FastCheck, Option } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { builtinProfiles } from "../../../../../../packages/device/src/profiles/profile-catalog";
import { meetingTouchAction } from "../meetings/touch-action";
import { stripLayout, tileAt } from "./geometry";
import {
	createRegistrationSupervisor,
	createSubTouchRegistry,
} from "./sub-touch-registry";
import {
	createStripTouchController,
	type StripKeyEvent,
	type SubTouchEvent,
	type TouchTile,
} from "./touch-controller";
import { normalizeTouch, portraitBounds } from "./touch-geometry";

const touch = (x: number, y: number, action = 1) =>
	({
		source: "mock",
		kind: "touch",
		points: [{ x, y: 480 - y, action }],
	}) satisfies Parameters<
		ReturnType<typeof createStripTouchController>["event"]
	>[0];
function fixture(tile?: TouchTile) {
	const keys: StripKeyEvent[] = [],
		subs: SubTouchEvent[] = [];
	let overlay = false;
	const overlayPoint = vi.fn();
	const controller = createStripTouchController({
		view: () => ({ width: 1920, height: 480, rotation: 0 }),
		layout: () => 0,
		tileAt: (point) =>
			point.x >= 0 && point.x < 200
				? (tile ?? { keyCode: "1,1", supportTouchEffect: true })
				: point.x < 400
					? { keyCode: "1,2", supportTouchEffect: true }
					: undefined,
		onKey: (key) => keys.push(key),
		onSubTouch: (event) => subs.push(event),
		overlay: { active: () => overlay, point: overlayPoint },
		now: () => Date.now(),
		schedule: (action, delay) => {
			const id = setTimeout(action, delay);
			return () => clearTimeout(id);
		},
	});
	return {
		controller,
		keys,
		subs,
		overlayPoint,
		setOverlay: (value: boolean) => {
			overlay = value;
		},
	};
}
describe("strip touch consumer", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());
	it("disposal cancels held and pending releases without successful activation", () => {
		for (const lifted of [false, true]) {
			const f = fixture();
			f.controller.event(touch(20, 20));
			if (lifted) f.controller.event(touch(20, 20, 0));
			f.controller.dispose();
			vi.runAllTimers();
			expect(f.keys).toEqual([
				{ keyCode: "1,1", keyAction: 0 },
				{ keyCode: "1,1", keyAction: 1 },
			]);
		}
	});
	it("link loss cancels held and delayed key ups without a voice touch end", () => {
		for (const lifted of [false, true]) {
			const { controller, keys } = fixture();
			controller.event(touch(20, 20));
			if (lifted) controller.event(touch(20, 20, 0));
			controller.event({
				source: "mock",
				kind: "status",
				state: "disconnected",
				reason: "transport-ended",
			});
			vi.runAllTimers();
			expect(keys).toEqual([
				{ keyCode: "1,1", keyAction: 0 },
				{ keyCode: "1,1", keyAction: 1 },
			]);
			controller.dispose();
		}
	});
	it("holds the original key across slide-off and other tiles, releases anywhere after 10ms", () => {
		const { controller, keys } = fixture();
		controller.event(touch(20, 20));
		controller.event(touch(300, 20));
		controller.event(touch(1900, 20));
		expect(keys).toEqual([{ keyCode: "1,1", keyAction: 0 }]);
		controller.event(touch(1900, 20, 0));
		vi.advanceTimersByTime(9);
		expect(keys).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(keys.at(-1)).toEqual({
			keyCode: "1,1",
			keyAction: 1,
			voiceTouchEnd: true,
		});
		controller.event(touch(20, 20, 0));
		vi.runAllTimers();
		expect(keys).toHaveLength(2);
	});
	it("only the first contact drives input, releases anywhere, and rapid taps preserve ordering", () => {
		const { controller, keys } = fixture();
		controller.event({
			source: "hid",
			kind: "touch",
			points: [
				{ x: 20, y: 460, action: 1 },
				{ x: 300, y: 460, action: 1 },
			],
		});
		controller.event({
			source: "hid",
			kind: "touch",
			points: [
				{ x: 300, y: 460, action: 1 },
				{ x: 1000, y: 0, action: 0 },
			],
		});
		expect(keys).toEqual([{ keyCode: "1,1", keyAction: 0 }]);
		controller.event(touch(1000, 20, 0));
		controller.event(touch(300, 20));
		expect(keys.map((key) => [key.keyCode, key.keyAction])).toEqual([
			["1,1", 0],
			["1,1", 1],
			["1,2", 0],
		]);
		controller.dispose();
		vi.runAllTimers();
		expect(keys.at(-1)?.keyAction).toBe(1);
		expect(vi.getTimerCount()).toBe(0);
	});
	it("overlay owns an entire gesture even after its visible state changes", () => {
		const f = fixture();
		f.setOverlay(true);
		f.controller.event(touch(20, 20));
		f.setOverlay(false);
		f.controller.event(touch(25, 20));
		f.controller.event(touch(25, 20, 0));
		vi.runAllTimers();
		expect(f.keys).toEqual([]);
		expect(f.overlayPoint).toHaveBeenCalledTimes(3);
		f.controller.event(touch(20, 20));
		expect(f.keys).toHaveLength(1);
	});
	it("clickables beat a scroller, then permanently hand off beyond slop", () => {
		const tile = {
			keyCode: "1,1",
			supportTouchEffect: false,
			subTargets: [
				{
					id: "scroll",
					scrollable: true,
					bounds: { x: 0, y: 0, width: 200, height: 200 },
				},
				{
					id: "button",
					scrollable: false,
					bounds: { x: 0, y: 0, width: 100, height: 100 },
				},
			],
		};
		const f = fixture(tile);
		f.controller.event(touch(20, 20));
		f.controller.event(touch(20, 20));
		f.controller.event(touch(20, 37));
		f.controller.event(touch(20, 20));
		f.controller.event(touch(20, 20, 0));
		expect(f.keys).toEqual([]);
		expect(
			f.subs.map((s) => [s.subElementId, s.phase, s.confirmedTap]),
		).toEqual([
			["button", "start", false],
			["button", "end", false],
			["scroll", "start", false],
			["scroll", "move", false],
			["scroll", "move", false],
			["scroll", "end", false],
		]);
	});
	it("16px and 500ms are inclusive tap limits, disconnect and disposal cancel pending clicks", () => {
		const tile = {
			keyCode: "1,1",
			supportTouchEffect: false,
			subTargets: [
				{
					id: "button",
					scrollable: false,
					bounds: { x: 0, y: 0, width: 200, height: 200 },
				},
			],
		};
		const f = fixture(tile);
		f.controller.event(touch(20, 20));
		vi.advanceTimersByTime(500);
		f.controller.event(touch(36, 20, 0));
		expect(f.subs.at(-1)?.confirmedTap).toBe(true);
		f.controller.event(touch(20, 20));
		vi.advanceTimersByTime(501);
		f.controller.event(touch(20, 20, 0));
		expect(f.subs.at(-1)?.confirmedTap).toBe(false);
		f.controller.event(touch(20, 20));
		f.controller.event({
			source: "hid",
			kind: "status",
			state: "disconnected",
			reason: "error",
		});
		expect(f.subs.at(-1)?.confirmedTap).toBe(false);
		f.controller.event(touch(20, 20));
		f.controller.dispose();
		expect(f.subs.at(-1)?.confirmedTap).toBe(false);
	});
});
it("normalizes all rotations and portrait sub-bounds with source-derived geometry", () => {
	for (const rotation of [0, 90, 180, 270, -270, 450])
		expect(
			normalizeTouch(
				{ x: 100, y: 120 },
				{ width: 1920, height: 480, rotation },
			),
		).toEqual(
			[90, 180, -270, 450].includes(rotation)
				? { x: 1820, y: 120 }
				: { x: 100, y: 360 },
		);
	expect(
		portraitBounds({ x: 10, y: 20, width: 100, height: 200 }, 480),
	).toEqual({ x: 20, y: 370, width: 200, height: 100 });
	FastCheck.assert(
		FastCheck.property(
			FastCheck.integer({ min: 0, max: 1920 }),
			FastCheck.integer({ min: 0, max: 480 }),
			(x, y) => {
				for (const rotation of [0, 90, 180, 270]) {
					const view = { width: 1920, height: 480, rotation };
					expect(normalizeTouch(normalizeTouch({ x, y }, view), view)).toEqual({
						x,
						y,
					});
				}
			},
		),
	);
});
it("repairs stale bounds and rescans misses at most once every 500ms while retaining old entries", () => {
	let connected = true;
	let x = 0;
	const liveBounds = () => ({ x, y: 0, width: 44, height: 44 });
	const entry = {
		id: "button",
		scrollable: false,
		bounds: liveBounds(),
		connected: () => connected,
		liveBounds,
	};
	const scan = vi.fn(() => [entry]);
	const registry = createSubTouchRegistry(scan);
	x = 100;
	expect(registry.resolve({ x: 110, y: 10 }, 0)?.id).toBe("button");
	expect(scan).toHaveBeenCalledTimes(1);
	scan.mockReturnValue([]);
	expect(registry.resolve({ x: 500, y: 10 }, 0)).toBeUndefined();
	registry.resolve({ x: 500, y: 10 }, 499);
	expect(scan).toHaveBeenCalledTimes(2);
	registry.resolve({ x: 500, y: 10 }, 500);
	expect(scan).toHaveBeenCalledTimes(3);
	expect(registry.targets()).toHaveLength(1);
	connected = false;
	expect(registry.resolve({ x: 110, y: 10 }, 1000)).toBeUndefined();
});

it("discovers a new clickable over a known scroller after invalidation, retaining throttling", () => {
	const bounds = { x: 0, y: 0, width: 100, height: 100 };
	const scroller = {
		id: "scroll",
		scrollable: true,
		bounds,
		connected: () => true,
		liveBounds: () => bounds,
	};
	const button = { ...scroller, id: "new-button", scrollable: false };
	const scan = vi.fn(() => [scroller]);
	const registry = createSubTouchRegistry(scan);
	const point = { x: 20, y: 20 };
	expect(registry.resolve(point, 0)?.id).toBe("scroll");
	scan.mockReturnValue([scroller, button]);
	registry.invalidate();
	expect(registry.resolve(point, 1)?.id).toBe("new-button");
	expect(registry.targets().map((entry) => entry.id)).toContain("new-button");
	const nextButton = { ...button, id: "next-button" };
	scan.mockReturnValue([scroller, button, nextButton]);
	registry.invalidate();
	expect(registry.resolve(point, 500)?.id).toBe("new-button");
	expect(scan).toHaveBeenCalledTimes(2);
	expect(registry.resolve(point, 501)?.id).toBe("next-button");
	expect(scan).toHaveBeenCalledTimes(3);
	// A transient empty rescan keeps the previously connected entries.
	scan.mockReturnValue([]);
	registry.invalidate();
	expect(registry.resolve(point, 1001)?.id).toBe("next-button");
	expect(registry.targets()).toHaveLength(3);
});

it("activates all five shipped MeetAI keys through native touch without profile flags", () => {
	vi.useFakeTimers();
	try {
		const profile = builtinProfiles("darwin", "en").find((p) => p.id === "1-1");
		if (!profile?.pages[0]) throw new Error("Missing shipped MeetAI");
		const layout = stripLayout(profile, profile.pages[0]);
		const actions = [
			"meetingMinutes",
			"tempMeetingMinutes",
			"meetingRecordMark",
			"liveAudioTranslate",
			"mic",
		];
		const keys: StripKeyEvent[] = [];
		const dispatched: string[] = [];
		const controller = createStripTouchController({
			view: () => ({ width: 1920, height: 480, rotation: 0 }),
			layout: () => layout,
			tileAt,
			onKey: (event) => {
				keys.push(event);
				const action = meetingTouchAction(event, layout);
				if (action) dispatched.push(action);
			},
			onSubTouch: () => {},
			overlay: { active: () => false, point: () => {} },
			now: () => Date.now(),
			schedule: (action, delay) => {
				const timer = setTimeout(action, delay);
				return () => clearTimeout(timer);
			},
		});
		for (const action of actions) {
			const tile = layout.tiles.find((t) => t.type === action);
			if (!tile) throw new Error(`Missing ${action}`);
			controller.event(touch(tile.box.x + 30, tile.box.y + 30));
			controller.event({
				source: "mock",
				kind: "status",
				state: "disconnected",
				reason: "transport-ended",
			});
			expect(dispatched).not.toContain(action);
			controller.event(touch(tile.box.x + 30, tile.box.y + 30));
			controller.event(touch(tile.box.x + 30, tile.box.y + 30, 0));
			vi.advanceTimersByTime(10);
			expect(
				keys.filter(
					(k) =>
						k.keyCode === tile.keyCode && k.keyAction === 1 && k.voiceTouchEnd,
				),
			).toHaveLength(1);
		}
		expect(dispatched).toEqual(actions);
		controller.dispose();
	} finally {
		vi.useRealTimers();
	}
});

it.each(["playAudio", "playAudioLegacy"])(
	"dispatches configured %s touches while preserving system-media sub-controls",
	(type) => {
		vi.useFakeTimers();
		try {
			const profile = builtinProfiles("darwin").find((p) => p.id === "1-6");
			const preset = profile?.pages[0]?.keys[0];
			if (!profile || !preset) throw new Error("Missing player preset");
			for (const local of [true, false]) {
				if (!local && type === "playAudioLegacy") continue;
				const key = {
					...preset,
					config: {
						...preset.config,
						type,
						actions: local
							? [
									{ type: "sound", value: "/private/test.mp3" },
									{ type: "audioAction", value: 0 },
									{ type: "audioFade", value: "0-0" },
									{ type: "volume", value: 50 },
								]
							: preset.config.actions,
					},
				};
				const layout = stripLayout(profile, { keys: [key] });
				const tile = layout.tiles[0];
				if (!tile) throw new Error("Missing player tile");
				const keys: StripKeyEvent[] = [],
					subs: SubTouchEvent[] = [];
				const controller = createStripTouchController({
					view: () => ({ width: 1920, height: 480, rotation: 0 }),
					layout: () => layout,
					tileAt: (point, current) => {
						const hit = tileAt(point, current);
						return hit && !local
							? {
									...hit,
									subTargets: [
										{ id: "play", scrollable: false, bounds: tile.slot },
									],
								}
							: hit;
					},
					onKey: (event) => keys.push(event),
					onSubTouch: (event) => subs.push(event),
					overlay: { active: () => false, point: () => {} },
					now: () => Date.now(),
					schedule: (action, delay) => {
						const timer = setTimeout(action, delay);
						return () => clearTimeout(timer);
					},
				});
				controller.event(touch(tile.slot.x + 30, tile.slot.y + 30));
				controller.event(touch(tile.slot.x + 30, tile.slot.y + 30, 0));
				vi.advanceTimersByTime(10);
				expect(keys).toEqual(
					local
						? [
								{ keyCode: key.keyCode, keyAction: 0 },
								{ keyCode: key.keyCode, keyAction: 1, voiceTouchEnd: true },
							]
						: [],
				);
				expect(subs.filter((event) => event.confirmedTap)).toHaveLength(
					local ? 0 : 1,
				);
				controller.dispose();
			}
		} finally {
			vi.useRealTimers();
		}
	},
);

import {
	createTouchTracker,
	parseTouchReport,
} from "../../../../../../packages/device/src/touch/touch-invariants";
import type { QuakeEvent } from "../../../preload/quake";
import { createPanelKeyDispatcher } from "../keys/panel-key-dispatch";
import { mountMessageScroll } from "./message-scroll";
import { mountStripTouch } from "./mount-strip-touch";
import { mountDiskScroll } from "./tiles/monitor/disk-scroll";
import { mountTouchTarget } from "./touch-gestures";

const bounds = (
	element: Element,
	x: number,
	y: number,
	width: number,
	height: number,
): void => {
	vi.spyOn(element, "getBoundingClientRect").mockImplementation(
		() => new DOMRect(x, y, width, height),
	);
};
function mounted(type = "hotkey") {
	const profile = builtinProfiles("darwin")[0];
	if (!profile) throw new Error("Missing profile");
	const original = profile.pages[0]?.keys[0];
	if (!original) throw new Error("Missing key");
	const key = {
		...original,
		keyCode: "1,1",
		config: {
			...original.config,
			type,
			display: true,
			supportTouchEffect: true,
		},
	};
	let layout = stripLayout(profile, { keys: [key] });
	const root = document.createElement("main");
	root.id = "root";
	root.innerHTML =
		'<div class="strip-slot" data-state="tile" data-key-code="1,1"></div>';
	document.body.append(root);
	bounds(root, 0, 0, 1920, 480);
	const tile = root.querySelector<HTMLElement>(".strip-slot");
	if (!tile) throw new Error("Missing tile");
	bounds(tile, 10, 10, 220, 220);
	let callback: ((event: QuakeEvent) => void) | undefined;
	const off = vi.fn();
	const keys: StripKeyEvent[] = [];
	const cancel = vi.fn();
	const dispose = mountStripTouch(
		root,
		{
			version: "test",
			onQuakeEvent: (listener) => {
				callback = listener;
				return off;
			},
		},
		0,
		() => layout,
		(event) => keys.push(event),
		vi.fn(),
		cancel,
	);
	const tracker = createTouchTracker();
	const raw = (x?: number, y?: number) => {
		// Independent vendor bytes, deliberately not the production fixture encoder.
		const bytes =
			x === undefined || y === undefined
				? Uint8Array.from([0xa3, 91, 3, 0x1a, 0])
				: Uint8Array.from([
						0xa3,
						91,
						3,
						0x1a,
						1,
						1,
						(480 - y) & 255,
						(480 - y) >> 8,
						x & 255,
						x >> 8,
					]);
		const decoded = parseTouchReport(bytes);
		if (Option.isNone(decoded)) throw new Error("Malformed test frame");
		callback?.({
			source: "hid",
			kind: "touch",
			points: tracker.frame(decoded.value),
		});
	};
	return {
		root,
		tile,
		keys,
		off,
		cancel,
		dispose,
		raw,
		emit: (event: QuakeEvent) => callback?.(event),
		replace: (next: typeof layout) => {
			layout = next;
			root.dispatchEvent(new Event("quake-strip-reset"));
		},
		layout,
	};
}

describe("mounted production touch lane", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
			setTimeout(() => callback(performance.now()), 16),
		);
		vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
		vi.stubGlobal("matchMedia", () => ({ matches: false }));
	});
	afterEach(() => {
		window.dispatchEvent(new Event("pagehide"));
		document.body.replaceChildren();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});
	it("disk touch starts at the current native scroll position and clears elastic paint", () => {
		const element = document.createElement("div");
		const content = document.createElement("div");
		element.append(content);
		document.body.append(element);
		Object.defineProperties(element, {
			scrollHeight: { value: 1200 },
			clientHeight: { value: 200 },
		});
		const off = mountDiskScroll(element);
		element.scrollTop = 300;
		content.style.transform = "translateY(20px)";
		const touch = (phase: string, y = 100) =>
			element.dispatchEvent(
				new CustomEvent(
					phase === "end" ? "quake-sub-touch-end" : "quake-sub-touch-start",
					{
						detail: {
							phase,
							x: 100,
							y,
							startX: 100,
							startY: 100,
							isEffective: true,
						},
					},
				),
			);
		touch("start");
		expect(element.scrollTop).toBe(300);
		expect(content.style.transform).toBe("translateY(0px)");
		touch("end");
		expect(element.scrollTop).toBe(300);
		element.scrollTop = 450;
		touch("start");
		touch("move", 70);
		expect(element.scrollTop).toBe(480);
		off();
	});

	it("SCREEN-057 MAIN-065 sends committed down before lift, ignores moves and releases once at 10ms", async () => {
		const f = mounted();
		const calls: string[] = [];
		const dispatcher = createPanelKeyDispatcher(
			() => ({ deviceId: "d", profileId: "p", pageId: "one", revision: 0 }),
			async (request) => {
				if (request.type === "activate") calls.push(request.kind);
				return { _tag: "success" };
			},
		);
		f.root.addEventListener("quake-strip-key", (event) => {
			if (event instanceof CustomEvent) dispatcher.key(event.detail);
		});
		f.raw(100, 100);
		await Promise.resolve();
		expect(calls).toEqual(["down"]);
		f.raw(150, 100);
		f.raw(220, 100);
		f.emit({
			source: "hid",
			kind: "touch",
			points: [{ x: 1900, y: 0, action: 0 }],
		});
		await vi.advanceTimersByTimeAsync(9);
		expect(calls).toEqual(["down"]);
		await vi.advanceTimersByTimeAsync(1);
		expect(calls).toEqual(["down", "up"]);
		f.raw();
		await vi.advanceTimersByTimeAsync(100);
		expect(calls).toEqual(["down", "up"]);
		f.dispose();
	});
	it.each(["pointer", "touch"])(
		"DOM %s events retain the initiating contact across another finger's move, cancel and lift",
		(kind) => {
			const f = mounted();
			const send = (phase: string, id: number, x = 100) => {
				if (kind === "pointer")
					f.tile.dispatchEvent(
						new PointerEvent(`pointer${phase}`, {
							pointerId: id,
							button: 0,
							clientX: x,
							clientY: 100,
							bubbles: true,
							cancelable: true,
						}),
					);
				else {
					const point = new Touch({
						identifier: id,
						target: f.tile,
						clientX: x,
						clientY: 100,
					});
					f.tile.dispatchEvent(
						new TouchEvent(
							`touch${phase === "down" ? "start" : phase === "up" ? "end" : phase}`,
							{ changedTouches: [point], bubbles: true, cancelable: true },
						),
					);
				}
			};
			send("down", 1);
			expect(f.keys).toEqual([{ keyCode: "1,1", keyAction: 0 }]);
			send("down", 2);
			send("move", 2, 220);
			send("cancel", 2);
			send("up", 2);
			vi.advanceTimersByTime(100);
			expect(f.keys).toEqual([{ keyCode: "1,1", keyAction: 0 }]);
			send("up", 1);
			vi.advanceTimersByTime(100);
			expect(f.keys).toEqual([
				{ keyCode: "1,1", keyAction: 0 },
				{ keyCode: "1,1", keyAction: 1, voiceTouchEnd: true },
			]);
			f.dispose();
		},
	);

	it.each(["hotkey", "aiChatView", "cameraView"])(
		"SCREEN-060 shared pointer fallback for %s uses 100ms and suppresses physical duplicates",
		async (type) => {
			const f = mounted(type);
			f.tile.dispatchEvent(
				new PointerEvent("pointerdown", {
					bubbles: true,
					clientX: 100,
					clientY: 100,
					button: 0,
				}),
			);
			expect(f.keys).toHaveLength(1);
			window.dispatchEvent(
				new PointerEvent("pointerup", { clientX: 100, clientY: 100 }),
			);
			vi.advanceTimersByTime(99);
			expect(f.keys).toHaveLength(1);
			vi.advanceTimersByTime(1);
			expect(f.keys).toHaveLength(2);
			f.raw(100, 100);
			f.raw();
			vi.advanceTimersByTime(10);
			const count = f.keys.length;
			f.tile.dispatchEvent(
				new PointerEvent("pointerdown", {
					bubbles: true,
					clientX: 100,
					clientY: 100,
				}),
			);
			window.dispatchEvent(
				new PointerEvent("pointerup", { clientX: 100, clientY: 100 }),
			);
			vi.advanceTimersByTime(100);
			expect(f.keys).toHaveLength(count);
			f.dispose();
		},
	);
	it("KNOB-014 SCREEN-069 SCREEN-070 focuses only effective taps and never navigates or duplicates doubleclick", () => {
		const f = mounted();
		const taps = vi.fn();
		f.root.addEventListener("quake-strip-tile-tap", taps);
		f.raw(100, 100);
		f.raw();
		vi.advanceTimersByTime(10);
		expect(taps).toHaveBeenCalledOnce();
		f.raw(100, 100);
		f.raw(150, 100);
		f.raw();
		vi.advanceTimersByTime(10);
		expect(taps).toHaveBeenCalledOnce();
		const click = new MouseEvent("dblclick", {
			bubbles: true,
			cancelable: true,
		});
		f.tile.dispatchEvent(click);
		expect(click.defaultPrevented).toBe(true);
		expect(f.keys).toHaveLength(4);
		f.dispose();
	});
	it("SCREEN-010 resets old profile gestures and disposes pending lift, observers and bridge exactly once", () => {
		const f = mounted();
		f.raw(100, 100);
		f.raw();
		f.replace(f.layout);
		vi.advanceTimersByTime(100);
		expect(f.keys.at(-1)).toEqual({ keyCode: "1,1", keyAction: 1 });
		window.dispatchEvent(new Event("pagehide"));
		f.dispose();
		const count = f.keys.length;
		f.raw(100, 100);
		vi.advanceTimersByTime(10000);
		expect(f.keys).toHaveLength(count);
		expect(f.off).toHaveBeenCalledOnce();
	});
	it("profile reset preserves a fresh next contact and a replaced same-id child cannot receive an old release", () => {
		const f = mounted("aiChatView"),
			button = document.createElement("button");
		button.dataset.quakeSubTouch = "card";
		f.tile.append(button);
		bounds(button, 50, 50, 100, 60);
		const old = vi.fn(),
			next = vi.fn();
		const off = mountTouchTarget(button, { tap: old });
		f.raw(80, 80);
		const replacement = button.cloneNode(true);
		button.replaceWith(replacement);
		if (!(replacement instanceof HTMLElement))
			throw new Error("Missing replacement");
		bounds(replacement, 50, 50, 100, 60);
		const offNext = mountTouchTarget(replacement, { tap: next });
		f.raw();
		expect(next).not.toHaveBeenCalled();
		expect(old).not.toHaveBeenCalled();
		f.replace(f.layout);
		vi.advanceTimersByTime(500);
		f.raw(80, 80);
		f.raw();
		expect(next).toHaveBeenCalledOnce();
		off();
		offNext();
		f.dispose();
	});
	it("SCREEN-060 touch fallback cancels special and ordinary contacts and ignores disabled targets", () => {
		for (const type of ["hotkey", "aiChatView", "cameraView"]) {
			const f = mounted(type);
			const send = (name: string) => {
				const event = new Event(name, { bubbles: true, cancelable: true });
				Object.defineProperty(event, "changedTouches", {
					value: [{ clientX: 100, clientY: 100 }],
				});
				f.tile.dispatchEvent(event);
			};
			send("touchstart");
			expect(f.keys.at(-1)?.keyAction).toBe(0);
			send("touchcancel");
			vi.advanceTimersByTime(100);
			expect(f.keys.at(-1)).toEqual({ keyCode: "1,1", keyAction: 1 });
			f.tile.setAttribute("inert", "");
			const before = f.keys.length;
			send("touchstart");
			send("touchend");
			vi.advanceTimersByTime(100);
			expect(f.keys).toHaveLength(before);
			f.dispose();
			f.root.remove();
		}
	});

	it("KNOB-075 KNOB-080 KNOB-089 late volume control owns native input and suppresses synthetic click", () => {
		const f = mounted();
		const button = document.createElement("button");
		button.dataset.quakeOverlayTouch = "true";
		button.dataset.quakeSubTouch = "volumeOsd";
		f.root.append(button);
		bounds(button, 50, 50, 120, 60);
		const toggle = vi.fn();
		const off = mountTouchTarget(button, { tap: toggle });
		button.addEventListener("click", toggle);
		f.raw(100, 80);
		expect(button.dataset.touchPressed).toBe("true");
		expect(toggle).not.toHaveBeenCalled();
		f.raw();
		button.click();
		expect(toggle).toHaveBeenCalledOnce();
		expect(f.keys).toEqual([]);
		f.raw(100, 80);
		f.raw(160, 80);
		f.raw();
		expect(toggle).toHaveBeenCalledOnce();
		button.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
		button.dispatchEvent(
			new KeyboardEvent("keydown", { key: " ", bubbles: true }),
		);
		expect(toggle).toHaveBeenCalledTimes(3);
		off();
		f.dispose();
	});
	it("SCREEN-065 scaled targets retain pressed feedback, cutoff, and slop through native routing", () => {
		const f = mounted("aiChatView");
		const button = document.createElement("button");
		button.dataset.quakeSubTouch = "card";
		f.tile.append(button);
		bounds(button, 50, 50, 20, 20);
		const tap = vi.fn();
		const off = mountTouchTarget(button, { scale: 2, tap });
		expect(button.style.minHeight).toBe("88px");
		f.raw(60, 60);
		expect(button.style.filter).toBe("brightness(1.08)");
		f.raw(90, 60);
		f.raw();
		expect(tap).toHaveBeenCalledOnce();
		f.raw(60, 60);
		vi.advanceTimersByTime(501);
		f.raw();
		expect(tap).toHaveBeenCalledOnce();
		f.raw(60, 60);
		f.raw(94, 60);
		f.raw(60, 60);
		f.raw();
		expect(tap).toHaveBeenCalledOnce();
		expect(button.dataset.touchPressed).toBe("false");
		off();
		f.dispose();
	});
	it("SCREEN-066 retries five times at 2s, globally scans three times at least 3s apart and cancels", () => {
		const attempts: number[] = [],
			scans: number[] = [],
			states: string[] = [];
		const registration = createRegistrationSupervisor({
			now: () => performance.now(),
			schedule: (run, delay) => {
				const timer = setTimeout(run, delay);
				return () => clearTimeout(timer);
			},
			request: () => {
				attempts.push(performance.now());
				return false;
			},
			globalRescan: () => {
				scans.push(performance.now());
				return false;
			},
			change: (state) => states.push(state),
		});
		expect(registration.snapshot().state).toBe("idle");
		registration.request();
		vi.advanceTimersByTime(10000);
		expect(attempts).toHaveLength(5);
		expect(scans).toHaveLength(3);
		expect(
			attempts.slice(1).every((time, i) => time - (attempts[i] ?? 0) >= 2000),
		).toBe(true);
		expect(
			scans.slice(1).every((time, i) => time - (scans[i] ?? 0) >= 3000),
		).toBe(true);
		expect(states).toContain("requesting");
		expect(registration.snapshot().state).toBe("failed");
		registration.noteDispatch();
		expect(registration.snapshot().state).toBe("registered");
		registration.dispose();
		vi.advanceTimersByTime(10000);
		expect(attempts).toHaveLength(5);
	});
	it.each([false, true])(
		"WIDGETS-078 SCREEN-067 native disk drag flings unless reduced=%s and paints bounded elastic return",
		(reduce) => {
			vi.stubGlobal("matchMedia", () => ({ matches: reduce }));
			const f = mounted("systemMonitorPanel");
			const scroller = document.createElement("section");
			scroller.innerHTML = "<div>Disk rows</div>";
			scroller.dataset.quakeSubTouch = "smDiskList";
			scroller.dataset.supportQuakeMove = "true";
			f.tile.append(scroller);
			bounds(scroller, 0, 0, 500, 480);
			Object.defineProperties(scroller, {
				scrollHeight: { value: 1200 },
				clientHeight: { value: 200 },
			});
			const off = mountDiskScroll(scroller);
			f.raw(100, 200);
			vi.advanceTimersByTime(20);
			f.raw(100, 150);
			vi.advanceTimersByTime(20);
			f.raw(100, 100);
			f.raw();
			const lifted = scroller.scrollTop;
			vi.advanceTimersByTime(100);
			expect(scroller.scrollTop > lifted).toBe(!reduce);
			expect(f.keys).toEqual([]);
			vi.advanceTimersByTime(700);
			const stopped = scroller.scrollTop;
			vi.advanceTimersByTime(200);
			expect(scroller.scrollTop).toBe(stopped);
			scroller.scrollTop = 0;
			off();
			const next = mountDiskScroll(scroller);
			f.raw(100, 100);
			vi.advanceTimersByTime(20);
			f.raw(100, 180);
			expect(scroller.firstElementChild?.getAttribute("style")).toContain(
				"translateY(32px)",
			);
			f.raw();
			vi.advanceTimersByTime(208);
			expect(scroller.firstElementChild?.getAttribute("style")).toContain(
				"translateY(0px)",
			);
			next();
			f.dispose();
		},
	);
	it.each([false, true])(
		"AI-163 chat drag completion refreshes a moved child after fling or reduced=%s",
		(reduce) => {
			const f = mounted("aiChatView");
			const scroller = document.createElement("div"),
				button = document.createElement("button");
			scroller.dataset.quakeSubTouch = "quakeBotIconViewMessages";
			scroller.dataset.supportQuakeMove = "true";
			button.dataset.quakeSubTouch = "child";
			scroller.append(button);
			f.tile.append(scroller);
			bounds(scroller, 0, 0, 500, 480);
			Object.defineProperties(scroller, {
				scrollHeight: { value: 1200 },
				clientHeight: { value: 200 },
			});
			vi.spyOn(button, "getBoundingClientRect").mockImplementation(
				() =>
					new DOMRect(50, (reduce ? 260 : 860) - scroller.scrollTop, 100, 44),
			);
			const tap = vi.fn(),
				offTap = mountTouchTarget(button, { tap }),
				off = mountMessageScroll(scroller, () => reduce);
			const refreshed = vi.fn();
			scroller.addEventListener("quake-touch-rescan", refreshed);
			f.raw(200, 200);
			vi.advanceTimersByTime(25);
			f.raw(200, 150);
			vi.advanceTimersByTime(25);
			f.raw(200, 100);
			f.raw();
			const lifted = scroller.scrollTop;
			vi.advanceTimersByTime(1200);
			expect(scroller.scrollTop > lifted).toBe(!reduce);
			expect(refreshed).toHaveBeenCalledOnce();
			const moved = button.getBoundingClientRect();
			expect(moved.y).toBeGreaterThan(0);
			expect(moved.bottom).toBeLessThan(480);
			f.raw(75, moved.y + 20);
			f.raw();
			expect(tap).toHaveBeenCalledOnce();
			expect(f.keys).toEqual([]);
			f.raw(200, 200);
			vi.advanceTimersByTime(25);
			f.raw(200, 150);
			f.emit({
				source: "hid",
				kind: "status",
				state: "disconnected",
				reason: "transport-ended",
			});
			const cancelled = scroller.scrollTop;
			vi.advanceTimersByTime(1200);
			expect(scroller.scrollTop).toBe(cancelled);
			expect(tap).toHaveBeenCalledOnce();
			off();
			offTap();
			f.dispose();
		},
	);
});
