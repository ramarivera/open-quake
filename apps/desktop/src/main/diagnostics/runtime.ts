import { Layer, ManagedRuntime } from "effect";
import type { DesktopDiagnostics, DiagnosticOperation } from "./index.js";

/** Keep Effect's runtime identity and disposal semantics while observing every
 * interpreter boundary. The process owner supplies one shared diagnostics sink.
 */
export function makeDesktopRuntime<R, E>(
	layer: Layer.Layer<R, E>,
	diagnostics?: DesktopDiagnostics,
	operation: DiagnosticOperation = "app.background",
): ManagedRuntime.ManagedRuntime<R, E> {
	// Install diagnostics for service acquisition, then wrap the final tracer
	// after the application layer has had a chance to supply its own tracer.
	const runtime = ManagedRuntime.make(
		diagnostics
			? Layer.fresh(diagnostics.layer).pipe(
					Layer.provideMerge(layer.pipe(Layer.provideMerge(diagnostics.layer))),
				)
			: layer,
	);
	if (!diagnostics) return runtime;
	const runPromise: typeof runtime.runPromise = (effect, options) =>
		runtime.runPromise(diagnostics.instrument(effect, operation), options);
	const runPromiseExit: typeof runtime.runPromiseExit = (effect, options) =>
		runtime.runPromiseExit(diagnostics.instrument(effect, operation), options);
	const runFork: typeof runtime.runFork = (effect, options) =>
		runtime.runFork(diagnostics.instrument(effect, operation), options);
	const runSync: typeof runtime.runSync = (effect) =>
		runtime.runSync(diagnostics.instrument(effect, operation));
	const runSyncExit: typeof runtime.runSyncExit = (effect) =>
		runtime.runSyncExit(diagnostics.instrument(effect, operation));
	const runCallback: typeof runtime.runCallback = (effect, options) =>
		runtime.runCallback(diagnostics.instrument(effect, operation), options);
	const methods = {
		runPromise,
		runPromiseExit,
		runFork,
		runSync,
		runSyncExit,
		runCallback,
	};
	return new Proxy(runtime, {
		get: (target, key, receiver) =>
			Object.hasOwn(methods, key)
				? Reflect.get(methods, key)
				: Reflect.get(target, key, receiver),
	});
}
