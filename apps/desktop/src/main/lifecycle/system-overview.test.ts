import { expect, it, vi } from "vitest";
import { createTouchTracker } from "../../../../../packages/device/src/touch/touch-invariants";
import { createSystemOverview } from "./system-overview";

const tracker = createTouchTracker();
const down = {
	source: "hid",
	kind: "touch",
	points: tracker.frame([{ action: 0, x: 100, y: 100 }]),
} as const;
const up = { ...down, points: tracker.frame([]) } as const;
it("consumes a complete cancel contact only on the device that opened an overview", async () => {
	const cancel = vi.fn(async () => {});
	const overview = createSystemOverview(cancel);
	overview.open("A");
	expect(overview.consume("B", down)).toBe(false);
	expect(overview.consume("A", up)).toBe(false);
	expect(overview.consume("A", down)).toBe(true);
	expect(overview.consume("A", down)).toBe(true);
	expect(overview.consume("A", up)).toBe(true);
	await vi.waitFor(() => expect(overview.consume("A", down)).toBe(false));
	expect(cancel).toHaveBeenCalledExactlyOnceWith("A");
});
it("clears ownership on disconnect and allows cancellation retry after failure", async () => {
	const cancel = vi.fn(async () => {
		throw Error("unavailable");
	});
	const overview = createSystemOverview(cancel);
	overview.open("A");
	overview.consume("A", down);
	overview.consume("A", up);
	await vi.waitFor(() => {
		overview.consume("A", down);
		expect(cancel).toHaveBeenCalledTimes(2);
	});
	overview.consume("A", {
		source: "hid",
		kind: "status",
		state: "disconnected",
		reason: "scope-closed",
	});
	expect(overview.consume("A", down)).toBe(false);
});

it("doesn't let a late cancellation clear a replacement overview", async () => {
	let finish: () => void = () => {};
	const cancelled = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const cancel = vi.fn(() => cancelled);
	const overview = createSystemOverview(cancel);
	overview.open("A");
	const first = overview.tap("A");
	overview.open("A");
	finish();
	await first;
	expect(await overview.tap("A")).toBe(true);
	expect(cancel).toHaveBeenCalledTimes(2);
});

it("keeps move actions inside the cancellation until an explicit lift", async () => {
	const cancel = vi.fn(async () => {}),
		overview = createSystemOverview(cancel);
	overview.open("A");
	expect(overview.consume("A", down)).toBe(true);
	await vi.waitFor(() => expect(cancel).toHaveResolved());
	expect(
		overview.consume("A", { ...down, points: [{ action: 2, x: 110, y: 110 }] }),
	).toBe(true);
	expect(overview.consume("A", up)).toBe(true);
	expect(overview.consume("A", down)).toBe(false);
});
