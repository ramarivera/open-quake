import type { QuakeEvent } from "../../preload/quake";

/** An overview-cancel contact cannot activate the tile underneath it. */
export function createSystemOverview(
	cancel: (serial: string) => Promise<void>,
	visibility?: () => boolean | undefined,
) {
	type Entry = {
		phase: "armed" | "contact" | "released";
		pending: boolean;
		observable: boolean;
		seen: boolean;
	};
	const state = new Map<string, Entry>();
	let timer: ReturnType<typeof setInterval> | undefined;
	const refresh = () => {
		const observable = [...state.values()].some(
			(entry) => entry.observable && entry.phase === "armed",
		);
		let visible: boolean | undefined;
		if (observable) {
			try {
				visible = visibility?.();
			} catch {
				/* An unavailable probe cannot prove dismissal. */
			}
		}

		for (const [serial, entry] of state) {
			if (!entry.observable || entry.phase !== "armed") continue;
			if (visible === true) entry.seen = true;
			else if (visible === false && entry.seen) state.delete(serial);
		}
		if (
			visible === undefined ||
			![...state.values()].some(
				(entry) => entry.observable && entry.phase === "armed",
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
		open: (serial: string, observable = false) => {
			state.set(serial, {
				phase: "armed",
				pending: false,
				observable,
				seen: false,
			});
			if (observable && visibility && !timer) {
				timer = setInterval(refresh, 100);
				timer.unref();
			}
			if (observable) refresh();
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
