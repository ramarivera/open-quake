import type { ProfileTitle } from "../../../shared/profiles";
import {
	DEFAULT_ACCENT,
	type Rgb,
	STRIP_THEMES,
	type StripLayers,
	type StripThemeName,
} from "./geometry";

/**
 * DK-Suite UnitControl's generic icon-and-title tile, as the strip draws it
 * (UnitControl.vue currentIconSize, calcPosition, subBoxStyle).
 */
export interface GenericTileMetrics {
	readonly iconSize: number;
	/** Vertical icon shift in percent of the icon's own height. */
	readonly iconShift: number;
	readonly fontSize: number;
	readonly titleAnchor: "top" | "bottom";
	/** Distance from the anchored edge as a fraction of the tile height. */
	readonly titleOffset: number;
	readonly fontWeight: 400 | 900;
	readonly italic: boolean;
	/** Titles are cut to 94 % of the tile width. */
	readonly titleWidth: number;
	readonly layers: StripLayers;
	/** Background-layer inset in px. */
	readonly innerGap: number;
	/** Alpha at the ring's 75 % and 100 % stops. */
	readonly ringFade: readonly [number, number];
}

const CONTENT_SCALE = 0.7;
const ICON_FILL = 0.7;
const FONT_RATIO = 0.2;

export function genericTileMetrics(
	box: { readonly width: number; readonly height: number },
	span: { readonly width: number; readonly height: number },
	theme: StripThemeName,
	title: Pick<ProfileTitle, "pos" | "style">,
): GenericTileMetrics {
	const base = Math.min(box.width, box.height);
	const commonBase = theme === "commonBaseTheme";
	const sizeScale =
		(span.width === 2 && span.height === 2 ? 0.7 : 1) * (commonBase ? 0.9 : 1);
	const styles = title.style.split("|");
	const wide = span.width >= 2;
	return {
		iconSize: Math.floor(base * ICON_FILL * CONTENT_SCALE),
		iconShift: commonBase ? 16.67 : -10,
		fontSize: Math.floor(base * FONT_RATIO * CONTENT_SCALE * sizeScale),
		titleAnchor: commonBase || title.pos === "top" ? "top" : "bottom",
		titleOffset: commonBase ? 0.09 : 0.1,
		fontWeight: !commonBase && styles.includes("bold") ? 900 : 400,
		italic: !commonBase && styles.includes("italic"),
		titleWidth: box.width * 0.94,
		layers: STRIP_THEMES[theme].layers,
		innerGap: Math.round(
			(box.height / span.height) * STRIP_THEMES[theme].unitInnerGap,
		),
		ringFade: wide ? [0.18, 0.18] : [0.05, 0.02],
	};
}

/**
 * DK's measureAndTruncateText: the longest prefix that fits with `...`
 * appended, found by binary search over code units.
 */
export function truncateTitle(
	text: string,
	maxWidth: number,
	measure: (value: string) => number,
): string {
	if (!text || maxWidth <= 0 || measure(text) <= maxWidth) return text;
	const available = maxWidth - measure("...");
	if (available <= 0) return "...";
	let low = 0;
	let high = text.length;
	let fit = "";
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const candidate = text.slice(0, middle);
		if (measure(candidate) <= available) {
			fit = candidate;
			low = middle + 1;
		} else high = middle - 1;
	}
	return `${fit}...`;
}

/**
 * DK's setAccentFromImage over a 12×12 RGBA sample: average the opaque,
 * mid-brightness, saturated pixels and lift them by 1.2.
 */
export function accentFromPixels(data: ArrayLike<number>): Rgb | undefined {
	let r = 0;
	let g = 0;
	let b = 0;
	let count = 0;
	for (let index = 0; index + 3 < data.length; index += 4) {
		const red = data[index] ?? 0;
		const green = data[index + 1] ?? 0;
		const blue = data[index + 2] ?? 0;
		if ((data[index + 3] ?? 0) < 50) continue;
		const max = Math.max(red, green, blue);
		const min = Math.min(red, green, blue);
		const brightness = (red + green + blue) / 3;
		if (brightness < 30 || brightness > 225) continue;
		if ((max === 0 ? 0 : (max - min) / max) < 0.1) continue;
		r += red;
		g += green;
		b += blue;
		count++;
	}
	if (count === 0) return undefined;
	const lift = (sum: number): number =>
		Math.min(255, Math.round(Math.round(sum / count) * 1.2));
	return { r: lift(r), g: lift(g), b: lift(b) };
}

export const themeAccent = (theme: StripThemeName): Rgb =>
	STRIP_THEMES[theme].colorScheme ?? DEFAULT_ACCENT;

export const rgbText = ({ r, g, b }: Rgb, alpha = 1): string =>
	alpha === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;

/** Inline image data only; other artwork references wait for the artwork adapter. */
export const isInlineIcon = (icon: string): boolean =>
	/^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/.test(icon);
