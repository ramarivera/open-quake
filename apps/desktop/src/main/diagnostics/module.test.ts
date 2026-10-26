import { Cause, Context, Effect, Exit, Fiber, Layer, Option } from "effect";
import { describe, expect, it, vi } from "vitest";
import { prepareDesktopModule } from "./module";
import { makeDesktopRuntime } from "./runtime";

class Counter extends Context.Tag("DesktopModuleCounter")<
	Counter,
	{ readonly increment: Effect.Effect<number> }
>() {}

describe("prepared desktop service ownership", () => {
	it("shares one acquired service and waits for its finalizer only at application disposal", async () => {
		const acquired = vi.fn();
		const released = vi.fn();
		let finishRelease = () => {};
		const release = new Promise<void>((resolve) => {
			finishRelease = resolve;
		});
		const layer = Layer.scoped(
			Counter,
			Effect.acquireRelease(
				Effect.sync(() => {
					acquired();
					let value = 0;
					return { increment: Effect.sync(() => ++value) };
				}),
				() =>
					Effect.promise(() => release).pipe(
						Effect.tap(() => Effect.sync(released)),
					),
			),
		);
		const consumer = () =>
			prepareDesktopModule(layer, (runtime) => ({
				next: () =>
					runtime.runPromise(Effect.flatMap(Counter, (c) => c.increment)),
				close: runtime.dispose,
			}));
		const first = consumer(),
			second = consumer();
		const application = makeDesktopRuntime(
			Layer.merge(first.layer, second.layer),
		);
		first.bind(application);
		second.bind(application);
		expect(acquired).not.toHaveBeenCalled();
		try {
			await application.runtime();
			const a = first.start(),
				b = second.start();
			expect(acquired).toHaveBeenCalledOnce();
			expect(await a.next()).toBe(1);
			await a.close();
			expect(released).not.toHaveBeenCalled();
			expect(await b.next()).toBe(2);
			await b.close();
			let disposed = false;
			const shutdown = application.dispose().then(() => {
				disposed = true;
			});
			await Promise.resolve();
			expect(disposed).toBe(false);
			finishRelease();
			await shutdown;
			expect(released).toHaveBeenCalledOnce();
		} finally {
			finishRelease();
			await application.dispose();
		}
	});

	it("preserves all execution methods, cancellation and exact failure identity", async () => {
		const module = prepareDesktopModule(Layer.empty, (runtime) => runtime);
		const application = makeDesktopRuntime(module.layer);
		module.bind(application);
		const view = module.start();
		const failure = {
			_tag: "FixtureFailure",
			code: "FIXTURE.FAILURE",
		} as const;
		try {
			await application.runtime();
			expect(view.runSync(Effect.succeed(1))).toBe(1);
			expect(view.runSyncExit(Effect.succeed(2))).toEqual(Exit.succeed(2));
			expect(await view.runPromise(Effect.succeed(3))).toBe(3);
			expect(
				await Effect.runPromise(Fiber.join(view.runFork(Effect.succeed(4)))),
			).toBe(4);
			expect(
				await new Promise((resolve) =>
					view.runCallback(Effect.succeed(5), { onExit: resolve }),
				),
			).toEqual(Exit.succeed(5));
			const exit = await view.runPromiseExit(Effect.fail(failure));
			expect(
				Exit.isFailure(exit) &&
					Option.getOrUndefined(Cause.failureOption(exit.cause)),
			).toBe(failure);
			const cancellation = new AbortController();
			const interrupted = view.runPromiseExit(Effect.never, {
				signal: cancellation.signal,
			});
			cancellation.abort();
			const cancelled = await interrupted;
			expect(
				Exit.isFailure(cancelled) && Cause.isInterrupted(cancelled.cause),
			).toBe(true);
			await view.dispose();
			expect(await application.runPromise(Effect.succeed(6))).toBe(6);
		} finally {
			await application.dispose();
		}
	});

	it("retains standalone ownership and rejects invalid preparation order", async () => {
		const released = vi.fn();
		const layer = Layer.scopedDiscard(
			Effect.addFinalizer(() => Effect.sync(released)),
		);
		const standalone = prepareDesktopModule(layer, (runtime) => runtime);
		expect(() => standalone.start()).toThrow(TypeError);
		const owned = standalone.standalone();
		try {
			await owned.runPromise(Effect.void);
			expect(() => standalone.start()).toThrow(TypeError);
			expect(() => standalone.bind(owned)).toThrow(TypeError);
			expect(() => standalone.standalone()).toThrow(TypeError);
			await owned.dispose();
			await owned.dispose();
			expect(released).toHaveBeenCalledOnce();
		} finally {
			await owned.dispose();
		}
	});
});
