import { Deferred, Effect, ManagedRuntime } from "effect";
import { ipcMain } from "electron";
import { describe, expect, it, vi } from "vitest";
import type { KnobModelContext } from "../../../../../packages/device/src/knob/model/contracts.js";
import { KnobModel } from "../../../../../packages/device/src/knob/model/service.js";
import { KNOB_REQUEST } from "../../shared/knob-contracts";
import { registerKnobRuntime } from "./index";

vi.mock("electron", () => ({
	app: {},
	ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
	nativeImage: { createFromBuffer: vi.fn() },
}));

describe("knob registration shutdown", () => {
	for (const stage of [
		"event-initialization",
		"refresh-initialization",
		"refresh-load",
	] as const) {
		it(`cancels ${stage} before waiting for the queue or disposing its runtime`, async () => {
			const runtime = ManagedRuntime.make(KnobModel.Default);
			const context = (await runtime.runPromise(KnobModel.snapshot())).context;
			const entered = await Effect.runPromise(Deferred.make<void>());
			const release = await Effect.runPromise(
				Deferred.make<KnobModelContext>(),
			);
			let reads = 0;
			let interrupted = false;
			const load = Effect.suspend(() => {
				reads++;
				if (stage === "refresh-load" && reads === 1)
					return Effect.succeed(context);
				return Deferred.succeed(entered, undefined).pipe(
					Effect.zipRight(Deferred.await(release)),
					Effect.onInterrupt(() =>
						Effect.sync(() => {
							interrupted = true;
						}),
					),
				);
			});
			const registration = registerKnobRuntime(
				runtime,
				load,
				() => undefined,
				() => [],
			);
			let refresh: Promise<void> | undefined;
			if (stage === "event-initialization") {
				registration.onDevice({
					source: "mock",
					kind: "status",
					state: "connected",
				});
			} else refresh = registration.refresh().catch(() => {});
			await Effect.runPromise(Deferred.await(entered));
			const runPromise = vi.spyOn(runtime, "runPromise");
			const closing = registration.dispose();
			try {
				await vi.waitFor(() => expect(interrupted).toBe(true), {
					timeout: 1000,
				});
				await closing;
				expect(ipcMain.removeHandler).toHaveBeenCalledWith(KNOB_REQUEST);
				expect(reads).toBe(stage === "refresh-load" ? 2 : 1);
				runPromise.mockClear();
				await Effect.runPromise(Deferred.succeed(release, context));
				await refresh;
				registration.onDevice({ source: "mock", kind: "rotate", direction: 1 });
				await registration.refresh();
				expect(runPromise).not.toHaveBeenCalled();
			} finally {
				await Effect.runPromise(Deferred.succeed(release, context));
				await refresh;
				await closing;
			}
		});
	}
});
