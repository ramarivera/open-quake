import type { QuakeEvent } from "../../preload/quake";

export type SystemOverviewMode =
	| "windows"
	| "apps"
	| "search"
	| "force-quit"
	| "screenshot";

/** An overview-cancel contact cannot activate the tile underneath it. */
export function createSystemOverview(
	cancel: (serial: string) => Promise<void>,
	visibility?: (mode: SystemOverviewMode) => boolean | undefined,
) {
	type Entry = {
		phase: "armed" | "contact" | "released";
		pending: boolean;
		mode: SystemOverviewMode | undefined;
		seen: boolean;
	};
	const state = new Map<string, Entry>();
	let timer: ReturnType<typeof setInterval> | undefined;
	const refresh = () => {
		const readings = new Map<SystemOverviewMode, boolean | undefined>();
		for (const entry of state.values()) {
			if (!entry.mode || entry.phase !== "armed" || readings.has(entry.mode))
				continue;
			let visible: boolean | undefined;
			try {
				visible = visibility?.(entry.mode);
			} catch {
				/* An unavailable probe cannot prove dismissal. */
			}
			readings.set(entry.mode, visible);
		}
		for (const [serial, entry] of state) {
			if (!entry.mode || entry.phase !== "armed") continue;
			const visible = readings.get(entry.mode);
			if (visible === true) entry.seen = true;
			else if (visible === false && entry.seen) state.delete(serial);
		}
		if (
			![...state.values()].some(
				(entry) => entry.mode && entry.phase === "armed",
			)
		) {
			clearInterval(timer);
			timer = undefined;
		}
	};
	const dismiss = async (serial: string, entry: Entry) => {
		entry.pending = true;
		try {
			await cancel(serial);
			entry.pending = false;
			if (state.get(serial) === entry && entry.phase === "released")
				state.delete(serial);
		} catch (error) {
			entry.pending = false;
			if (state.get(serial) === entry) entry.phase = "armed";
			throw error;
		}
	};
	return {
		open: (serial: string, mode?: SystemOverviewMode) => {
			state.set(serial, {
				phase: "armed",
				pending: false,
				mode,
				seen: false,
			});
			if (mode && visibility && !timer) {
				timer = setInterval(refresh, 100);
				timer.unref();
			}
			if (mode) refresh();
		},
		tap: async (serial: string) => {
			refresh();
			const entry = state.get(serial);
			if (!entry) return false;
			if (entry.phase !== "armed") return true;
			entry.phase = "released";
			await dismiss(serial, entry);
			return true;
		},
		consume: (serial: string, event: QuakeEvent): boolean => {
			refresh();
			if (event.kind === "status" && event.state !== "connected")
				state.delete(serial);
			const entry = state.get(serial);
			if (!entry || event.kind !== "touch" || event.points.length === 0)
				return false;
			if (entry.phase === "armed") {
				if (!event.points.some((point) => point.action === 1)) return false;
				entry.phase = "contact";
				void dismiss(serial, entry).catch(() => {});
			}
			if (event.points.every((point) => point.action === 0)) {
				entry.phase = "released";
				if (!entry.pending) state.delete(serial);
			}
			return true;
		},
		dispose: () => {
			clearInterval(timer);
			timer = undefined;
			state.clear();
		},
	};
}
