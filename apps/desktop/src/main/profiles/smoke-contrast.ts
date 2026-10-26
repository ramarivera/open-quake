import assert from "node:assert/strict";

function luminance(color: string): number {
	// CSS color-mix() can preserve color(srgb ...) in Chromium computed styles.
	// Reject alpha rather than claiming contrast against an unknown backing color.
	const normalized =
		/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)\s*)?\)$/.exec(
			color,
		);
	const match =
		normalized ??
		/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(
			color,
		);
	const maximum = normalized ? 1 : 255;
	assert(match, `Expected computed sRGB color, received ${color}`);
	assert(
		match[4] === undefined || Number(match[4]) === 1,
		"Contrast requires opaque field colors",
	);
	const linear = (channel: number): number => {
		assert(
			Number.isFinite(channel) && channel >= 0 && channel <= maximum,
			"Invalid sRGB channel",
		);
		const value = channel / maximum;
		return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	};
	return (
		0.2126 * linear(Number(match[1])) +
		0.7152 * linear(Number(match[2])) +
		0.0722 * linear(Number(match[3]))
	);
}

export function assertPropertyContrast(
	foreground: string,
	background: string,
): number {
	const text = luminance(foreground),
		field = luminance(background);
	const ratio = (Math.max(text, field) + 0.05) / (Math.min(text, field) + 0.05);
	assert(
		ratio >= 4.5,
		`Property text needs WCAG AA contrast >= 4.5:1, received ${ratio.toFixed(3)}:1`,
	);
	return ratio;
}
