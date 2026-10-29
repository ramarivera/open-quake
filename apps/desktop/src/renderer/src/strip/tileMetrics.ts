import type { ProfileTitle } from "../../../shared/profiles";

/**
 * The flat icon-and-label key tile (independent-device-design, "Flat key
 * tiles and state feedback"): artwork centred above a bottom label.
 */
export interface GenericTileMetrics {
	readonly iconSize: number;
	/** Inner padding in px; the label sits this far from its anchored edge. */
	readonly padding: number;
	readonly fontSize: number;
	readonly titleAnchor: "top" | "mid" | "bottom";
	readonly fontWeight: 550 | 700;
	readonly italic: boolean;
	readonly titleWidth: number;
	/** Icon centre as a fraction of the tile height. */
	readonly iconCenter: number;
}

export function genericTileMetrics(
	box: { readonly width: number; readonly height: number },
	title: Pick<ProfileTitle, "pos" | "style"> & {
		readonly userModifiedStyle?: boolean | undefined;
		readonly size?: number | undefined;
	},
): GenericTileMetrics {
	const base = Math.min(box.width, box.height);
	const padding = Math.round(base * 0.09);
	const baseFontSize = Math.min(34, Math.max(22, Math.round(base * 0.11)));
	const fontSize = title.userModifiedStyle
		? Math.round(baseFontSize * ((title.size ?? 8) / 8))
		: baseFontSize;
	const styles = title.style.split("|");
	const explicit = title.userModifiedStyle === true;
	const titleAnchor = !explicit
		? "bottom"
		: title.pos === "top"
			? "top"
			: title.pos === "mid"
				? "mid"
				: "bottom";
	// The icon centres in the space the label leaves free. Middle headings
	// reserve a separate area above their centered two-line text block.
	// The title can wrap to two lines at the rendered size. Keep a gap
	// between that block and the artwork, including explicit large titles.
	const titleHeight = fontSize * 1.2 * 2;
	const label = (titleHeight + padding + 8) / box.height;
	const freeHeight = Math.max(
		0,
		titleAnchor === "mid"
			? (box.height - titleHeight) / 2 - padding - 8
			: box.height * (1 - label),
	);
	const iconSize = Math.min(base * 0.42, 168, freeHeight);
	return {
		iconSize:
			titleAnchor === "mid" ? Math.floor(iconSize) : Math.round(iconSize),
		padding,
		fontSize,
		titleAnchor,
		fontWeight: explicit && styles.includes("bold") ? 700 : 550,
		italic: explicit && styles.includes("italic"),
		titleWidth: box.width - 2 * padding,
		iconCenter:
			titleAnchor === "bottom"
				? (1 - label) / 2
				: titleAnchor === "top"
					? (1 + label) / 2
					: (padding + freeHeight / 2) / box.height,
	};
}

/**
 * The longest prefix that fits with an ellipsis appended, found by binary
 * search over code units.
 */
export function truncateTitle(
	text: string,
	maxWidth: number,
	measure: (value: string) => number,
): string {
	if (!text || maxWidth <= 0 || measure(text) <= maxWidth) return text;
	const available = maxWidth - measure("…");
	if (available <= 0) return "…";
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
	return `${fit.trimEnd()}…`;
}

/** Inline image data only; other artwork references wait for the artwork adapter. */
export const isInlineIcon = (icon: string): boolean =>
	/^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/.test(icon);
