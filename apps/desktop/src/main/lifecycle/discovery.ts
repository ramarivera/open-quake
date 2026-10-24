import { Deferred, Effect, Option, Queue, type Scope } from "effect";
import type { Display } from "electron";
import type { DeviceBus } from "../deviceBus";
import { isPanelCandidate, physicalSize } from "../display";

export interface DiscoveryEdges {
	readonly displays: () => readonly Display[];
	readonly watch: (changed: () => void) => () => void;
	readonly bus: () => DeviceBus | undefined;
}
export interface DiscoveryResult {
	readonly display: Option.Option<Display>;
	readonly issue: "none" | "unavailable" | "timeout" | "power-failed";
}
const unresolved = (issue: DiscoveryResult["issue"]): DiscoveryResult => ({
	display: Option.none(),
	issue,
});

/** The observation subscription exists before the off write, including synchronous edges. */
export const makeDiscovery = Effect.fn("StripDiscovery.make")(function* (
	edges: DiscoveryEdges,
): Effect.fn.Return<
	{
		run: () => Effect.Effect<DiscoveryResult>;
	},
	never,
	Scope.Scope
> {
	let pending: Deferred.Deferred<DiscoveryResult> | undefined;
	const transaction = Effect.scoped(
		Effect.gen(function* () {
			const power = edges.bus()?.setScreenPower;
			if (!power) return unresolved("unavailable");
			const snapshots = yield* Queue.unbounded<readonly Display[]>();
			const before = edges.displays().filter(isPanelCandidate);
			if (before.length === 0) return unresolved("unavailable");
			// This firmware can blank its pixels while retaining the HDMI EDID.
			// An exact name and size identify a sole candidate without that edge.
			const identified = before.length === 1 ? before[0] : undefined;
			const size = identified ? physicalSize(identified) : undefined;
			if (
				identified &&
				identified.label.trim().toUpperCase() === "DK-QUAKE" &&
				size &&
				((size.width === 1920 && size.height === 480) ||
					(size.width === 480 && size.height === 1920))
			)
				return {
					display: Option.some(identified),
					issue: "none",
				} satisfies DiscoveryResult;

			yield* Effect.acquireRelease(
				Effect.sync(() =>
					edges.watch(() => Queue.unsafeOffer(snapshots, edges.displays())),
				),
				(off) => Effect.sync(off),
			);
			let restored = false;
			const restore = power(true).pipe(
				Effect.tap((ok) =>
					Effect.sync(() => {
						restored = ok;
					}),
				),
			);
			const pairing = Effect.gen(function* () {
				if (!(yield* power(false))) return unresolved("unavailable");
				Queue.unsafeOffer(snapshots, edges.displays());
				let removed: Display | undefined;
				while (!removed) {
					const current = yield* Queue.take(snapshots);
					const missing = before.filter(
						(display) => !current.some((d) => d.id === display.id),
					);
					if (missing.length === 1) removed = missing[0];
				}
				if (!(yield* restore)) return unresolved("unavailable");
				Queue.unsafeOffer(snapshots, edges.displays());
				while (true) {
					const current = yield* Queue.take(snapshots);
					const same = current.find(
						(d) => d.id === removed.id && isPanelCandidate(d),
					);
					const added = current.filter(
						(d) =>
							isPanelCandidate(d) && !before.some((old) => old.id === d.id),
					);
					const match = same ?? (added.length === 1 ? added[0] : undefined);
					if (match)
						return {
							display: Option.some(match),
							issue: "none",
						} satisfies DiscoveryResult;
				}
			});
			return yield* pairing.pipe(
				Effect.timeoutOption(30_000),
				Effect.map(Option.getOrElse(() => unresolved("timeout"))),
				Effect.ensuring(
					Effect.suspend(() => (restored ? Effect.void : restore)).pipe(
						Effect.ignore,
					),
				),
				Effect.match({
					onFailure: () => unresolved("power-failed"),
					onSuccess: (result) => result,
				}),
			);
		}),
	);
	const run = Effect.fn("StripDiscovery.run")(
		(): Effect.Effect<DiscoveryResult> =>
			Effect.uninterruptibleMask((restore) =>
				Effect.gen(function* () {
					if (pending) return yield* restore(Deferred.await(pending));
					const result = yield* Deferred.make<DiscoveryResult>();
					pending = result;
					const exit = yield* Effect.exit(restore(transaction));
					pending = undefined;
					yield* Deferred.done(result, exit);
					return yield* exit;
				}),
			),
	);
	// Lifetime is supplied by the owning device scope, never a detached runtime.
	yield* Effect.addFinalizer(() =>
		pending ? Deferred.interrupt(pending).pipe(Effect.asVoid) : Effect.void,
	);
	return { run };
});
