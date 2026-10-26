import { Effect, Layer, Option } from "effect";
import { MonitorForeground } from "../../../../../packages/edge/src/monitor/monitoring-service";
import {
	MonitorCollectionFailed,
	MonitorPermissionDenied,
} from "../../shared/monitor-errors";
import {
	type ForegroundProbe,
	makeForegroundProbe,
	type nativeForegroundApp,
} from "../profiles/foreground-app";

/** Reuses the bounded, coalesced native probe. Mock windows never inspect the user's apps. */
export const monitorForegroundLive = (
	platform: NodeJS.Platform = process.platform,
	mock = process.env.OPEN_QUAKE_MOCK_DEVICE === "1",
	native?: typeof nativeForegroundApp,
) =>
	Layer.scoped(
		MonitorForeground,
		Effect.gen(function* () {
			let probe: ForegroundProbe | undefined;
			const stop = Effect.fn("MonitorForeground.stop")(() =>
				Effect.gen(function* () {
					const current = probe;
					probe = undefined;
					if (current)
						yield* Effect.tryPromise({
							try: () => current.dispose(),
							catch: (cause) => new MonitorCollectionFailed(cause),
						});
				}),
			);
			yield* Effect.addFinalizer(() =>
				stop().pipe(
					Effect.catchTag("MonitorCollectionFailed", (error) =>
						Effect.logWarning("Foreground monitoring cleanup failed", error),
					),
				),
			);
			return {
				stop,
				pollMillis: platform === "darwin" ? 3000 : 2000,
				query: Effect.fn("MonitorForeground.query")(() =>
					Effect.suspend(() => {
						if (mock) return Effect.succeed(Option.none());
						probe ??= makeForegroundProbe(
							platform === "darwin" || platform === "win32"
								? platform
								: "linux",
							native,
						);
						return probe().pipe(
							Effect.mapError((error) => {
								const cause = error.originalCause;
								return cause instanceof Error &&
									"code" in cause &&
									(cause.code === "EPERM" || cause.code === "EACCES")
									? new MonitorPermissionDenied(error)
									: new MonitorCollectionFailed(error);
							}),
						);
					}),
				),
			};
		}),
	);
