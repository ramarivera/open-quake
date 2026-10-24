import { FastCheck } from "effect";
import { describe, expect, it } from "vitest";
import {
	activeThemeOf,
	buildClockThemePatch,
	type ClockKey,
	cycleTheme,
	isThemeId,
	mediaKindOfPath,
	normalizeClockStyle,
	resolveBackground,
	THEME_IDS,
} from "./clock-style";

const clockKey = (actions: ClockKey["config"]["actions"]): ClockKey => ({
	keyCode: "1,1",
	childrenName: "dkDesktopClock",
	config: { type: "dkDesktopClock", actions },
});

describe("clock style contract (WIDGETS-031/033/034/062)", () => {
	it("keeps DK-Suite's fixed theme order and default", () => {
		expect(THEME_IDS).toEqual([
			"season",
			"cyber",
			"anime",
			"tactical",
			"aurora",
		]);
		expect(normalizeClockStyle(undefined)).toEqual({
			background: { mode: "theme", themeId: "season", themes: {} },
			musicEnabled: false,
		});
	});

	it("validates v0.4 slots one by one and drops invalid ones", () => {
		expect(
			normalizeClockStyle({
				background: {
					mode: "theme",
					themeId: "cyber",
					themes: {
						cyber: { kind: "video", path: "/m/rain.mp4" },
						anime: { kind: "gif", path: "/m/x.gif" },
						aurora: { kind: "image", path: "   " },
						bogus: { kind: "image", path: "/m/y.png" },
					},
				},
				musicEnabled: true,
			}),
		).toEqual({
			background: {
				mode: "theme",
				themeId: "cyber",
				themes: { cyber: { kind: "video", path: "/m/rain.mp4" } },
			},
			musicEnabled: true,
		});
	});

	it("migrates v0.3 styles the way DK-Suite does", () => {
		expect(
			normalizeClockStyle({ background: { mode: "builtin", source: "aurora" } })
				.background,
		).toEqual({ mode: "theme", themeId: "aurora", themes: {} });
		expect(
			normalizeClockStyle({
				background: { mode: "video", source: "/v/rain.mp4" },
			}).background,
		).toEqual({
			mode: "theme",
			themeId: "season",
			themes: { season: { kind: "video", path: "/v/rain.mp4" } },
		});
		// The extension wins over the old mode when they disagree.
		expect(
			normalizeClockStyle({ background: { mode: "video", source: "/p/a.PNG" } })
				.background.themes.season?.kind,
		).toBe("image");
		expect(
			normalizeClockStyle({ background: { mode: "image", source: "" } })
				.background,
		).toEqual({ mode: "theme", themeId: "season", themes: {} });
		expect(
			normalizeClockStyle({ background: { mode: "none" } }).background.mode,
		).toBe("none");
	});

	it("is total and idempotent for any JSON input", () => {
		FastCheck.assert(
			FastCheck.property(FastCheck.jsonValue(), (value) => {
				const once = normalizeClockStyle(value);
				expect(isThemeId(once.background.themeId)).toBe(true);
				expect(["none", "theme"]).toContain(once.background.mode);
				expect(normalizeClockStyle(once)).toEqual(once);
			}),
		);
	});

	it("resolves custom media with its theme so fallback uses that theme's art", () => {
		const style = normalizeClockStyle({
			background: {
				mode: "theme",
				themeId: "aurora",
				themes: { aurora: { kind: "video", path: "/v/a.webm" } },
			},
		});
		expect(resolveBackground(style.background)).toEqual({
			kind: "video",
			themeId: "aurora",
			slot: { kind: "video", path: "/v/a.webm" },
		});
		expect(
			resolveBackground({ ...style.background, themeId: "season" }),
		).toEqual({ kind: "builtin", themeId: "season" });
		expect(resolveBackground({ ...style.background, mode: "none" })).toEqual({
			kind: "none",
		});
		expect(
			activeThemeOf({
				...style,
				background: { ...style.background, mode: "none" },
			}),
		).toBe("none");
	});

	it("cycles with wrap and starts from season when the background is None", () => {
		expect(cycleTheme("aurora", 1)).toBe("season");
		expect(cycleTheme("season", -1)).toBe("aurora");
		expect(cycleTheme("cyber", 1)).toBe("anime");
		expect(cycleTheme(null, 1)).toBe("cyber");
		expect(cycleTheme(null, -1)).toBe("aurora");
	});

	it("maps extensions case-insensitively and keeps image and video apart", () => {
		for (const ext of ["jpg", "JPEG", "png", "gif", "webp", "bmp"])
			expect(mediaKindOfPath(`/a/b.${ext}`)).toBe("image");
		for (const ext of ["mp4", "WEBM", "mov", "mkv"])
			expect(mediaKindOfPath(`/a/b.${ext}`)).toBe("video");
		expect(mediaKindOfPath("/a/b.svg")).toBeNull();
		expect(mediaKindOfPath("/a/noext")).toBeNull();
	});
});

describe("narrow theme patch (WIDGETS-038)", () => {
	const style = {
		type: "clockStyle",
		value: {
			background: {
				mode: "none",
				themeId: "season",
				themes: { aurora: { kind: "video", path: "/v/a.webm" } },
			},
			musicEnabled: true,
			updatedAt: 42,
		},
	};
	const keys: readonly ClockKey[] = [
		{
			keyCode: "2,1",
			config: { type: "cpu", actions: [{ type: "x", value: 1 }] },
		},
		clockKey([
			{ type: "hourFormat", value: "12h" },
			style,
			{ type: "showSeconds", value: true },
		]),
	];

	it("changes only themeId and mode, in place, without mutating the input", () => {
		const before = JSON.stringify(keys);
		const result = buildClockThemePatch(keys, "1,1", "cyber");
		expect(JSON.stringify(keys)).toBe(before);
		expect(result).toEqual({
			ok: true,
			changed: true,
			keys: [
				keys[0],
				clockKey([
					{ type: "hourFormat", value: "12h" },
					{
						type: "clockStyle",
						value: {
							...style.value,
							background: {
								...style.value.background,
								mode: "theme",
								themeId: "cyber",
							},
						},
					},
					{ type: "showSeconds", value: true },
				]),
			],
		});
		if (result.ok) expect(result.keys[0]).toBe(keys[0]);
	});

	it("reports no change when the theme is already active", () => {
		const once = buildClockThemePatch(keys, "1,1", "cyber");
		if (!once.ok) throw new Error("patch failed");
		const twice = buildClockThemePatch(once.keys, " 1,1 ", "cyber");
		expect(twice).toMatchObject({ ok: true, changed: false });
	});

	it("appends a default clockStyle when the key has none", () => {
		const result = buildClockThemePatch([clockKey([])], "1,1", "anime");
		expect(result).toMatchObject({
			ok: true,
			keys: [
				clockKey([
					{
						type: "clockStyle",
						value: {
							background: { mode: "theme", themeId: "anime", themes: {} },
							musicEnabled: false,
						},
					},
				]),
			],
		});
	});

	it("fails with DK-Suite's reasons", () => {
		expect(buildClockThemePatch(keys, "1;1", "cyber")).toEqual({
			ok: false,
			reason: "invalid-keycode",
		});
		expect(buildClockThemePatch(keys, "1,1", "neon")).toEqual({
			ok: false,
			reason: "invalid-theme",
		});
		expect(buildClockThemePatch(keys, "3,1", "cyber")).toEqual({
			ok: false,
			reason: "cell-missing",
		});
		expect(buildClockThemePatch(keys, "2,1", "cyber")).toEqual({
			ok: false,
			reason: "cell-not-clock",
		});
	});

	it("never touches any key but the target (property)", () => {
		FastCheck.assert(
			FastCheck.property(
				FastCheck.array(
					FastCheck.record({
						keyCode: FastCheck.tuple(FastCheck.nat(9), FastCheck.nat(9)).map(
							([a, b]) => `${a},${b}`,
						),
						config: FastCheck.record({
							type: FastCheck.constantFrom("dkDesktopClock", "cpu", ""),
							actions: FastCheck.array(
								FastCheck.record({
									type: FastCheck.constantFrom("clockStyle", "hourFormat", "x"),
									value: FastCheck.jsonValue(),
								}),
								{ maxLength: 3 },
							),
						}),
					}),
					{ maxLength: 6 },
				),
				FastCheck.constantFrom(...THEME_IDS),
				(input, themeId) => {
					const target = input.find(
						(key) => key.config.type === "dkDesktopClock",
					);
					if (!target) return;
					const result = buildClockThemePatch(input, target.keyCode, themeId);
					if (!result.ok) return;
					const index = input.findIndex(
						(key) => key.keyCode === target.keyCode,
					);
					result.keys.forEach((key, i) => {
						if (i !== index) expect(key).toBe(input[i]);
					});
					expect(result.keys).toHaveLength(input.length);
				},
			),
		);
	});
});
