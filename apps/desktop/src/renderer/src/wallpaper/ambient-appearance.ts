import { useEffect, useState } from "react";

export const ambientStyles = [
	"media",
	"contour",
	"horizon",
	"plotter",
	"lava",
	"ambilight",
] as const;
export type AmbientStyle = (typeof ambientStyles)[number];
export const ambientStyleLabels: Readonly<Record<AmbientStyle, string>> = {
	media: "Original media",
	contour: "Contour",
	horizon: "Horizon",
	plotter: "Plotter",
	lava: "Lava lamp",
	ambilight: "Ambilight",
};
export const isAmbientStyle = (value: unknown): value is AmbientStyle =>
	ambientStyles.some((style) => style === value);
const keyFor = (serial: string) =>
	`open-quake.ambient.${encodeURIComponent(serial)}`;
const changed = "open-quake:ambient";
export function readAmbientStyle(serial?: string): AmbientStyle {
	if (!serial || typeof window === "undefined") return "media";
	try {
		const value = window.localStorage.getItem(keyFor(serial));
		return isAmbientStyle(value) ? value : "media";
	} catch {
		return "media";
	}
}

/** Appearance only. Media remains owned by the existing wallpaper transaction. */
export function useAmbientStyle(serial?: string) {
	const [state, setState] = useState(() => ({
		serial,
		style: readAmbientStyle(serial),
		notice: "",
	}));
	useEffect(() => {
		const read = () =>
			setState({ serial, style: readAmbientStyle(serial), notice: "" });
		const storage = (event: StorageEvent) => {
			if (event.key === null || (serial && event.key === keyFor(serial)))
				read();
		};
		read();
		window.addEventListener("storage", storage);
		window.addEventListener(changed, read);
		return () => {
			window.removeEventListener("storage", storage);
			window.removeEventListener(changed, read);
		};
	}, [serial]);
	return {
		style: state.serial === serial ? state.style : readAmbientStyle(serial),
		notice: state.notice,
		select: (style: AmbientStyle) => {
			if (!serial) return;
			try {
				window.localStorage.setItem(keyFor(serial), style);
				window.dispatchEvent(new Event(changed));
			} catch {
				setState({
					serial,
					style: readAmbientStyle(serial),
					notice:
						"Ambient style couldn't be saved. Your current background is unchanged.",
				});
			}
		},
	};
}
