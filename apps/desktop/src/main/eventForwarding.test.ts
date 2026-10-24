import { describe, expect, it, vi } from "vitest";
import type { QuakeEvent } from "../preload/quake";
import { createEventForwarder } from "./eventForwarding";

const event: QuakeEvent = { source: "hid", kind: "rotate", direction: -1 };

function makeWindow(destroyed = false) {
	return {
		isDestroyed: () => destroyed,
		webContents: { send: vi.fn() },
	};
}

describe("event forwarding", () => {
	it("delivers the same event to both windows on quake:event", () => {
		const panel = makeWindow();
		const management = makeWindow();
		createEventForwarder(() => [panel, management])(event);
		for (const window of [panel, management]) {
			expect(window.webContents.send).toHaveBeenCalledExactlyOnceWith(
				"quake:event",
				event,
			);
		}
	});

	it.each([0, 1])(
		"skips destroyed window %i and delivers to the survivor",
		(i) => {
			const destroyed = makeWindow(true);
			const alive = makeWindow();
			const windows = i === 0 ? [destroyed, alive] : [alive, destroyed];
			createEventForwarder(() => windows)(event);
			expect(destroyed.webContents.send).not.toHaveBeenCalled();
			expect(alive.webContents.send).toHaveBeenCalledExactlyOnceWith(
				"quake:event",
				event,
			);
		},
	);

	it("reads replacement windows on the next event", () => {
		const original = makeWindow();
		const replacement = makeWindow();
		let windows = [original];
		const forward = createEventForwarder(() => windows);
		forward(event);
		windows = [replacement];
		forward(event);
		expect(original.webContents.send).toHaveBeenCalledTimes(1);
		expect(replacement.webContents.send).toHaveBeenCalledExactlyOnceWith(
			"quake:event",
			event,
		);
	});
});

it("delivers touch only to the current owning panel", () => {
	const panel = makeWindow(),
		management = makeWindow();
	const forward = createEventForwarder(
		() => [panel, management],
		() => [panel],
	);
	forward({
		source: "hid",
		kind: "touch",
		points: [{ touchId: "touch-1", action: 1, x: 120, y: 360 }],
	});
	expect(panel.webContents.send).toHaveBeenCalledTimes(1);
	expect(management.webContents.send).not.toHaveBeenCalled();
});
