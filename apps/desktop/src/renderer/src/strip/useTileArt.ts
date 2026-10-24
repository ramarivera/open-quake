import { useEffect, useMemo, useState } from "react";
import type { Rgb } from "./geometry";
import { accentFromPixels, isInlineIcon, truncateTitle } from "./tileMetrics";

/** DK's window.__iconColorCache: one sample per icon for the renderer's life. */
const accentCache = new Map<string, Rgb | null>();
const SAMPLE = 12;

function sampleIcon(icon: string): Promise<Rgb | null> {
	return new Promise((resolve) => {
		const image = new Image();
		image.onload = () => {
			try {
				const canvas = document.createElement("canvas");
				canvas.width = SAMPLE;
				canvas.height = SAMPLE;
				const context = canvas.getContext("2d", { willReadFrequently: true });
				if (!context) return resolve(null);
				context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
				resolve(
					accentFromPixels(context.getImageData(0, 0, SAMPLE, SAMPLE).data) ??
						null,
				);
			} catch {
				resolve(null);
			}
		};
		image.onerror = () => resolve(null);
		image.src = icon;
	});
}

/**
 * The icon's dominant saturated colour (common base only), else `fallback`.
 * Only inline image data is sampled; nothing is fetched.
 */
export function useIconAccent(
	icon: string,
	fallback: Rgb,
	enabled: boolean,
): Rgb {
	const sampled = enabled && isInlineIcon(icon);
	const [accent, setAccent] = useState<Rgb | null>(() =>
		sampled ? (accentCache.get(icon) ?? null) : null,
	);
	useEffect(() => {
		if (!sampled) {
			setAccent(null);
			return;
		}
		const cached = accentCache.get(icon);
		if (cached !== undefined) {
			setAccent(cached);
			return;
		}
		let live = true;
		void sampleIcon(icon).then((color) => {
			accentCache.set(icon, color);
			if (live) setAccent(color);
		});
		return () => {
			live = false;
		};
	}, [icon, sampled]);
	return accent ?? fallback;
}

let measureContext: CanvasRenderingContext2D | null | undefined;
const measurer = (): CanvasRenderingContext2D | null => {
	if (measureContext === undefined)
		measureContext =
			typeof document === "undefined"
				? null
				: document.createElement("canvas").getContext("2d");
	return measureContext;
};

/** DK's canvas-measured title cut; without a canvas the full text is kept. */
export function useTruncatedTitle(
	text: string,
	maxWidth: number,
	font: string,
): string {
	return useMemo(() => {
		const context = measurer();
		if (!context) return text;
		context.font = font;
		return truncateTitle(
			text,
			maxWidth,
			(value) => context.measureText(value).width,
		);
	}, [text, maxWidth, font]);
}
