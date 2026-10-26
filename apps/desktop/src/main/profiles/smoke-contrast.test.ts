import { expect, it } from "vitest";
import { assertPropertyContrast } from "./smoke-contrast";

it("rejects unequal colors with nearly identical luminance", () => {
	expect(() =>
		assertPropertyContrast("rgb(120, 120, 120)", "rgb(121, 121, 121)"),
	).toThrow();
});

it("enforces the WCAG AA 4.5:1 boundary for normal property text", () => {
	expect(() =>
		assertPropertyContrast("rgb(118, 118, 118)", "rgb(255, 255, 255)"),
	).not.toThrow();
	expect(() =>
		assertPropertyContrast("rgb(119, 119, 119)", "rgb(255, 255, 255)"),
	).toThrow();
	expect(() =>
		assertPropertyContrast("rgb(255, 255, 255)", "rgb(119, 119, 119)"),
	).toThrow();
});

it("computes the 21:1 black/white maximum in either direction", () => {
	expect(assertPropertyContrast("rgb(0, 0, 0)", "rgb(255, 255, 255)")).toBe(21);
	expect(assertPropertyContrast("rgb(255, 255, 255)", "rgba(0, 0, 0, 1)")).toBe(
		21,
	);
});

it("rejects identical luminance even when the color syntax differs", () => {
	expect(() =>
		assertPropertyContrast("rgb(0, 0, 0)", "rgba(0, 0, 0, 1)"),
	).toThrow(/1.000:1/);
});

it("uses the WCAG sRGB weights for colored text", () => {
	expect(
		assertPropertyContrast("rgb(255, 255, 255)", "rgb(0, 0, 255)"),
	).toBeCloseTo(8.592, 3);
	expect(() =>
		assertPropertyContrast("rgb(255, 255, 255)", "rgb(0, 255, 0)"),
	).toThrow();
});

it("rejects uncomposited transparency and unsupported computed colors", () => {
	for (const color of ["rgba(0, 0, 0, 0.1)", "rgb(300, 0, 0)", "transparent"])
		expect(() => assertPropertyContrast(color, "rgb(255, 255, 255)")).toThrow();
});

it("supports computed color-mix sRGB colors without changing their contrast", () => {
	expect(
		assertPropertyContrast("color(srgb 1 1 1)", "color(srgb 0 0 0 / 1)"),
	).toBe(21);
	expect(
		assertPropertyContrast("rgb(255, 255, 255)", "color(srgb 0 0 1)"),
	).toBeCloseTo(8.592, 3);
	expect(() =>
		assertPropertyContrast(
			"color(srgb 0.47 0.47 0.47)",
			"color(srgb 0.48 0.48 0.48)",
		),
	).toThrow();
	expect(() =>
		assertPropertyContrast("color(srgb 0 0 0 / 0.1)", "rgb(255, 255, 255)"),
	).toThrow();
});
