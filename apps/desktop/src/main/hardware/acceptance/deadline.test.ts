import { expect, it } from "vitest";
import { acceptanceDeadline } from "./deadline.js";

it("cancels stalled work, bounds cleanup, releases ownership, then exits", async () => {
	const order: string[] = [];
	let finished: (() => void) | undefined;
	const done = new Promise<void>((resolve) => {
		finished = resolve;
	});
	const deadline = acceptanceDeadline(
		async () => {
			order.push("release");
		},
		() => {
			order.push("exit");
			finished?.();
		},
		5,
		5,
	);
	deadline.signal.addEventListener("abort", () => order.push("abort"));
	deadline.add(() => {
		order.push("close");
		return new Promise<void>(() => {});
	});
	await done;
	expect(order).toEqual(["abort", "close", "release", "exit"]);
	expect(deadline.signal.aborted).toBe(true);
});

it("still exits when releasing ownership stalls", async () => {
	let finished: (() => void) | undefined;
	const done = new Promise<void>((resolve) => {
		finished = resolve;
	});
	acceptanceDeadline(
		() => new Promise<void>(() => {}),
		() => finished?.(),
		5,
		5,
	);
	await done;
});

it("successful completion cancels the deadline and does not close released resources", async () => {
	let closed = false;
	const deadline = acceptanceDeadline(
		async () => {
			closed = true;
		},
		() => {
			closed = true;
		},
		5,
		5,
	);
	const remove = deadline.add(async () => {
		closed = true;
	});
	remove();
	deadline.finish();
	await new Promise<void>((resolve) => setTimeout(resolve, 15));
	expect(closed).toBe(false);
	expect(deadline.signal.aborted).toBe(false);
});
