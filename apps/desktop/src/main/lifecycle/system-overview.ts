import type { QuakeEvent } from "../../preload/quake";

/** An overview-cancel contact cannot activate the tile underneath it. */
export function createSystemOverview(
	cancel: (serial: string) => Promise<void>,
) {
	type Entry = { phase: "armed" | "contact" | "released"; pending: boolean };
	const state = new Map<string, Entry>();
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
		open: (serial: string) => {
			state.set(serial, { phase: "armed", pending: false });
		},
		tap: async (serial: string) => {
			const entry = state.get(serial);
			if (!entry) return false;
			if (entry.phase !== "armed") return true;
			entry.phase = "released";
			await dismiss(serial, entry);
			return true;
		},
		consume: (serial: string, event: QuakeEvent): boolean => {
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
	};
}
