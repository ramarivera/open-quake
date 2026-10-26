import { Schema } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import { ClockSnapshot } from "../../../shared/display";
import {
	type WallpaperBridge,
	type WallpaperCommand,
	WallpaperReply,
	WallpaperSnapshot,
} from "../../../shared/wallpaper-contracts";

export function subscribeWallpaper(
	bridge: WallpaperBridge,
	update: (snapshot: WallpaperSnapshot) => void,
	tick: (clock: ClockSnapshot) => void,
	serial?: string,
): () => void {
	const offSnapshot = bridge.onSnapshot((input) => {
		if (
			Schema.is(WallpaperSnapshot)(input) &&
			(serial === undefined || input.saved.serial === serial)
		)
			update(input);
	});
	const offClock = bridge.onClock((input) => {
		if (Schema.is(ClockSnapshot)(input)) tick(input);
	});
	return () => {
		offSnapshot();
		offClock();
	};
}

export function useWallpaper() {
	const serial =
		new URLSearchParams(window.location.search).get("serial") ?? undefined;
	const [snapshot, setSnapshot] = useState<WallpaperSnapshot>();
	const [notice, setNotice] = useState("");
	const [busy, setBusy] = useState(false);
	const mounted = useRef(false);
	const inFlight = useRef(false);
	const request = useCallback(
		async (command: WallpaperCommand): Promise<void> => {
			const bridge = window.quakeWallpaper;
			if (!bridge || inFlight.current) return;
			inFlight.current = true;
			setBusy(true);
			setNotice("");
			try {
				const reply = await bridge.request(command);
				if (!mounted.current) return;
				if (!Schema.is(WallpaperReply)(reply)) {
					setNotice("Wallpaper response was invalid. Reload the window.");
					return;
				}
				if (reply._tag === "failure") {
					setNotice(reply.message);
					return;
				}
				if (serial !== undefined && reply.snapshot.saved.serial !== serial)
					return;
				setSnapshot((current) =>
					current &&
					current.clock.epochMillis > reply.snapshot.clock.epochMillis
						? { ...reply.snapshot, clock: current.clock }
						: reply.snapshot,
				);
			} catch {
				if (mounted.current)
					setNotice(
						"Wallpaper service is unavailable. Reload the window to reconnect.",
					);
			} finally {
				inFlight.current = false;
				if (mounted.current) setBusy(false);
			}
		},
		[serial],
	);
	useEffect(() => {
		mounted.current = true;
		const bridge = window.quakeWallpaper;
		if (!bridge) {
			setNotice("Open the desktop app to select and save local wallpaper.");
			return () => {
				mounted.current = false;
			};
		}
		const unsubscribe = subscribeWallpaper(
			bridge,
			(next) =>
				setSnapshot((current) =>
					current && current.clock.epochMillis > next.clock.epochMillis
						? { ...next, clock: current.clock }
						: next,
				),
			(clock) =>
				setSnapshot((current) => (current ? { ...current, clock } : current)),
			serial,
		);
		void request({ _tag: "read" });
		return () => {
			mounted.current = false;
			unsubscribe();
		};
	}, [request, serial]);
	useEffect(() => {
		if (new URLSearchParams(window.location.search).get("surface") !== "panel")
			return;
		const nodes = [
			document.documentElement,
			document.body,
			document.getElementById("root"),
		].filter((node) => node !== null);
		const previous = nodes.map((node) => node.style.backgroundColor);
		for (const node of nodes)
			node.style.backgroundColor = snapshot?.saved.settings.isTransparent
				? "transparent"
				: "#000000";
		return () =>
			nodes.forEach((node, index) => {
				node.style.backgroundColor = previous[index] ?? "";
			});
	}, [snapshot?.saved.settings.isTransparent]);
	return { snapshot, notice, busy, request };
}
