import { FastCheck } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { builtinProfiles } from "../../../../../../packages/device/src/profiles/profile-catalog";
import { meetingTouchAction } from "../meetings/touch-action";
import { stripLayout, tileAt } from "./geometry";
import { createSubTouchRegistry } from "./sub-touch-registry";
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
