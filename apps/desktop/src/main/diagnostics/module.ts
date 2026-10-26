import type { Effect, Layer, ManagedRuntime } from "effect";
import type { DesktopDiagnostics, DiagnosticOperation } from "./index.js";
import { makeDesktopRuntime } from "./runtime.js";

/** An execution view has no Effect layer or independently owned service scope. */
export type DesktopRuntime<R, E = never> = Pick<
	ManagedRuntime.ManagedRuntime<R, E>,
	| "runPromise"
	| "runPromiseExit"
	| "runFork"
	| "runSync"
	| "runSyncExit"
	| "runCallback"
	| "dispose"
>;

/** Prepare layers first, bind every view, acquire the graph, then start consumers.
 * Standalone owners are for isolated module consumers and tests. The application
 * supplies one owner to every module; module disposal cannot close that owner.
 */
export function prepareDesktopModule<R, E, A>(
	layer: Layer.Layer<R, E>,
	register: (runtime: DesktopRuntime<R, E>) => A,
	diagnostics?: DesktopDiagnostics,
	operation: DiagnosticOperation = "app.background",
) {
	let owner: DesktopRuntime<R, E> | undefined;
	let owned = false;
	let started = false;
	const interpreter = (): DesktopRuntime<R, E> => {
		if (!owner) throw new TypeError("Desktop module has no application owner");
		return owner;
	};
	const observe = <V, F, Requirements>(
		effect: Effect.Effect<V, F, Requirements>,
	) =>
		diagnostics && !owned ? diagnostics.instrument(effect, operation) : effect;
	const runtime: DesktopRuntime<R, E> = {
		runPromise: (effect, options) =>
			interpreter().runPromise(observe(effect), options),
		runPromiseExit: (effect, options) =>
			interpreter().runPromiseExit(observe(effect), options),
		runFork: (effect, options) =>
			interpreter().runFork(observe(effect), options),
		runSync: (effect) => interpreter().runSync(observe(effect)),
		runSyncExit: (effect) => interpreter().runSyncExit(observe(effect)),
		runCallback: (effect, options) =>
			interpreter().runCallback(observe(effect), options),
		dispose: () => (owned ? interpreter().dispose() : Promise.resolve()),
	};
	const bind = (application: DesktopRuntime<R, E>): void => {
		if (owner) throw new TypeError("Desktop module is already bound");
		owner = application;
	};
	const start = (): A => {
		interpreter();
		if (started) throw new TypeError("Desktop module is already started");
		started = true;
		return register(runtime);
	};
	return {
		layer,
		runtime,
		bind,
		start,
		standalone: (): A => {
			if (owner) throw new TypeError("Desktop module is already bound");
			bind(makeDesktopRuntime(layer, diagnostics, operation));
			owned = true;
			return start();
		},
	};
}
