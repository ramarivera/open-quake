import { Schema } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type ClockBridge,
	type ClockCommand,
	ClockReply,
	ClockSnapshot,
} from "../../../../../shared/clock-contracts";
import {
	CLOCK_KEY_CODE,
	THEME_IDS,
	type ThemeId,
} from "../../../../../shared/clock-style";
import type { ClockMediaSource } from "./backgroundLoader";
import type { ClockThemeResult } from "./themePreview";

/** The tile's `theme` prop from a snapshot. */
export function themeOf(snapshot: ClockSnapshot): ThemeId | "none" {
	return snapshot.mode === "none" ? "none" : snapshot.themeId;
}

/** Custom media the tile may try; missing files go straight to built-in art. */
export function mediaOf(
	snapshot: ClockSnapshot | undefined,
): Partial<Record<ThemeId, ClockMediaSource>> {
	const media: Partial<Record<ThemeId, ClockMediaSource>> = {};
	for (const id of THEME_IDS) {
		const view = snapshot?.media[id];
		if (view?.available) media[id] = { kind: view.kind, url: view.url };
	}
	return media;
}

/** Maps a bridge reply for a device theme switch onto the tile's result. */
export function themeResultOf(reply: unknown): ClockThemeResult {
	if (!Schema.is(ClockReply)(reply)) return { ok: false, reason: "bad-config" };
	if (reply._tag === "success") return { ok: true };
	if (reply._tag === "failure")
		return { ok: false, reason: reply.reason ?? "write-failed" };
	return { ok: false, reason: "bad-config" };
}

/** Newer revisions win, so a late reply never rewinds a broadcast. */
export function newest(
	current: ClockSnapshot | undefined,
	next: ClockSnapshot,
): ClockSnapshot {
	return current && current.revision > next.revision ? current : next;
}

export interface ClockSettings {
	readonly snapshot: ClockSnapshot | undefined;
	readonly available: boolean;
	readonly request: (command: ClockCommand) => Promise<ClockReply | undefined>;
	readonly selectTheme: (themeId: ThemeId) => Promise<ClockThemeResult>;
}

export function useClockSettings(
	bridge: ClockBridge | undefined = typeof window === "undefined"
		? undefined
		: window.quakeClock,
): ClockSettings {
	const [snapshot, setSnapshot] = useState<ClockSnapshot>();
	const mounted = useRef(true);
	const request = useCallback(
		async (command: ClockCommand): Promise<ClockReply | undefined> => {
			if (!bridge) return undefined;
			const reply: unknown = await bridge.request(command);
			if (!Schema.is(ClockReply)(reply)) return undefined;
			if (reply._tag === "success" && mounted.current)
				setSnapshot((current) => newest(current, reply.snapshot));
			return reply;
		},
		[bridge],
	);
	useEffect(() => {
		mounted.current = true;
		if (!bridge) return;
		const off = bridge.onSnapshot((value) => {
			if (Schema.is(ClockSnapshot)(value))
				setSnapshot((current) => newest(current, value));
		});
		void request({ _tag: "read" });
		return () => {
			mounted.current = false;
			off();
		};
	}, [bridge, request]);
	const selectTheme = useCallback(
		async (themeId: ThemeId): Promise<ClockThemeResult> => {
			if (!bridge) return { ok: false, reason: "no-target" };
			return themeResultOf(
				await request({
					_tag: "setTheme",
					keyCode: snapshot?.keyCode ?? CLOCK_KEY_CODE,
					themeId,
				}),
			);
		},
		[bridge, request, snapshot?.keyCode],
	);
	return { snapshot, available: !!bridge, request, selectTheme };
}
