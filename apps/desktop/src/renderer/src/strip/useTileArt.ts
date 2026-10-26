import { useEffect, useMemo, useRef, useState } from "react";
import { monitoringClient } from "../../../../../../packages/client/src/monitor";
import { safeIconSvg } from "../../../main/key-library/icon-svg";
import type { MonitoringSnapshot } from "../../../shared/monitor-contracts";
import { keyArtwork } from "../keys/key-artwork";
import { truncateTitle } from "./tileMetrics";

/** Foreground paths only select artwork already extracted by the installed-app owner. */
export function useForegroundArtwork(enabled: boolean): string {
	const [artwork, setArtwork] = useState("");
	useEffect(() => {
		const bridge =
			typeof window === "undefined" ? undefined : window.quakeMonitor;
		if (!enabled || !bridge) return;
		let active = true,
			sequence = 0,
			received = false;
		const appPath = (path: string): string => {
			const bundle = /^(.*?\.app)(?:\/|$)/i.exec(path)?.[1] ?? path;
			return bundle.replaceAll("\\", "/").toLowerCase();
		};
		const update = (snapshot: MonitoringSnapshot): void => {
			const ticket = ++sequence;
			setArtwork("");
			const foreground = snapshot.foreground;
			if (foreground.state !== "available" || !foreground.window) return;
			const path = appPath(foreground.window.path);
			void window.quakeKeyLibrary
				?.request({ type: "application-icons" })
				.then((reply) => {
					if (!active || ticket !== sequence || reply._tag !== "success")
						return;
					const match = reply.packs
						?.flatMap((pack) => pack.icons)
						.find((icon) =>
							icon.extraData?.some((entry) => appPath(entry) === path),
						);
					setArtwork(validatedArtwork(match?.data ?? ""));
				})
				.catch(() => {});
		};
		const client = monitoringClient(bridge);
		const off = client.subscribe((snapshot) => {
			received = true;
			update(snapshot);
		});
		void client
			.snapshot()
			.then((snapshot) => {
				if (active && !received) update(snapshot);
			})
			.catch(() => {});
		return () => {
			active = false;
			off();
		};
	}, [enabled]);
	return enabled ? artwork : "";
}

/** Treat SVG as inert image data and validate it before handing it to Chromium. */
export function validatedArtwork(source: string): string {
	if (
		source.length > 8 * 1024 * 1024 ||
		!/^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/.test(source)
	)
		return "";
	if (source.startsWith("data:image/svg+xml")) {
		try {
			const comma = source.indexOf(",");
			const body = source.slice(comma + 1);
			safeIconSvg(
				source.slice(0, comma).endsWith(";base64")
					? atob(body)
					: decodeURIComponent(body),
			);
		} catch {
			return "";
		}
	}
	return source;
}

/** Each mounted image owns its observer and releases decoded offscreen pixels. */
export function useArtworkVisibility<T extends Element>(initial = false) {
	const ref = useRef<T>(null);
	const [visible, setVisible] = useState(initial);
	useEffect(() => {
		const node = ref.current;
		if (!node) return;
		if (typeof IntersectionObserver === "undefined") {
			setVisible(true);
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				const entry = entries[0];
				setVisible(!!entry?.isIntersecting && entry.intersectionRatio >= 0.5);
			},
			{ threshold: 0.5 },
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);
	return { ref, visible };
}

/** Resolve through owners, never arbitrary renderer fs/fetch or executable markup. */
export async function resolveTileArtwork(
	source: string,
	type: string,
): Promise<string> {
	if (source.startsWith("data:")) return validatedArtwork(source);
	const resource = /^(?:resource:|application:)?([a-f0-9]{64})$/.exec(
		source,
	)?.[1];
	if (resource) {
		const reply = await window.quakeKeyLibrary?.request({ type: "icons" });
		const stored =
			reply?._tag === "success"
				? reply.packs
						?.flatMap((pack) => pack.icons)
						.find((icon) => icon.id === resource)
				: undefined;
		if (stored) return validatedArtwork(stored.data);
		const applications = await window.quakeKeyLibrary?.request({
			type: "application-icons",
		});
		return applications?._tag === "success"
			? validatedArtwork(
					applications.packs
						?.flatMap((pack) => pack.icons)
						.find((icon) => icon.id === resource)?.data ?? "",
				)
			: "";
	}
	// Only bundled names are aliases. Legacy absolute paths and URLs stay rejected.
	const mdiName = /^@mdi\/(?:svg\/)?([a-z0-9-]+)(?:\.svg)?$/.exec(source)?.[1];
	const appName = /^@\/icon\/([a-z0-9-]+)\.svg$/.exec(source)?.[1];
	if (mdiName || appName) {
		const catalog = await import("virtual:mdi-icons");
		const icon = catalog.default.find(
			(entry) => entry.name === (mdiName ?? appName),
		);
		return icon
			? validatedArtwork(
					`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="white" d="${icon.path}"/></svg>`)}`,
				)
			: "";
	}
	return !source || /^[\d-]+$/.test(source) ? keyArtwork(source, type) : "";
}

export function useTileArtwork(source: string, type: string) {
	const { ref, visible } = useArtworkVisibility<HTMLDivElement>(true);
	const [loaded, setLoaded] = useState(() => ({
		source,
		type,
		data: source.startsWith("data:")
			? validatedArtwork(source)
			: /^[\d-]+$/.test(source)
				? keyArtwork(source, type)
				: "",
	}));
	useEffect(() => {
		let live = true;
		setLoaded({ source, type, data: "" });
		if (visible)
			void resolveTileArtwork(source, type)
				.then((data) => {
					if (live) setLoaded({ source, type, data });
				})
				.catch(() => {});
		return () => {
			live = false;
		};
	}, [source, type, visible]);
	return {
		ref,
		src:
			visible && loaded.source === source && loaded.type === type
				? loaded.data
				: "",
	};
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
