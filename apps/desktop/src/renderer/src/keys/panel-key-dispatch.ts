import type { KeyLibraryBridge } from "../../../shared/key-library";
import type { StripKeyEvent } from "../strip/touch-controller";
export interface PanelKeyTarget {
	readonly deviceId: string;
	readonly profileId: string;
	readonly pageId: string;
	readonly revision: number;
}
/** A tap retains its original committed identity. Swipes and disconnects cancel it. */
export function createPanelKeyDispatcher(
	target: () => PanelKeyTarget | undefined,
	request: KeyLibraryBridge["request"],
) {
	// Preserve press/release order for each key without serializing unrelated taps.
	const queues = new Map<string, Promise<void>>();
	let generation = 0;
	let pending: (PanelKeyTarget & { readonly keyCode: string }) | undefined;
	return {
		key(event: StripKeyEvent): void {
			if (event.keyAction === 0) {
				const active = target();
				pending = active ? { ...active, keyCode: event.keyCode } : undefined;
				return;
			}
			const tap = pending;
			if (!tap || tap.keyCode !== event.keyCode) return;
			pending = undefined;
			const epoch = generation;
			const identity = JSON.stringify([tap.deviceId, tap.keyCode]);
			const queue = (queues.get(identity) ?? Promise.resolve())
				.then(async () => {
					if (epoch !== generation) return;
					try {
						await request({ ...tap, type: "activate", kind: "press" });
					} finally {
						await request({ ...tap, type: "activate", kind: "release" });
					}
				})
				.catch(() => {
					/* A destroyed renderer cannot display shutdown failures. */
				})
				.finally(() => {
					if (queues.get(identity) === queue) queues.delete(identity);
				});
			queues.set(identity, queue);
		},
		cancel(): void {
			generation++;
			pending = undefined;
		},
	};
}
