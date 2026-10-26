import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { makePowerOwner } from "./power-owner";

it("owns one app suspension blocker across first/last device and duplicate events", async () => {
	const start = vi.fn(() => 12);
	const stop = vi.fn();
	const owner = makePowerOwner({ start, stop });
	for (const count of [0, 1, 2, 1, 2, 2, 1])
		await Effect.runPromise(owner.setCount(count));
	expect(start).toHaveBeenCalledExactlyOnceWith("prevent-app-suspension");
	expect(stop).not.toHaveBeenCalled();
	await Effect.runPromise(owner.setCount(0));
	await Effect.runPromise(owner.close());
	expect(stop).toHaveBeenCalledExactlyOnceWith(12);
});
describe("failure cleanup", () => {
	it("retries a failed start without losing close ownership", async () => {
		const cause = new Error("token=secret");
		const start = vi
			.fn(() => 4)
			.mockImplementationOnce(() => {
				throw cause;
			});
		const stop = vi.fn();
		const owner = makePowerOwner({ start, stop });
		const failure = await Effect.runPromise(Effect.flip(owner.setCount(1)));
		expect(failure.originalCause).toBe(cause);
		expect(JSON.stringify(failure)).not.toContain("secret");
		await Effect.runPromise(owner.setCount(1));
		await Effect.runPromise(owner.close());
		expect(stop).toHaveBeenCalledExactlyOnceWith(4);
	});
});
