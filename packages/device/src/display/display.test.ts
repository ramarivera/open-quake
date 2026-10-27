import { describe, expect, it } from "@effect/vitest";
import {
	Effect,
	FastCheck,
	Fiber,
	Ref,
	Schema,
	Stream,
	TestClock,
} from "effect";
import { displayClock } from "./display-clock.js";
import {
	AssetReference,
	DesktopClockTile,
	DisplayMedia,
	defaultClockTile,
	defaultWallpaper,
	displayTileRegistry,
	ResourceRequest,
	SavedWallpaper,
	StaticWallpaperSettings,
	WallpaperSettings,
} from "./display-contracts.js";
import {
	fillGeometry,
	formatClock,
	hasVerifiedResourceTarget,
	intervalMillis,
	nextWallpaperIndex,
	reorderWallpaper,
} from "./display-invariants.js";

const image = {
	name: "corners.png",
	type: "image",
	filePath: `media:${"a".repeat(64)}`,
	duration: 5000,
	format: "image/png",
} as const;
const settings = { ...defaultWallpaper, displayMediaList: [image] };
const request = {
	deviceId: "A",
	profileId: "profile",
	pageId: "page",
	revision: 1,
	assetId: image.filePath,
	format: "jpeg",
	target: { _tag: "full-panel", capabilityId: "unknown" },
} as const;

describe("display contracts", () => {
	it("round trips every wallpaper field and the serial envelope", () => {
		const value = {
			version: 1,
			serial: "A",
			revision: 1,
			settings,
			clock: defaultClockTile,
		};
		const encoded = Schema.encodeSync(SavedWallpaper)(
			Schema.decodeUnknownSync(SavedWallpaper)(value),
		);
		expect(encoded).toEqual(value);
		expect(
			Schema.is(WallpaperSettings)({
				...settings,
				gapInterval: 2,
				gapIntervalUnit: 1,
				displayMediaList: [{ ...image, duration: 120000 }],
			}),
		).toBe(true);
		expect(
			Schema.is(WallpaperSettings)({
				...settings,
				playMode: "random",
				isTransparent: true,
			}),
		).toBe(true);
	});
	it.each([
		{ bgFillMode: "stretch" },
		{ gapInterval: 2 },
		{ gapInterval: 86401 },
		{ gapInterval: 0, gapIntervalUnit: 1 },
		{ gapInterval: 1441, gapIntervalUnit: 1 },
		{ gapInterval: 3.5 },
		{ gapIntervalUnit: 2 },
		{ playMode: "shuffle" },
		{ isTransparent: "false" },
		{ displayMediaList: [{ ...image, name: "" }] },
		{ displayMediaList: [{ ...image, duration: -1 }] },
		{ displayMediaList: [{ ...image, duration: Number.POSITIVE_INFINITY }] },
		{ displayMediaList: [{ ...image, duration: 2 }] },
		{ displayMediaList: [{ ...image, format: "image/bmp" }] },
		{ displayMediaList: [{ ...image, filePath: "file:///private/image.png" }] },
	])("rejects invalid wallpaper patch %j", (patch) => {
		expect(Schema.is(WallpaperSettings)({ ...settings, ...patch })).toBe(false);
	});
	it("WIDGETS-128/131 accepts transparent saved settings and GIF/MKV/AVI media", () => {
		for (const [type, format] of [
			["image", "image/gif"],
			["video", "video/x-matroska"],
			["video", "video/x-msvideo"],
		]) {
			expect(
				Schema.is(SavedWallpaper)({
					version: 1,
					serial: "A",
					revision: 0,
					clock: defaultClockTile,
					settings: {
						...settings,
						isTransparent: true,
						displayMediaList: [{ ...image, type, format }],
					},
				}),
			).toBe(true);
		}
	});
	it("separates later media support from the static release", () => {
		const video = {
			...image,
			type: "video",
			format: "video/mp4",
			duration: 2000,
		};
		expect(Schema.is(DisplayMedia)(video)).toBe(true);
		expect(Schema.is(DisplayMedia)({ ...video, duration: 1999 })).toBe(false);
		for (const patch of [
			{ isTransparent: true },
			{ displayMediaList: [image, image] },
			{ displayMediaList: [video] },
		])
			expect(
				Schema.is(StaticWallpaperSettings)({ ...settings, ...patch }),
			).toBe(false);
		expect(Schema.is(AssetReference)("media:../../outside")).toBe(false);
	});
	it("requires exactly one clock format action and defaults to 24h", () => {
		expect(displayTileRegistry.dkDesktopClock.defaults.actions).toEqual([
			{ type: "hourFormat", value: "24h" },
		]);
		for (const actions of [
			[],
			[{ type: "hourFormat", value: "13h" }],
			[...defaultClockTile.actions, ...defaultClockTile.actions],
		])
			expect(
				Schema.is(DesktopClockTile)({ type: "dkDesktopClock", actions }),
			).toBe(false);
	});
	it("rejects unknown, invalid, guessed, and unsupported targets", () => {
		expect(Schema.is(ResourceRequest)(request)).toBe(true);
		expect(hasVerifiedResourceTarget(request, [])).toBe(false);
		expect(
			Schema.is(ResourceRequest)({
				...request,
				target: { _tag: "key", key: { row: 0, column: 0 } },
			}),
		).toBe(false);
		expect(
			Schema.is(ResourceRequest)({ ...request, target: { _tag: "unknown" } }),
		).toBe(false);
		const capability = {
			deviceId: "A",
			firmware: "fixture-only",
			evidence: "test fixture, no hardware",
			targets: [request.target],
		};
		expect(hasVerifiedResourceTarget(request, [capability])).toBe(true);
		expect(
			hasVerifiedResourceTarget({ ...request, deviceId: "B" }, [capability]),
		).toBe(false);
		expect(
			hasVerifiedResourceTarget(
				{
					...request,
					target: { _tag: "full-panel", capabilityId: "different" },
				},
				[capability],
			),
		).toBe(false);
	});
});

describe("pure canvas and interval rules", () => {
	it("fits, crops, and centers without stretching", () => {
		expect(fillGeometry("contain", 480, 480)).toEqual({
			x: 720,
			y: 0,
			width: 480,
			height: 480,
		});
		expect(fillGeometry("cover", 480, 480)).toEqual({
			x: 0,
			y: -720,
			width: 1920,
			height: 1920,
		});
		expect(fillGeometry("center", 2400, 600)).toEqual({
			x: -240,
			y: -60,
			width: 2400,
			height: 600,
		});
		expect(fillGeometry("cover", 0, Number.NaN)).toEqual({
			x: 0,
			y: 0,
			width: 0,
			height: 0,
		});
	});
	it.prop(
		"preserves aspect ratio and covers or contains the canvas",
		{
			width: FastCheck.integer({ min: 1, max: 16000 }),
			height: FastCheck.integer({ min: 1, max: 16000 }),
		},
		({ width, height }) => {
			const contain = fillGeometry("contain", width, height);
			const cover = fillGeometry("cover", width, height);
			expect(contain.width / contain.height).toBeCloseTo(width / height);
			expect(contain.width).toBeLessThanOrEqual(1920.00001);
			expect(contain.height).toBeLessThanOrEqual(480.00001);
			expect(cover.width).toBeGreaterThanOrEqual(1919.99999);
			expect(cover.height).toBeGreaterThanOrEqual(479.99999);
		},
	);
	it.prop(
		"converts all valid minute intervals",
		{ minutes: FastCheck.integer({ min: 1, max: 1440 }) },
		({ minutes }) => {
			expect(intervalMillis(minutes, 1)).toBe(minutes * 60000);
		},
	);
	it("converts seconds and rejects invalid intervals", () => {
		expect(intervalMillis(5, 0)).toBe(5000);
		expect(intervalMillis(2, 1)).toBe(120000);
		for (const n of [
			-1,
			0,
			2,
			3.1,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			86401,
		])
			expect(intervalMillis(n, 0)).toBe(0);
	});
});

describe("host clock", () => {
	it("formats midnight, noon and both hour formats", () => {
		const snap = { epochMillis: 0, hour: 0, minute: 0, second: 0 };
		expect(formatClock(snap, "24h")).toBe("00:00:00");
		expect(formatClock(snap, "12h")).toBe("12:00:00 AM");
		expect(formatClock({ ...snap, hour: 12 }, "12h")).toBe("12:00:00 PM");
		expect(
			formatClock({ ...snap, hour: 23, minute: 59, second: 59 }, "12h"),
		).toBe("11:59:59 PM");
	});
	it.scoped(
		"publishes once per second across midnight and stops on disposal",
		() =>
			Effect.gen(function* () {
				const midnight = new Date(2026, 9, 23, 23, 59, 59).getTime();
				yield* TestClock.setTime(midnight);
				const frames = yield* Ref.make<readonly string[]>([]);
				const fiber = yield* displayClock.pipe(
					Stream.runForEach((snapshot) =>
						Ref.update(frames, (items) => [
							...items,
							formatClock(snapshot, "24h"),
						]),
					),
					Effect.forkScoped,
				);
				yield* TestClock.adjust(999);
				expect(yield* Ref.get(frames)).toEqual(["23:59:59"]);
				yield* TestClock.adjust(1);
				expect(yield* Ref.get(frames)).toEqual(["23:59:59", "00:00:00"]);
				yield* TestClock.adjust(1000);
				expect(yield* Ref.get(frames)).toHaveLength(3);
				yield* Fiber.interrupt(fiber);
				yield* TestClock.adjust(3000);
				expect(yield* Ref.get(frames)).toHaveLength(3);
			}),
	);
});

it("migrates sound off and preserves a playlist permutation", () => {
	const old = { ...defaultWallpaper };
	const { enableSound: _sound, ...withoutSound } = old;
	expect(
		Schema.decodeUnknownSync(WallpaperSettings)(withoutSound).enableSound,
	).toBe(false);
	const items = ["first", "second", "third"];
	expect(reorderWallpaper(items, 2, 0)).toEqual(["third", "first", "second"]);
	expect(items).toEqual(["first", "second", "third"]);
	for (const index of [-1, 3, NaN, 0.5])
		expect(reorderWallpaper(items, index, 0)).toBe(items);
	for (let i = 0; i < 10; i++)
		expect(nextWallpaperIndex(i % 3, 3, "sequential")).toBe((i + 1) % 3);
	for (const random of [0, 0.2, 0.5, 0.99, 1])
		expect(nextWallpaperIndex(1, 3, "random", random)).not.toBe(1);
	expect(nextWallpaperIndex(0, 1, "random")).toBe(0);
});
