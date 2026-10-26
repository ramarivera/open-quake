import { afterEach, expect, it, vi } from "vitest";
import { negotiateDeviceMatrix } from "../../../shared/hardware-contracts";
import { createStripResourceReceiver } from "./device-resources";
import { createStripDeviceSession } from "./device-session";

const ready = {
	_tag: "ready",
	snapshot: {
		serialNumber: "A",
		connected: true,
		session: "s1",
		deviceModel: "QUAKE_HID",
		connectionType: "HID",
		rotation: 0,
		keyMatrix: { row: 2, col: 8 },
		version: "1.0.21",
	},
};
afterEach(() => vi.useRealTimers());
it("recovers at ten incremental deadlines, then waits for explicit recovery and cancels on close", async () => {
	vi.useFakeTimers();
	const read = vi.fn(async () => ({ _tag: "offline" }));
	const publish = vi.fn();
	const session = createStripDeviceSession({
		bridge: { read },
		serial: "A",
		ready: publish,
		schedule: (work, delay) => {
			const timer = setTimeout(work, delay);
			return () => clearTimeout(timer);
		},
	});
	session.start();
	await vi.advanceTimersByTimeAsync(0);
	expect(read).toHaveBeenCalledTimes(1);
	for (let attempt = 1; attempt <= 10; attempt++) {
		await vi.advanceTimersByTimeAsync(3000 * attempt - 1);
		expect(read).toHaveBeenCalledTimes(attempt);
		await vi.advanceTimersByTimeAsync(1);
		expect(read).toHaveBeenCalledTimes(attempt + 1);
	}
	await vi.advanceTimersByTimeAsync(60000);
	expect(read).toHaveBeenCalledTimes(11);
	session.recover();
	await vi.advanceTimersByTimeAsync(0);
	expect(read).toHaveBeenCalledTimes(12);
	session.close();
	await vi.advanceTimersByTimeAsync(60000);
	expect(read).toHaveBeenCalledTimes(12);
});
it("rejects wrong serials and stale pending readiness after link loss", async () => {
	vi.useFakeTimers();
	let resolve: (value: unknown) => void = () => {};
	const read = vi.fn(
		() =>
			new Promise<unknown>((r) => {
				resolve = r;
			}),
	);
	const publish = vi.fn();
	const session = createStripDeviceSession({
		bridge: { read },
		serial: "A",
		ready: publish,
		schedule: (work, delay) => {
			const timer = setTimeout(work, delay);
			return () => clearTimeout(timer);
		},
	});
	session.start();
	session.lost();
	resolve(ready);
	await vi.advanceTimersByTimeAsync(0);
	expect(publish).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(3000);
	resolve({ ...ready, snapshot: { ...ready.snapshot, serialNumber: "B" } });
	await vi.advanceTimersByTimeAsync(0);
	expect(publish).not.toHaveBeenCalled();
	session.close();
});
it("assembles resource sequences at the correct cell, drops gaps and clears partial bytes on loss", () => {
	const publish = vi.fn();
	const receiver = createStripResourceReceiver(publish);
	const frame = (sequence: number, payload: readonly number[]) =>
		receiver.accept({
			source: "hid",
			kind: "resource",
			envelope: { opCode: 2, metadata: [1, 2, 8, 0, 0], sequence, payload },
		});
	frame(1, [255, 216]);
	frame(2, [1, 2]);
	frame(0, [255, 217]);
	expect(publish).toHaveBeenCalledWith(
		"2,8",
		"data:image/jpeg;base64,/9gBAv/Z",
	);
	publish.mockClear();
	frame(1, [255, 216]);
	frame(3, [1]);
	frame(0, [255, 217]);
	expect(publish).not.toHaveBeenCalled();
	frame(1, [255, 216]);
	receiver.accept({
		source: "hid",
		kind: "status",
		state: "disconnected",
		reason: "requested",
	});
	frame(0, [255, 217]);
	expect(publish).not.toHaveBeenCalled();
});
it("accepts only supported row counts and forces eight columns", () => {
	expect(negotiateDeviceMatrix(1, 5)).toEqual({ row: 1, col: 8 });
	expect(negotiateDeviceMatrix(2, 10)).toEqual({ row: 2, col: 8 });
	expect(negotiateDeviceMatrix(3, 8)).toBeUndefined();
});
