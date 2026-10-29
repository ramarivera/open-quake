import { expect, it, vi } from "vitest";
import { createSystemOverview } from "./system-overview";

const down = {
	source: "hid",
	kind: "touch",
	points: [{ action: 0, x: 100, y: 100 }],
} as const;
const up = { ...down, points: [{ action: 1, x: 100, y: 100 }] } as const;
it("consumes a complete cancel contact only on the device that opened an overview", async () => {
	const cancel = vi.fn(async () => {});
	const overview = createSystemOverview(cancel);
	overview.open("A");
	expect(overview.consume("B", down)).toBe(false);
	expect(overview.consume("A", up)).toBe(false);
	expect(overview.consume("A", down)).toBe(true);
	expect(overview.consume("A", down)).toBe(true);
	expect(overview.consume("A", up)).toBe(true);
	await Promise.resolve();
	expect(cancel).toHaveBeenCalledExactlyOnceWith("A");
	expect(overview.consume("A", down)).toBe(false);
});
it("clears ownership on disconnect and allows cancellation retry after failure", async () => {
	const cancel = vi.fn(async () => {
		throw Error("unavailable");
	});
	const overview = createSystemOverview(cancel);
	overview.open("A");
	overview.consume("A", down);
	overview.consume("A", up);
	await Promise.resolve();
	await Promise.resolve();
	expect(overview.consume("A", down)).toBe(true);
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
