import { expect, it, vi } from "vitest";
import { resetKeysOnLinkLoss } from "./device-status";

it("resets real HID and mock disconnects but preserves runtime on normal connected events", async () => {
	const reset = vi.fn(async () => {});
	for (const source of ["hid", "mock"] as const) {
		await resetKeysOnLinkLoss(
			{ source, kind: "status", state: "connected" },
			reset,
		);
		expect(reset).toHaveBeenCalledTimes(source === "hid" ? 0 : 1);
		await resetKeysOnLinkLoss(
			{ source, kind: "status", state: "disconnected", reason: "scope-closed" },
			reset,
		);
	}
	expect(reset).toHaveBeenCalledTimes(2);
});

it("resets on transport error and awaits asynchronous cleanup", async () => {
	let finish: (() => void) | undefined;
	const gate = new Promise<void>((resolve) => {
		finish = resolve;
	});
	let done = false;
	const result = resetKeysOnLinkLoss(
		{
			source: "hid",
			kind: "status",
			state: "error",
			error: {
				_tag: "QuakeDeviceNotFound",
				code: "QUAKE.DEVICE.NOT_FOUND",
				category: "unavailable",
			},
		},
		() => gate,
	).then(() => {
		done = true;
	});
	await Promise.resolve();
	expect(done).toBe(false);
	finish?.();
	await result;
	expect(done).toBe(true);
});
