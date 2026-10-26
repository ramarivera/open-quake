import { Context, Effect, Option } from "effect";
import { type AppUpdateSnapshot, newerVersion } from "./contracts.js";
import { AppUpdateFailed } from "./maintenance-errors.js";
export interface AppRelease {
	readonly app: "open-quake";
	readonly version: string;
	readonly platform: string;
	readonly arch: string;
	readonly sha256: string;
	readonly bytes: number;
	readonly artifact: string;
}
export class AppUpdatePort extends Context.Tag("AppUpdatePort")<
	AppUpdatePort,
	{
		readonly enabled: boolean;
		readonly currentVersion: string;
		readonly platform: string;
		readonly arch: string;
		check: () => Effect.Effect<Option.Option<AppRelease>, AppUpdateFailed>;
		download: (
			release: AppRelease,
			progress: (ratio: number) => void,
		) => Effect.Effect<void, AppUpdateFailed>;
		install: (release: AppRelease) => Effect.Effect<void, AppUpdateFailed>;
	}
>() {}
export const appUpdateTiming = { first: 5000, interval: 43200000 } as const;
export class AppUpdates extends Effect.Service<AppUpdates>()("AppUpdates", {
	scoped: Effect.gen(function* () {
		const port = yield* AppUpdatePort;
		const scope = yield* Effect.scope;
		let state: AppUpdateSnapshot = {
			state: port.enabled ? "idle" : "disabled",
			version: "",
			progress: 0,
			reason: "",
			prompt: false,
		};
		let release = Option.none<AppRelease>();
		let busy = false;
		const fail = (e: AppUpdateFailed) =>
			Effect.sync(() => {
				state = { ...state, state: "failed", reason: e.code, prompt: true };
			});
		const download = Effect.fn("AppUpdates.download")(
			function* (): Effect.fn.Return<void, AppUpdateFailed> {
				if (
					busy ||
					Option.isNone(release) ||
					!["available", "failed"].includes(state.state)
				)
					return;
				busy = true;
				const selected = release.value;
				yield* Effect.gen(function* () {
					state = {
						...state,
						state: "downloading",
						progress: 0,
						reason: "",
					};
					yield* port.download(selected, (progress) => {
						state = { ...state, progress: Math.max(0, Math.min(1, progress)) };
					});
					state = { ...state, state: "ready", progress: 1, prompt: true };
				}).pipe(
					Effect.ensuring(
						Effect.sync(() => {
							busy = false;
						}),
					),
					Effect.tapError(fail),
				);
			},
		);
		const check = Effect.fn("AppUpdates.check")(function* (
			background = false,
		): Effect.fn.Return<void, AppUpdateFailed> {
			if (!port.enabled || busy) return;
			if (state.state === "ready" || state.state === "available") {
				if (!background) state = { ...state, prompt: true };
				return;
			}
			busy = true;
			release = Option.none();
			yield* Effect.gen(function* () {
				state = {
					...state,
					state: "checking",
					prompt: !background,
					reason: "",
				};
				const found = yield* port.check();
				if (
					Option.isNone(found) ||
					!newerVersion(found.value.version, port.currentVersion)
				) {
					state = { ...state, state: "up_to_date" };
					return;
				}
				const next = found.value;
				if (
					next.app !== "open-quake" ||
					next.platform !== port.platform ||
					next.arch !== port.arch ||
					!/^[a-f0-9]{64}$/.test(next.sha256) ||
					!Number.isSafeInteger(next.bytes) ||
					next.bytes <= 0
				)
					return yield* new AppUpdateFailed();
				release = found;
				state = {
					...state,
					state: "available",
					version: next.version,
					prompt: !background,
				};
			}).pipe(
				Effect.ensuring(
					Effect.sync(() => {
						busy = false;
					}),
				),
				Effect.tapError(fail),
			);
			if (background && Option.isSome(release)) yield* download();
		});
		yield* Effect.gen(function* () {
			yield* Effect.sleep(appUpdateTiming.first);
			while (true) {
				yield* check(true).pipe(
					Effect.catchTag("AppUpdateFailed", () => Effect.void),
					Effect.forkScoped,
				);
				yield* Effect.sleep(appUpdateTiming.interval);
			}
		}).pipe(Effect.forkScoped);
		return {
			check,
			download,
			startDownload: Effect.fn("AppUpdates.startDownload")(function* () {
				yield* download().pipe(
					Effect.catchTag("AppUpdateFailed", () => Effect.void),
					Effect.forkIn(scope),
				);
				yield* Effect.yieldNow();
			}),
			snapshot: Effect.fn("AppUpdates.snapshot")(
				(): Effect.Effect<AppUpdateSnapshot> =>
					Effect.sync(() => ({ ...state })),
			),
			defer: Effect.fn("AppUpdates.defer")(
				(): Effect.Effect<void> =>
					Effect.sync(() => {
						state = { ...state, prompt: false };
					}),
			),
			install: Effect.fn("AppUpdates.install")(function* (): Effect.fn.Return<
				void,
				AppUpdateFailed
			> {
				if (busy || state.state !== "ready" || Option.isNone(release))
					return yield* new AppUpdateFailed();
				busy = true;
				state = { ...state, state: "installing" };
				yield* port.install(release.value).pipe(
					Effect.ensuring(
						Effect.sync(() => {
							busy = false;
						}),
					),
					Effect.tapError(fail),
				);
			}),
		};
	}),
}) {}
