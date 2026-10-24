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
	let queue = Promise.resolve();
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
			queue = queue
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
				});
		},
		cancel(): void {
			generation++;
			pending = undefined;
		},
	};
}
