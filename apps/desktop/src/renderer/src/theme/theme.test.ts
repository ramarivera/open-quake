import { describe, expect, it, vi } from "vitest";
import {
	defaultAppearance,
	type MotionPreference,
	parseAppearance,
	selectReducedMotion,
	validateAppearance,
} from "./appearance";
import {
	customThemeTokens,
	loadCustomThemeFile,
	MAX_THEME_BYTES,
	parseCustomTheme,
	validateCustomTheme,
} from "./customTheme";
import {
	builtinThemeOrder,
	themeLabels,
	themes,
	themeTokenNames,
	toThemeProperties,
} from "./tokens";

const custom = {
	version: 1,
	name: "  Violet  ",
	base: "light",
	colors: { accent: "#805Ad5", "accent-text": "#ffffff" },
};

describe("theme properties", () => {
	it.each(builtinThemeOrder)(
		"generates every semantic property for %s without extra CSS",
		(name) => {
			const palette = themes[name];
			const properties = toThemeProperties(palette);
			expect(Object.keys(properties)).toHaveLength(themeTokenNames.length);
			for (const token of themeTokenNames) {
				expect(properties[`--quake-${token}`]).toBe(palette[token]);
				expect(palette[token]).toMatch(/^#[0-9a-f]{6}$/i);
			}
		},
	);

	it("names the built-in themes independently of DK-Suite", () => {
		expect(builtinThemeOrder.map((id) => themeLabels[id])).toEqual([
			"Signal Deck",
			"Midnight",
			"Signal Light",
			"Catppuccin Mocha",
			"Catppuccin Latte",
			"GitHub Dark",
			"GitHub Light",
			"Superhuman",
			"Codex",
			"Linear",
			"Notion Light",
			"Notion Dark",
		]);
		// One accent hue across the dark themes; it is not DK's white or grey.
		expect(themes.grey.accent).not.toBe(themes.grey.selection);
		for (const name of ["dark", "grey"] as const) {
			expect(themes[name].accent).not.toMatch(/^#(ffffff|5a5a5a)$/i);
		}
	});

	it("replaces the complete palette when switching themes", () => {
		const dark = toThemeProperties(themes.dark);
		const light = toThemeProperties(themes.light);
		expect(Object.keys(light)).toEqual(Object.keys(dark));
		for (const token of themeTokenNames) {
			expect(light[`--quake-${token}`]).not.toBe(dark[`--quake-${token}`]);
		}
	});

	it.each(builtinThemeOrder)(
		"keeps %s text, status, and control labels at WCAG AA contrast",
		(name) => {
			const palette = themes[name];
			const luminance = (hex: string) => {
				const channels = [1, 3, 5].map((offset) => {
					const value =
						Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
					return value <= 0.04045
						? value / 12.92
						: ((value + 0.055) / 1.055) ** 2.4;
				});
				return (
					(channels[0] ?? 0) * 0.2126 +
					(channels[1] ?? 0) * 0.7152 +
					(channels[2] ?? 0) * 0.0722
				);
			};
			const contrast = (first: string, second: string) => {
				const a = luminance(first);
				const b = luminance(second);
				return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
			};
			for (const foreground of [
				"foreground",
				"muted",
				"accent",
				"success",
				"warning",
				"selection",
				"danger",
			] as const) {
				for (const background of ["background", "surface"] as const) {
					expect(
						contrast(palette[foreground], palette[background]),
					).toBeGreaterThanOrEqual(4.5);
				}
			}
			expect(
				contrast(palette["accent-text"], palette.accent),
			).toBeGreaterThanOrEqual(4.5);
			// Body text stays comfortably above AA; muted copy is still body copy.
			for (const background of ["background", "surface"] as const) {
				expect(
					contrast(palette.foreground, palette[background]),
				).toBeGreaterThanOrEqual(7);
			}
			// WCAG 1.4.11: control boundaries (the select border) need 3:1.
			for (const background of ["background", "surface"] as const) {
				expect(
					contrast(palette.border, palette[background]),
				).toBeGreaterThanOrEqual(3);
			}
		},
	);
});

describe("custom theme validation", () => {
	it("normalizes a valid partial theme and inherits the rest from its base", () => {
		const result = parseCustomTheme(JSON.stringify(custom));
		expect(result.status).toBe("valid");
		if (result.status !== "valid") return;
		expect(result.theme.name).toBe("Violet");
		expect(customThemeTokens(result.theme)).toEqual({
			...themes.light,
			...custom.colors,
		});
		expect(themes.light.accent).toBe("#426200");
	});

	it("accepts a complete palette without dropping tokens", () => {
		const result = validateCustomTheme({
			...custom,
			base: "dark",
			colors: themes.dark,
		});
		expect(result.status).toBe("valid");
		if (result.status !== "valid") return;
		expect(customThemeTokens(result.theme)).toEqual(themes.dark);
	});

	it.each([
		null,
		[],
		"theme",
		{},
		{ ...custom, version: 2 },
		{ ...custom, version: "1" },
		{ ...custom, name: "   " },
		{ ...custom, name: "x".repeat(61) },
		{ ...custom, name: 3 },
		{ ...custom, base: "system" },
		{ ...custom, colors: null },
		{ ...custom, colors: [] },
		{ ...custom, colors: {} },
		{ ...custom, colors: { background: undefined } },
		{ ...custom, colors: { accent: 10 } },
		{ ...custom, colors: { typo: "#123456" } },
		{ ...custom, css: "body { display: none }" },
	])("rejects invalid document %#", (value) => {
		expect(validateCustomTheme(value).status).toBe("invalid");
	});

	it.each([
		"red",
		"#fff",
		"#12345678",
		"#gggggg",
		"#123456;display:none",
		"url(https://example.com/asset)",
		"var(--external)",
		" #123456",
		"#123456\n",
	])("rejects CSS expressions and malformed colors: %s", (accent) => {
		expect(validateCustomTheme({ ...custom, colors: { accent } }).status).toBe(
			"invalid",
		);
	});

	it.each(["{", '{"colors":', "undefined", ""])(
		"rejects malformed JSON %#",
		(json) => {
			expect(parseCustomTheme(json).status).toBe("invalid");
		},
	);

	it("rejects prototype keys from JSON without changing object prototypes", () => {
		const result = parseCustomTheme(
			'{"version":1,"name":"x","base":"dark","colors":{"__proto__":"#123456"}}',
		);
		expect(result.status).toBe("invalid");
		expect(Object.hasOwn({}, "accent")).toBe(false);
	});

	it("enforces the UTF-8 byte limit while allowing the exact limit", () => {
		const json = JSON.stringify(custom);
		expect(parseCustomTheme(json.padEnd(MAX_THEME_BYTES, " ")).status).toBe(
			"valid",
		);
		expect(parseCustomTheme(json.padEnd(MAX_THEME_BYTES + 1, " ")).status).toBe(
			"invalid",
		);
		expect(parseCustomTheme("é".repeat(MAX_THEME_BYTES / 2 + 1))).toEqual({
			status: "invalid",
			reason: "Theme file must be 16 KiB or smaller.",
		});
	});

	it("rejects oversized files before reading their contents", async () => {
		const text = vi.fn(async () => JSON.stringify(custom));
		const result = await loadCustomThemeFile({
			size: MAX_THEME_BYTES + 1,
			text,
		});
		expect(result.status).toBe("invalid");
		expect(text).not.toHaveBeenCalled();
	});

	it("loads a valid file through the same validation path", async () => {
		expect(
			await loadCustomThemeFile({
				size: 100,
				text: async () => JSON.stringify(custom),
			}),
		).toEqual(parseCustomTheme(JSON.stringify(custom)));
	});

	it("returns safe feedback when reading fails", async () => {
		const text = vi
			.fn<() => Promise<string>>()
			.mockRejectedValue({ sensitive: "file path" });
		expect(await loadCustomThemeFile({ size: 100, text })).toEqual({
			status: "invalid",
			reason: "Could not read the theme file.",
		});
	});
});

describe("appearance persistence boundary", () => {
	it("round-trips defaults and a selected custom theme", () => {
		expect(parseAppearance(JSON.stringify(defaultAppearance))).toEqual(
			defaultAppearance,
		);
		const result = validateCustomTheme(custom);
		if (result.status !== "valid") throw new Error("Invalid test fixture");
		const appearance = {
			...defaultAppearance,
			theme: "custom",
			customTheme: result.theme,
			motion: "reduce",
		};
		expect(parseAppearance(JSON.stringify(appearance))).toEqual(appearance);
	});

	it.each([
		null,
		{},
		{ ...defaultAppearance, version: 3 },
		{ ...defaultAppearance, theme: "sepia" },
		{ ...defaultAppearance, theme: "custom" },
		{ ...defaultAppearance, motion: "full" },
		{ ...defaultAppearance, customTheme: { ...custom, version: 2 } },
		{ ...defaultAppearance, customTheme: undefined },
		{ ...defaultAppearance, unexpected: true },
	])("rejects invalid stored or broadcast data %#", (value) => {
		expect(validateAppearance(value)).toBeNull();
	});

	it("rejects corrupt and excessive persisted JSON", () => {
		expect(parseAppearance("{")).toBeNull();
		expect(parseAppearance(" ".repeat(20_481))).toBeNull();
	});
});

describe("reduced-motion selection", () => {
	it.each<[MotionPreference, boolean, boolean]>([
		["system", false, false],
		["system", true, true],
		["reduce", false, true],
		["reduce", true, true],
	])(
		"preference %s, OS reduce %s selects %s",
		(preference, system, expected) => {
			expect(selectReducedMotion(preference, system)).toBe(expected);
		},
	);
});

// Maintenance restoration acknowledges the validated serialized representation.
it("keeps default-derived v2 records byte-stable through validation", () => {
	for (const record of [
		defaultAppearance,
		{ ...defaultAppearance, theme: "light", motion: "reduce" },
		{ ...defaultAppearance, fontScale: "large", sidebarWidth: 280 },
	]) {
		const serialized = JSON.stringify(record);
		expect(JSON.stringify(parseAppearance(serialized))).toBe(serialized);
	}
});

it.each(builtinThemeOrder)(
	"persists %s without changing the appearance record format",
	(theme) => {
		const record = { ...defaultAppearance, theme };
		expect(parseAppearance(JSON.stringify(record))).toEqual(record);
	},
);
