import { Schema } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type ClockBridge,
	type ClockCommand,
	ClockReply,
	ClockSnapshot,
	ClockTarget,
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
	return current &&
		JSON.stringify(current.target) === JSON.stringify(next.target) &&
		current.revision > next.revision
		? current
		: next;
}

export interface ClockSettings {
	readonly snapshot: ClockSnapshot | undefined;
	readonly available: boolean;
	/** The first read has answered (or failed); render defaults if no snapshot. */
	readonly ready: boolean;
	readonly request: (command: ClockCommand) => Promise<ClockReply | undefined>;
	readonly selectTheme: (themeId: ThemeId) => Promise<ClockThemeResult>;
}

export function useClockSettings(
	bridge: ClockBridge | undefined = typeof window === "undefined"
		? undefined
		: window.quakeClock,
	target?: ClockTarget,
	beforeWrite?: (() => Promise<boolean>) | undefined,
): ClockSettings {
	const [snapshot, setSnapshot] = useState<ClockSnapshot>();
	const targetId = JSON.stringify(target);
	const resolvedTarget = useRef<ClockTarget | undefined>(undefined);
	const sequence = useRef(0);
	const before = useRef(beforeWrite);
	before.current = beforeWrite;
	const active = useRef(targetId);
	active.current = targetId;
	const [settled, setSettled] = useState(false);
	const mounted = useRef(true);
	const request = useCallback(
		async (command: ClockCommand): Promise<ClockReply | undefined> => {
			if (!bridge) return undefined;
			const ticket = ++sequence.current;
			if (
				command._tag !== "read" &&
				before.current &&
				!(await before.current())
			)
				return undefined;
			let reply: unknown;
			try {
				const commandTarget = targetId
					? Schema.decodeUnknownSync(ClockTarget)(JSON.parse(targetId))
					: command._tag !== "read"
						? resolvedTarget.current
						: undefined;
				reply = await bridge.request({
					...command,
					...(commandTarget ? { target: commandTarget } : {}),
				});
			} catch {
				return undefined;
			}
			if (!Schema.is(ClockReply)(reply)) return undefined;
			if (
				reply._tag === "success" &&
				mounted.current &&
				active.current === targetId &&
				sequence.current === ticket
			) {
				resolvedTarget.current = reply.snapshot.target;
				setSnapshot((current) => newest(current, reply.snapshot));
			}
			return reply;
		},
		[bridge, targetId],
	);
	useEffect(() => {
		mounted.current = true;
		if (!bridge) return;
		setSnapshot(undefined);
		setSettled(false);
		resolvedTarget.current = targetId
			? Schema.decodeUnknownSync(ClockTarget)(JSON.parse(targetId))
			: undefined;
		const off = bridge.onSnapshot((value) => {
			if (
				Schema.is(ClockSnapshot)(value) &&
				JSON.stringify(value.target) ===
					(targetId ?? JSON.stringify(resolvedTarget.current))
			)
				setSnapshot((current) => newest(current, value));
		});
		const offProfiles = window.quakeProfiles?.onSnapshot(() => {
			void request({ _tag: "read" });
		});
		void request({ _tag: "read" }).finally(() => {
			if (mounted.current && active.current === targetId) setSettled(true);
		});
		return () => {
			mounted.current = false;
			off();
			offProfiles?.();
		};
	}, [bridge, request, targetId]);
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
	return {
		snapshot:
			!targetId ||
			!snapshot?.target ||
			JSON.stringify(snapshot.target) === targetId
				? snapshot
				: undefined,
		available: !!bridge,
		ready: !bridge || snapshot !== undefined || settled,
		request,
		selectTheme,
	};
}
