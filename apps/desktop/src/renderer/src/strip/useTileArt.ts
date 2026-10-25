import { useMemo } from "react";
import { truncateTitle } from "./tileMetrics";

let measureContext: CanvasRenderingContext2D | null | undefined;
const measurer = (): CanvasRenderingContext2D | null => {
	if (measureContext === undefined)
		measureContext =
			typeof document === "undefined"
				? null
				: document.createElement("canvas").getContext("2d");
	return measureContext;
};

/** Canvas-measured title cut; without a canvas the full text is kept. */
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
