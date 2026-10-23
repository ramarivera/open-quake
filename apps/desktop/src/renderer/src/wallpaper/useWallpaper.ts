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
): () => void {
	const offSnapshot = bridge.onSnapshot((input) => {
		if (Schema.is(WallpaperSnapshot)(input)) update(input);
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
		[],
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
		);
		void request({ _tag: "read" });
		return () => {
			mounted.current = false;
			unsubscribe();
		};
	}, [request]);
	return { snapshot, notice, busy, request };
}
