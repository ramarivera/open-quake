import { Option, Schema } from "effect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
	builtinProfiles,
	translateProfile,
} from "../../../../../../packages/device/src/profiles/profile-catalog";
import { createInitialProfileEnvelope } from "../../../../../../packages/device/src/profiles/profile-contracts";
import { installProfileCatalog } from "../../../../../../packages/device/src/profiles/profile-manager-invariants";
import {
	clockProfile,
	meetAiProfile,
	quickProfile,
	spansProfile,
	stripFixtureEnvelope,
	vividProfile,
} from "../../../main/test/strip-fixtures";
import { defaultClockTile, defaultWallpaper } from "../../../shared/display";
import { ProfileEnvelope } from "../../../shared/profiles";
import type { WallpaperSnapshot } from "../../../shared/wallpaper-contracts";
import { resolveProfileTheme, STRIP_THEMES, stripLayout } from "./geometry";
import { previewVoiceContext } from "./overlays/voice/voice-context";
import { StripScreen } from "./StripScreen";
import { selectStripPage } from "./selection";
import {
	defaultStripSettings,
	parseStripSettings,
	validateStripSettings,
} from "./stripSettings";
import { genericTileMetrics, isInlineIcon, truncateTitle } from "./tileMetrics";
import { stripTileFor, stripTileRegistry } from "./tileRegistry";
import { GenericTile } from "./tiles/GenericTile";
import { type StripProfiles, subscribeStripProfiles } from "./useStripProfiles";

const decode = Schema.decodeUnknownSync(ProfileEnvelope);
const ready = (active = quickProfile, serial = "smoke-A"): StripProfiles => ({
	_tag: "ready",
	envelope: decode(stripFixtureEnvelope(active, serial)),
});
const wallpaper: WallpaperSnapshot = {
	saved: {
		version: 1,
		serial: "smoke-A",
		revision: 1,
		settings: defaultWallpaper,
		clock: defaultClockTile,
	},
	asset: {
		_tag: "ready",
		dataUrl: "data:image/png;base64,YQ==",
		width: 480,
		height: 480,
	},
	clock: {
		epochMillis: Date.UTC(2026, 9, 24, 0, 0, 0),
		hour: 0,
		minute: 0,
		second: 0,
	},
	recovered: false,
	normalizedFileUrl: false,
	deviceDelivery: "unverified",
};
const render = (props: Parameters<typeof StripScreen>[0]): string =>
	renderToStaticMarkup(createElement(StripScreen, props));
const count = (markup: string, needle: string): number =>
	markup.split(needle).length - 1;

describe("strip screen", () => {
	it("keeps actual catalog geometry stable across eight locales and legacy metadata", () => {
		for (const [id, theme] of [
			["1-1", "meetingAssistantTheme"],
			["1-3", "systemInfoTheme"],
		] as const) {
			const source = builtinProfiles("darwin").find(
				(profile) => profile.id === id,
			);
			if (!source) throw new Error("Missing catalog fixture");
			const geometry = (profile: typeof source) =>
				stripLayout(profile, profile.pages[0]).tiles.map((tile) => ({
					box: tile.box,
					slot: tile.slot,
					cellTheme: tile.cellTheme,
				}));
			const baseline = geometry(source);
			for (const locale of [
				"en",
				"zh",
				"de",
				"fr",
				"it",
				"es",
				"ja",
				"ko",
			] as const) {
				const localized = builtinProfiles("darwin", locale).find(
					(profile) => profile.id === id,
				);
				if (!localized) throw new Error("Missing localized fixture");
				const legacy = {
					...source,
					compatibility: Option.some({ builtin: "legacy", retained: true }),
				};
				for (const profile of [localized, translateProfile(legacy, locale)]) {
					expect(resolveProfileTheme(profile)).toBe(theme);
					expect(geometry(profile)).toEqual(baseline);
				}
			}
		}
	});

	it("renders a visible macOS profile without a saved preview and preserves valid selections", () => {
		const envelope = installProfileCatalog(
			createInitialProfileEnvelope(),
			"darwin",
		);
		expect(envelope.activeByDevice).toEqual({});
		for (const serial of [undefined, "desktop-preview"]) {
			expect(selectStripPage(envelope, serial).profile.id).toBe("1-1");
			const legacyHidden = {
				...envelope,
				activeByDevice: {
					"desktop-preview": { profileId: "1-0", pageId: "1" },
				},
			};
			expect(selectStripPage(legacyHidden, serial).profile.id).toBe("1-1");
		}
		expect(
			render({
				profiles: { _tag: "ready", envelope },
				showEmptyGridDashedBorder: true,
			}),
		).toContain('data-theme="meetingAssistantTheme"');
		const saved = {
			...envelope,
			activeByDevice: { "desktop-preview": { profileId: "1-2", pageId: "1" } },
		};
		expect(selectStripPage(saved, "desktop-preview").profile.id).toBe("1-2");
		expect(installProfileCatalog(saved, "darwin")).toBe(saved);
	});

	it("draws the active page's grid on black, identically in panel and preview", () => {
		const props = {
			profiles: ready(),
			wallpaper,
			showEmptyGridDashedBorder: true,
		};
		const panel = render(props);
		expect(render(structuredClone(props))).toBe(panel);
		expect(panel).toContain('data-theme="commonBaseTheme"');
		expect(count(panel, 'data-state="tile"')).toBe(12);
		expect(count(panel, 'data-state="empty"')).toBe(4);
		expect(panel).toContain(">Mission Control</p>");
		// The wallpaper stays underneath the opaque grid (QSV:46-68).
		expect(panel).not.toContain("<image");
		expect(panel).toContain("width:1920px;height:480px");
	});

	it("shows only black until the first snapshot arrives", () => {
		const markup = render({
			profiles: { _tag: "loading" },
			wallpaper,
			showEmptyGridDashedBorder: true,
		});
		expect(markup).not.toContain('class="strip-slot"');
		expect(markup).not.toContain("<image");
	});

	it("shows the wallpaper and no grid on the vivid page", () => {
		const markup = render({
			profiles: ready(vividProfile),
			wallpaper,
			showEmptyGridDashedBorder: true,
		});
		expect(markup).toContain('data-vivid="true"');
		expect(markup).toContain("<image");
		expect(markup).not.toContain('class="strip-slot"');
		const forced = render({
			profiles: ready(quickProfile),
			wallpaper,
			view: "vivid",
			showEmptyGridDashedBorder: true,
		});
		expect(forced).toContain("<image");
	});

	it("uses MeetAI's theme and hides covered placeholders", () => {
		const markup = render({
			profiles: ready(meetAiProfile),
			wallpaper,
			showEmptyGridDashedBorder: true,
		});
		expect(markup).toContain('data-theme="meetingAssistantTheme"');
		expect(count(markup, 'data-state="tile"')).toBe(6);
		expect(count(markup, 'data-state="empty"')).toBe(0);
		expect(markup).toContain("left:2px;top:2px;width:1196px;height:476px");
		expect(markup).not.toContain('data-layers="commonBase"');
	});

	it("grows spans inward and lays forced spans out", () => {
		const markup = render({
			profiles: ready(spansProfile),
			wallpaper,
			showEmptyGridDashedBorder: false,
		});
		// 2×2 at 2,1 → rows 1–2; quakeBot at 2,8 → columns 5–8.
		expect(markup).toContain(
			'data-key-code="2,1" data-state="tile" data-press-scale="true" style="left:10px;top:10px;width:460px;height:460px',
		);
		expect(markup).toContain("left:970px;top:10px;width:940px;height:460px");
		expect(markup).toContain('data-dashed="false"');
	});

	it("renders the registered clock over the full canvas with the host time", () => {
		const markup = render({
			profiles: ready(clockProfile),
			wallpaper,
			showEmptyGridDashedBorder: true,
		});
		const host = new Date(wallpaper.clock.epochMillis);
		const hhmm = [host.getHours(), host.getMinutes()]
			.map((n) => String(n).padStart(2, "0"))
			.join(":");
		expect(markup).toContain('class="oq-clock" data-theme="season"');
		expect(markup).toContain("width:1920px;height:480px");
		expect(markup).toContain(`data-time="${hhmm}"`);
		expect(count(markup, 'data-state="tile"')).toBe(1);
	});

	it("marks a pressed tile for DK's 0.3 s press", () => {
		const markup = render({
			profiles: ready(),
			wallpaper,
			showEmptyGridDashedBorder: true,
			pressedKeyCode: "1,3",
		});
		expect(markup).toContain(
			'data-key-code="1,3" data-state="tile" data-pressed="true" data-press-scale="true"',
		);
	});

	it("reports a profile failure by code only", () => {
		const markup = render({
			profiles: {
				_tag: "failure",
				code: "QUAKE.PROFILE.READ_FAILED",
				message: "Reading local profiles failed",
			},
			wallpaper,
			showEmptyGridDashedBorder: true,
		});
		expect(markup).toContain("QUAKE.PROFILE.READ_FAILED");
		expect(markup).toContain("Profiles unavailable");
	});
});

describe("generic tile", () => {
	it("centres the artwork above a readable bottom label", () => {
		expect(
			genericTileMetrics(
				{ width: 220, height: 220 },
				{ pos: "top", style: "bold|italic|underline" },
			),
		).toMatchObject({
			iconSize: 92,
			padding: 20,
			fontSize: 24,
			titleAnchor: "bottom",
			fontWeight: 550,
			italic: false,
			titleWidth: 180,
		});
		const wide = genericTileMetrics(
			{ width: 460, height: 460 },
			{ pos: "bot", style: "" },
		);
		expect(wide).toMatchObject({ iconSize: 168, fontSize: 34 });
		expect(wide.iconCenter).toBeLessThan(0.5);
		expect(
			genericTileMetrics(
				{ width: 236, height: 236 },
				{ pos: "top", style: "bold|italic", userModifiedStyle: true },
			),
		).toMatchObject({
			fontSize: 26,
			titleAnchor: "top",
			fontWeight: 700,
			italic: true,
		});
		// Labels never drop below the strip's 22 px reading floor.
		expect(
			genericTileMetrics({ width: 120, height: 120 }, { pos: "bot", style: "" })
				.fontSize,
		).toBe(22);
	});

	it("draws a flat plate with artwork and a bottom label", () => {
		const envelope = decode(stripFixtureEnvelope());
		const { profile, page } = selectStripPage(envelope, undefined);
		const key = page.keys.find((entry) => entry.keyCode === "2,1");
		expect(key).toBeDefined();
		if (!key) return;
		const markup = renderToStaticMarkup(
			createElement(GenericTile, {
				tile: {
					keyCode: "2,1",
					key,
					type: key.config.type,
					footprint: { row: 2, column: 1, width: 1, height: 1 },
					slot: { x: 10, y: 250, width: 220, height: 220 },
					slotRadius: 48,
					box: { x: 10, y: 250, width: 220, height: 220 },
					tileRadius: 48,
					cellTheme: "commonBaseTheme",
					fullBleed: false,
					zIndex: 0,
					supportTouchEffect: true,
					hasTouchableSubElements: false,
					pressFeedback: true,
					pressScale: true,
				},
				context: {
					now: undefined,
					hourFormat: "24h",
					voice: previewVoiceContext,
				},
			}),
		);
		expect(profile.name).toBe("Quick");
		expect(markup).not.toContain("strip-tile-ring");
		expect(markup).not.toContain("<filter");
		expect(markup).not.toContain("--strip-accent-rgb");
		expect(markup).toContain("width:92px;height:92px");
		expect(markup).toContain("font-size:24px;font-weight:550");
		expect(markup).toContain("bottom:20px");
		expect(markup).toContain(">Lock Screen</p>");
		expect(markup).toContain('<img src="data:image/svg+xml,');
	});

	it.each(["", "resource:missing/999999", "data:image/png;base64,AA=="])(
		"preserves generic artwork intent for %s",
		(icon) => {
			const envelope = decode(stripFixtureEnvelope());
			const { profile, page } = selectStripPage(envelope, undefined);
			const key = page.keys.find((entry) => entry.keyCode === "2,1");
			expect(key).toBeDefined();
			if (!key) return;
			const markup = renderToStaticMarkup(
				createElement(GenericTile, {
					tile: {
						keyCode: "2,1",
						key: { ...key, config: { ...key.config, icon } },
						type: key.config.type,
						footprint: { row: 2, column: 1, width: 1, height: 1 },
						slot: { x: 10, y: 250, width: 220, height: 220 },
						slotRadius: 48,
						box: { x: 10, y: 250, width: 220, height: 220 },
						tileRadius: 48,
						cellTheme: "commonBaseTheme",
						fullBleed: false,
						zIndex: 0,
						supportTouchEffect: true,
						hasTouchableSubElements: false,
						pressFeedback: true,
						pressScale: true,
					},
					context: {
						now: undefined,
						hourFormat: "24h",
						voice: previewVoiceContext,
					},
				}),
			);
			expect(profile.name).toBe("Quick");
			if (!icon) expect(markup).not.toContain("<img");
			else if (icon.startsWith("resource:"))
				expect(markup).not.toContain("<img");
			else expect(markup).toContain('src="data:image/png;base64,AA=="');
		},
	);

	it("loads only inline image data", () => {
		expect(isInlineIcon("data:image/png;base64,AA==")).toBe(true);
		expect(isInlineIcon("data:image/svg+xml,%3Csvg")).toBe(true);
		expect(isInlineIcon("0-61")).toBe(false);
		expect(isInlineIcon("https://example.com/a.png")).toBe(false);
		expect(isInlineIcon("data:text/html,<script>")).toBe(false);
	});

	it("cuts titles with an ellipsis by binary search", () => {
		const width = (value: string): number => value.length * 10;
		expect(truncateTitle("Lock", 100, width)).toBe("Lock");
		expect(truncateTitle("Mission Control", 100, width)).toBe("Mission C…");
		expect(truncateTitle("Anything", 5, width)).toBe("…");
		expect(truncateTitle("", 100, width)).toBe("");
	});
});

describe("tile registry", () => {
	it("routes the clock to the strip-clock slot and everything else to the generic tile", () => {
		expect(stripTileRegistry.has("dkDesktopClock")).toBe(true);
		expect(stripTileFor("hotkey")).toBe(GenericTile);
		expect(stripTileFor("__proto__")).toBe(GenericTile);
		expect(stripTileFor("dkDesktopClock")).not.toBe(GenericTile);
	});

	it("draws the clock with the profile key's hour format", () => {
		const at = (value: "24h" | "12h") =>
			render({
				profiles: ready({
					...clockProfile,
					id: `clock-format-${value}`,
					pages: [
						{
							...clockProfile.pages[0],
							keys: clockProfile.pages[0].keys.map((key) => ({
								...key,
								config: {
									...key.config,
									actions: [{ type: "hourFormat", value }],
								},
							})),
						},
					],
				}),
				wallpaper: {
					...wallpaper,
					saved: {
						...wallpaper.saved,
						clock: {
							...wallpaper.saved.clock,
							actions: [
								{ type: "hourFormat", value: value === "12h" ? "24h" : "12h" },
							],
						},
					},
				},
				showEmptyGridDashedBorder: true,
			});
		expect(at("24h")).not.toContain("oq-clock-meridiem");
		expect(at("12h")).toMatch(
			/<span class="oq-clock-meridiem">(AM|PM)<\/span>/,
		);
	});
});

describe("strip selection and settings", () => {
	it("follows the device selection and falls back to the first page", () => {
		const envelope = decode(stripFixtureEnvelope(meetAiProfile, "SN-1"));
		expect(selectStripPage(envelope, "SN-1").profile.name).toBe("MeetAI");
		expect(selectStripPage(envelope, "desktop-preview").profile.id).toBe(
			envelope.profiles[0].id,
		);
		expect(selectStripPage(envelope, "__proto__").page.id).toBe(
			envelope.profiles[0].pages[0].id,
		);
	});

	it("follows saved selection, uses colorful for new serials and preserves preview fallback", () => {
		const envelope = decode(stripFixtureEnvelope(meetAiProfile, "SN-1"));
		expect(selectStripPage(envelope, "SN-1").profile.name).toBe("MeetAI");
		expect(selectStripPage(envelope, "other").profile.id).toBe(vividProfile.id);
		expect(selectStripPage(envelope, "desktop-preview").profile.id).toBe(
			envelope.profiles[0].id,
		);
		expect(selectStripPage(envelope, "__proto__").page.id).toBe(
			envelope.profiles[0].pages[0].id,
		);
	});

	it("validates the dashed-border setting and defaults it on", () => {
		expect(defaultStripSettings.showEmptyGridDashedBorder).toBe(true);
		expect(
			parseStripSettings('{"version":1,"showEmptyGridDashedBorder":false}'),
		).toEqual({ version: 1, showEmptyGridDashedBorder: false });
		for (const raw of [
			null,
			"not json",
			'{"version":2,"showEmptyGridDashedBorder":false}',
			'{"version":1,"showEmptyGridDashedBorder":"no"}',
			'{"version":1,"showEmptyGridDashedBorder":false,"extra":1}',
			"[]",
		])
			expect(parseStripSettings(raw)).toEqual(defaultStripSettings);
		expect(validateStripSettings(null)).toBeNull();
	});

	it("decodes profile replies and drops malformed ones", async () => {
		const update = vi.fn();
		let push: (value: unknown) => void = () => undefined;
		const off = vi.fn();
		const unsubscribe = subscribeStripProfiles(
			{
				read: async () => ({ _tag: "ready", envelope: stripFixtureEnvelope() }),
				onSnapshot: (callback) => {
					push = callback;
					return off;
				},
			},
			update,
		);
		await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
		expect(update.mock.calls[0]?.[0]).toMatchObject({ _tag: "ready" });
		push({ _tag: "ready", envelope: { schemaVersion: 2 } });
		push({ _tag: "failure", code: "SOMETHING.ELSE", message: "x" });
		expect(update).toHaveBeenCalledOnce();
		push({
			_tag: "failure",
			code: "QUAKE.PROFILE.READ_FAILED",
			message: "Reading local profiles failed",
		});
		expect(update).toHaveBeenLastCalledWith({
			_tag: "failure",
			code: "QUAKE.PROFILE.READ_FAILED",
			message: "Reading local profiles failed",
		});
		unsubscribe();
		expect(off).toHaveBeenCalledOnce();
	});

	it("exposes the four DK themes verbatim", () => {
		expect(
			Object.values(STRIP_THEMES).map((theme) => [
				theme.cellSize,
				theme.cellGap,
				theme.edgeGap,
				theme.borderRadius,
			]),
		).toEqual([
			[220, 20, 10, 48],
			[236, 4, 2, 24],
			[221, 20, 10, 48],
			[220, 20, 10, 0],
		]);
		expect(Option.isNone(decode(stripFixtureEnvelope()).profiles[0].knob)).toBe(
			true,
		);
	});
});
