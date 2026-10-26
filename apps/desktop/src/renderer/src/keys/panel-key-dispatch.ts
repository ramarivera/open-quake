import type { KeyLibraryBridge } from "../../../shared/key-library";
import type { StripKeyEvent } from "../strip/touch-controller";
export interface PanelKeyTarget {
	readonly deviceId: string;
	readonly profileId: string;
	readonly pageId: string;
	readonly revision: number;
}
/** Contact edges retain the committed identity and release even after cancellation. */
export function createPanelKeyDispatcher(
	target: () => PanelKeyTarget | undefined,
	request: KeyLibraryBridge["request"],
	queueBy: "key" | "device" = "key",
) {
	const queues = new Map<string, Promise<void>>();
	let generation = 0;
	let pending:
		| (PanelKeyTarget & {
				readonly keyCode: string;
				readonly epoch: number;
				started: boolean;
		  })
		| undefined;
	const enqueue = (
		tap: NonNullable<typeof pending>,
		kind: "down" | "up" | "cancel",
	) => {
		const identity = JSON.stringify(
			queueBy === "device" ? [tap.deviceId] : [tap.deviceId, tap.keyCode],
		);
		const queue = (queues.get(identity) ?? Promise.resolve())
			.then(async () => {
				if (kind === "down") {
					if (tap.epoch !== generation) return;
					tap.started = true;
				} else if (!tap.started) return;
				const { epoch: _epoch, started: _started, ...activation } = tap;
				await request({
					...activation,
					type: "activate",
					kind: kind === "up" && tap.epoch !== generation ? "cancel" : kind,
				});
			})
			.catch(() => {
				/* Main owns action failure feedback, release remains queued. */
			})
			.finally(() => {
				if (queues.get(identity) === queue) queues.delete(identity);
			});
		queues.set(identity, queue);
	};
	return {
		key(event: StripKeyEvent): void {
			if (event.keyAction === 0) {
				if (pending) return;
				const active = target();
				if (!active) return;
				pending = {
					...active,
					keyCode: event.keyCode,
					epoch: generation,
					started: false,
				};
				enqueue(pending, "down");
				return;
			}
			const tap = pending;
			if (!tap || tap.keyCode !== event.keyCode) return;
			pending = undefined;
			enqueue(tap, event.voiceTouchEnd ? "up" : "cancel");
		},
		cancel(): void {
			generation++;
			if (pending) enqueue(pending, "cancel");
			pending = undefined;
		},
	};
}
