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

it("passes the next input after a witnessed host dismissal without sending Escape", async () => {
	vi.useFakeTimers();
	let visible = false;
	const cancel = vi.fn(async () => {});
	const overview = createSystemOverview(cancel, () => visible);
	try {
		overview.open("A", "windows");
		await vi.advanceTimersByTimeAsync(500);
		visible = true;
		await vi.advanceTimersByTimeAsync(100);
		visible = false;
		expect(overview.consume("A", down)).toBe(false);
		expect(await overview.tap("A")).toBe(false);
		expect(cancel).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	} finally {
		overview.dispose();
		vi.useRealTimers();
	}
});

it("keeps unwitnessed or failed observations armed without an expiry timeout", async () => {
	vi.useFakeTimers();
	let visible: boolean | undefined = false;
	const cancel = vi.fn(async () => {});
	const overview = createSystemOverview(cancel, () => visible);
	try {
		overview.open("A", "windows");
		await vi.advanceTimersByTimeAsync(100000);
		expect(await overview.tap("A")).toBe(true);
		overview.open("B", "windows");
		visible = true;
		await vi.advanceTimersByTimeAsync(100);
		visible = undefined;
		await vi.advanceTimersByTimeAsync(100);
		expect(await overview.tap("B")).toBe(true);
		expect(cancel).toHaveBeenCalledTimes(2);
	} finally {
		overview.dispose();
		vi.useRealTimers();
	}
});

it("retains the full cancellation contact when its native window disappears", async () => {
	vi.useFakeTimers();
	let visible = true;
	const overview = createSystemOverview(
		async () => {},
		() => visible,
	);
	try {
		overview.open("A", "windows");
		expect(overview.consume("A", down)).toBe(true);
		visible = false;
		await vi.advanceTimersByTimeAsync(100);
		expect(
			overview.consume("A", {
				...down,
				points: [{ action: 2, x: 100, y: 100 }],
			}),
		).toBe(true);
		expect(overview.consume("A", up)).toBe(true);
		expect(overview.consume("A", down)).toBe(false);
	} finally {
		overview.dispose();
		vi.useRealTimers();
	}
});

it("doesn't probe ordinary device input or unobservable overview modes", async () => {
	const visible = vi.fn(() => false);
	const overview = createSystemOverview(async () => {}, visible);
	expect(overview.consume("A", down)).toBe(false);
	overview.open("A");
	expect(await overview.tap("A")).toBe(true);
	expect(visible).not.toHaveBeenCalled();
	overview.dispose();
});

it("observes each device's actual mode so an unrelated host overlay can't keep it armed", async () => {
	vi.useFakeTimers();
	const visible = {
		windows: true,
		search: true,
		apps: true,
		"force-quit": true,
		screenshot: true,
	};
	const cancel = vi.fn(async () => {});
	const overview = createSystemOverview(
		cancel,
		(mode: keyof typeof visible) => visible[mode],
	);
	try {
		for (const mode of Object.keys(visible) as (keyof typeof visible)[])
			overview.open(mode, mode);
		visible.search = false;
		visible.apps = false;
		visible["force-quit"] = false;
		visible.screenshot = false;
		await vi.advanceTimersByTimeAsync(100);
		for (const mode of ["search", "apps", "force-quit", "screenshot"])
			expect(await overview.tap(mode)).toBe(false);
		expect(cancel).not.toHaveBeenCalled();
		expect(await overview.tap("windows")).toBe(true);
	} finally {
		overview.dispose();
		vi.useRealTimers();
	}
});

it("keeps observing supported modes when another mode's native reader fails", async () => {
	vi.useFakeTimers();
	let visible = true;
	const overview = createSystemOverview(
		async () => {},
		(mode) => (mode === "apps" ? undefined : visible),
	);
	try {
		overview.open("A", "apps");
		overview.open("B", "search");
		visible = false;
		await vi.advanceTimersByTimeAsync(100);
		expect(await overview.tap("B")).toBe(false);
		expect(await overview.tap("A")).toBe(true);
	} finally {
		overview.dispose();
		vi.useRealTimers();
	}
});

it("retries transient native failures during overlay launch before witnessing dismissal", async () => {
	vi.useFakeTimers();
	let visible: boolean | undefined;
	const cancel = vi.fn(async () => {});
	const overview = createSystemOverview(cancel, () => visible);
	try {
		overview.open("A", "apps");
		visible = true;
		await vi.advanceTimersByTimeAsync(100);
		visible = false;
		await vi.advanceTimersByTimeAsync(100);
		expect(await overview.tap("A")).toBe(false);
		expect(cancel).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	} finally {
		overview.dispose();
		vi.useRealTimers();
	}
});
