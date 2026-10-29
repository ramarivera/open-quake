import { Array as EffectArray, Option, Schema } from "effect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
	builtinProfiles,
	translateProfile,
} from "../../../../../../packages/device/src/profiles/profile-catalog";
import {
	createInitialProfileEnvelope,
	Profile,
} from "../../../../../../packages/device/src/profiles/profile-contracts";
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
import { hasSemanticKeyArtwork, keyArtwork } from "../keys/key-artwork";
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
		// Build each real localized catalog once and reuse it for both presets.
		const locales = ["en", "zh", "de", "fr", "it", "es", "ja", "ko"] as const;
		const catalogs = locales.map((locale) => ({
			locale,
			profiles: builtinProfiles("darwin", locale),
		}));
		const english = catalogs.find((catalog) => catalog.locale === "en");
		if (!english) throw new Error("Missing English catalog fixture");
		for (const [id, theme] of [
			["1-1", "meetingAssistantTheme"],
			["1-3", "systemInfoTheme"],
		] as const) {
			const source = english.profiles.find((profile) => profile.id === id);
			if (!source) throw new Error("Missing catalog fixture");
			const geometry = (profile: typeof source) =>
				stripLayout(profile, profile.pages[0]).tiles.map((tile) => ({
					box: tile.box,
					slot: tile.slot,
					cellTheme: tile.cellTheme,
				}));
			const baseline = geometry(source);
			for (const { locale, profiles } of catalogs) {
				const localized = profiles.find((profile) => profile.id === id);
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

	it("resolves every built-in tile icon without the generic question-mark fallback", () => {
		const fallbackArtwork = keyArtwork("unmapped-icon", "unmapped-type");
		for (const platform of ["darwin", "linux", "win32"] as const)
			for (const profile of builtinProfiles(platform, "en"))
				for (const page of profile.pages)
					for (const key of page.keys) {
						if (!key.config.icon || !key.config.type) continue;
						const label = `${profile.name} ${key.keyCode} (${key.config.type}, ${key.config.icon})`;
						expect(
							hasSemanticKeyArtwork(key.config.icon, key.config.type),
							label,
						).toBe(true);
						expect(
							keyArtwork(key.config.icon, key.config.type),
							label,
						).not.toBe(fallbackArtwork);
						// The mic and buzzer toggles swap to alterIcon, which must look different.
						const alter = Option.getOrUndefined(key.config.alterIcon);
						if (alter && ["0-58", "0-59"].includes(key.config.icon)) {
							expect(hasSemanticKeyArtwork(alter, key.config.type), label).toBe(
								true,
							);
							expect(keyArtwork(alter, key.config.type), label).not.toBe(
								keyArtwork(key.config.icon, key.config.type),
							);
						}
					}
	});

	it("keeps long built-in profile labels intact for wrapping", () => {
		const shortcut = builtinProfiles("darwin", "en").find(
			(profile) => profile.id === "1-2",
		);
		const chat = builtinProfiles("darwin", "en").find(
			(profile) => profile.id === "1-5",
		);
		if (!shortcut || !chat)
			throw new Error("Missing built-in profile fixtures");
		const markupForTitle = (
			profile: typeof shortcut,
			title: string,
		): string => {
			const tile = stripLayout(profile, profile.pages[0]).tiles.find(
				(entry) => entry.key.config.title.text === title,
			);
			if (!tile) throw new Error(`Missing built-in title ${title}`);
			return renderToStaticMarkup(
				createElement(GenericTile, {
					tile,
					context: {
						now: undefined,
						hourFormat: "24h",
						voice: previewVoiceContext,
					},
				}),
			);
		};
		expect(markupForTitle(shortcut, "Mission Control")).toContain(
			'data-full-title="Mission Control"',
		);
		expect(markupForTitle(shortcut, "Lock screen")).toContain(
			'data-full-title="Lock screen"',
		);
		expect(markupForTitle(chat, "Content Writer")).toContain(
			'data-full-title="Content Writer"',
		);
		expect(markupForTitle(chat, "Compliance")).toContain(
			'data-full-title="Compliance"',
		);
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
			'data-key-code="2,1" data-state="tile" data-press-scale="true" style="left:12px;top:12px;width:456px;height:456px',
		);
		expect(markup).toContain("left:972px;top:12px;width:936px;height:456px");
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
	it("centres the artwork above a wrapping bottom label", () => {
		expect(
			genericTileMetrics(
				{ width: 216, height: 216 },
				{ pos: "top", style: "bold|italic|underline" },
			),
		).toMatchObject({
			iconSize: 91,
			padding: 19,
			fontSize: 24,
			titleAnchor: "bottom",
			fontWeight: 550,
			italic: false,
			titleWidth: 178,
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

	it.each(["top", "bot"] as const)(
		"keeps size-12 two-line titles clear of the icon at %s",
		(pos) => {
			const metrics = genericTileMetrics(
				{ width: 216, height: 216 },
				{ pos, style: "", size: 12, userModifiedStyle: true },
			);
			expect(metrics.fontSize).toBe(36);
			const titleHeight = metrics.fontSize * 1.2 * 2;
			const iconTop = metrics.iconCenter * 216 - metrics.iconSize / 2;
			const iconBottom = iconTop + metrics.iconSize;
			if (pos === "top")
				expect(iconTop).toBeGreaterThanOrEqual(
					metrics.padding + titleHeight + 8,
				);
			else
				expect(iconBottom).toBeLessThanOrEqual(
					216 - metrics.padding - titleHeight - 8,
				);
			expect(iconTop).toBeGreaterThanOrEqual(0);
			expect(iconBottom).toBeLessThanOrEqual(216);
		},
	);

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
		expect(markup).toContain("width:64px;height:64px");
		expect(markup).toContain("font-size:24px;font-weight:550");
		expect(markup).toContain("bottom:22px");
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
			[216, 24, 12, 48],
			[236, 4, 2, 24],
			[221, 20, 10, 48],
			[220, 20, 10, 0],
		]);
		expect(Option.isNone(decode(stripFixtureEnvelope()).profiles[0].knob)).toBe(
			true,
		);
	});
});

it("renders persisted Chinese and Japanese Agent defaults in the English strip and management preview", () => {
	for (const sourceLocale of ["zh", "ja"] as const) {
		const source = builtinProfiles("darwin", sourceLocale).find(
			(p) => p.id === "1-8",
		);
		if (!source) throw new Error("Missing Agent fixture");
		const legacy = {
			...source,
			pages: EffectArray.map(source.pages, (page) => ({
				...page,
				keys: page.keys.map((key) => ({
					...key,
					compatibility: Option.none(),
				})),
			})),
		};
		for (const titles of ["key-locale", "provided"] as const) {
			const profile =
				titles === "provided" ? translateProfile(legacy, "en") : legacy;
			const markup = render({
				profiles: ready(Schema.encodeSync(Profile)(profile)),
				showEmptyGridDashedBorder: false,
				titles,
			});
			for (const title of [
				"Material Finder",
				"Stock Master",
				"Data Organizer",
				"Tech Expert",
			])
				expect(markup).toContain(title);
			expect(markup).not.toMatch(
				/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u,
			);
		}
	}
});

it("names brightness, explains knob operation and doesn't display stale disconnected values", () => {
	const profile = builtinProfiles("darwin").find((p) => p.id === "1-2");
	if (!profile) throw Error("Quick missing");
	const tile = stripLayout(profile, profile.pages[0]).tiles.find(
		(t) => t.type === "luminance",
	);
	if (!tile) throw Error("Brightness missing");
	const context = {
		now: undefined,
		hourFormat: "24h" as const,
		voice: previewVoiceContext,
	};
	const hardware = {
		serial: "fixture",
		available: true,
		preferenceStatus: "saved" as const,
		session: "fixture",
		preferences: {
			knobLedAlwaysOn: true,
			buzzerEnabled: true,
			alertVolume: 84,
		},
		inputMode: "device" as const,
		luminance: 128,
	};
	const live = renderToStaticMarkup(
		createElement(GenericTile, { tile, context: { ...context, hardware } }),
	);
	expect(live).toContain("Screen brightness");
	expect(live).toContain("50%");
	expect(live).toContain("Tap, then turn knob");
	const disconnected = renderToStaticMarkup(
		createElement(GenericTile, {
			tile,
			context: { ...context, hardware: { ...hardware, available: false } },
		}),
	);
	expect(disconnected).not.toContain("50%");
	const customTile = {
		...tile,
		key: {
			...tile.key,
			config: {
				...tile.key.config,
				title: {
					...tile.key.config.title,
					text: "My light",
					userModifiedStyle: true,
					pos: "mid" as const,
				},
			},
		},
	};
	const custom = renderToStaticMarkup(
		createElement(GenericTile, {
			tile: customTile,
			context: { ...context, hardware },
		}),
	);
	expect(custom).toContain('data-full-title="My light"');
	expect(custom).not.toContain("quick-brightness-state");
});

it("gives host brightness the same tap-and-turn instruction without a fabricated percentage", () => {
	const p = builtinProfiles("darwin").find((p) => p.id === "1-2");
	if (!p) throw Error("Quick missing");
	const tile = stripLayout(p, p.pages[0]).tiles.find(
		(t) => t.type === "brightness",
	);
	if (!tile) throw Error("Host brightness missing");
	const html = renderToStaticMarkup(
		createElement(GenericTile, {
			tile,
			context: {
				now: undefined,
				hourFormat: "24h",
				voice: previewVoiceContext,
			},
		}),
	);
	expect(html).toContain("Host brightness");
	expect(html).toContain("Tap, then turn knob");
	expect(html).toContain('data-unavailable="true"');
	expect(html).toContain("Unavailable");
});

it("shows only confirmed host brightness percentages in the value area", () => {
	const profile = builtinProfiles("darwin").find((p) => p.id === "1-2");
	if (!profile) throw Error("Quick missing");
	const tile = stripLayout(profile, profile.pages[0]).tiles.find(
		(t) => t.type === "brightness",
	);
	if (!tile) throw Error("Host brightness missing");
	for (const [progress, expected] of [
		[42, "42%"],
		[-1, "Unavailable"],
		[NaN, "Unavailable"],
	] as const) {
		const html = renderToStaticMarkup(
			createElement(GenericTile, {
				tile,
				context: {
					interactive: false,
					now: undefined,
					hourFormat: "24h",
					voice: previewVoiceContext,
					runtimeState: {
						deviceId: "A",
						profileId: profile.id,
						pageId: profile.pages[0].id,
						keyCode: tile.keyCode,
						progress,
					},
				},
			}),
		);
		expect(html).toContain(expected);
	}
});

it("hides retained host brightness on a physical panel until hardware is explicitly available", () => {
	const profile = builtinProfiles("darwin").find((p) => p.id === "1-2");
	if (!profile) throw Error("Quick missing");
	const tile = stripLayout(profile, profile.pages[0]).tiles.find(
		(t) => t.type === "brightness",
	);
	if (!tile) throw Error("Host brightness missing");
	const html = renderToStaticMarkup(
		createElement(GenericTile, {
			tile,
			context: {
				now: undefined,
				hourFormat: "24h",
				voice: previewVoiceContext,
				interactive: true,
				runtimeState: {
					deviceId: "A",
					profileId: profile.id,
					pageId: profile.pages[0].id,
					keyCode: tile.keyCode,
					progress: 42,
				},
			},
		}),
	);
	expect(html).not.toContain("42%");
	expect(html).toContain("Unavailable");
});
