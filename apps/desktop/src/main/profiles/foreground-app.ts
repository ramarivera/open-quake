import { execFile } from "node:child_process";
import { readlink } from "node:fs/promises";
import { promisify } from "node:util";
import { Clock, Effect, Option, Schema, type Scope } from "effect";
import { ProfileForegroundFailed } from "../../../../../packages/device/src/profiles/profile-errors.js";
import type { ProfilePlatform } from "../../../../../packages/device/src/profiles/profile-manager-contracts.js";
import type { ForegroundApp } from "../../../../../packages/device/src/profiles/profile-switching-invariants.js";

import { makeWindowsForeground } from "./windows-foreground";

const run = promisify(execFile);
export const nativeForegroundApp = async (
	platform: ProfilePlatform,
	signal?: AbortSignal,
): Promise<Option.Option<ForegroundApp>> => {
	const options = {
		timeout: 5000,
		signal: signal
			? AbortSignal.any([signal, AbortSignal.timeout(5000)])
			: AbortSignal.timeout(5000),
		maxBuffer: 64 * 1024,
		windowsHide: true,
	};
	if (platform === "darwin") {
		const script = `ObjC.import('AppKit'); ObjC.import('CoreGraphics');
   const app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
   const pid = Number(app.processIdentifier);
   const windows = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1, 0)));
   const win = windows.find(w => w.kCGWindowOwnerPID === pid && w.kCGWindowLayer === 0);
   JSON.stringify({id:String(win ? win.kCGWindowNumber : pid),path:ObjC.unwrap(app.bundleURL.path)});`;
		const { stdout } = await run(
			"/usr/bin/osascript",
			["-l", "JavaScript", "-e", script],
			options,
		);
		return Option.some(
			Schema.decodeUnknownSync(
				Schema.Struct({ id: Schema.String, path: Schema.String }),
			)(JSON.parse(stdout)),
		);
	}

	if (platform === "win32") {
		const helper = makeWindowsForeground();
		try {
			return await helper.probe();
		} finally {
			await helper.dispose();
		}
	}
	const active = await run("xprop", ["-root", "_NET_ACTIVE_WINDOW"], options);
	const id = /0x[\da-f]+/i.exec(active.stdout)?.[0];
	if (!id || id === "0x0") return Option.none();
	const owner = await run("xprop", ["-id", id, "_NET_WM_PID"], options);
	const pid = /=\s*(\d+)/.exec(owner.stdout)?.[1];
	return pid
		? Option.some({ id, path: await readlink(`/proc/${pid}/exe`) })
		: Option.none();
};
export interface ForegroundProbe {
	(): Effect.Effect<Option.Option<ForegroundApp>, ProfileForegroundFailed>;
	readonly dispose: () => Promise<void>;
}

/** A single in-flight probe and clock-based 500 ms cache shared by all consumers.
 * Owners must dispose this probe, or acquire makeScopedForegroundProbe instead.
 */
export const makeForegroundProbe = (
	platform: ProfilePlatform,
	native?: typeof nativeForegroundApp,
): ForegroundProbe => {
	const helper =
		platform === "win32" && !native ? makeWindowsForeground() : undefined;
	const read = native ?? (helper ? () => helper.probe() : nativeForegroundApp);
	let disposed = false;
	let disposal: Promise<void> | undefined;
	let cached: Option.Option<ForegroundApp> = Option.none();
	let at = Number.NEGATIVE_INFINITY;
	let pending: Promise<Option.Option<ForegroundApp>> | undefined;
	const abort = new AbortController();
	const probe = Effect.fn("ForegroundApp.probe")(function* (): Effect.fn.Return<
		Option.Option<ForegroundApp>,
		ProfileForegroundFailed
	> {
		if (disposed)
			return yield* ProfileForegroundFailed.fromCause(
				new Error("Foreground probe disposed"),
			);
		const now = yield* Clock.currentTimeMillis;
		const cacheHit = now - at <= 500;
		yield* Effect.annotateCurrentSpan({ platform, cacheHit });
		if (cacheHit) return cached;
		const result = yield* Effect.tryPromise({
			try: () => {
				if (!pending)
					pending = read(platform, abort.signal).finally(() => {
						pending = undefined;
					});
				return pending;
			},
			catch: ProfileForegroundFailed.fromCause,
		});
		if (disposed)
			return yield* ProfileForegroundFailed.fromCause(
				new Error("Foreground probe disposed"),
			);
		cached = result;
		at = yield* Clock.currentTimeMillis;
		return result;
	});
	return Object.assign(probe, {
		dispose: (): Promise<void> => {
			if (disposal) return disposal;
			disposed = true;
			abort.abort();
			cached = Option.none();
			disposal = Promise.all([
				helper?.dispose(),
				pending?.catch(() => undefined),
			])
				.then(() => undefined)
				.catch((cause) => {
					throw ProfileForegroundFailed.fromCause(cause);
				});
			return disposal;
		},
	});
};

export const makeScopedForegroundProbe = Effect.fn("ForegroundApp.acquire")(
	(
		platform: ProfilePlatform,
		native?: typeof nativeForegroundApp,
	): Effect.Effect<ForegroundProbe, never, Scope.Scope> =>
		Effect.acquireRelease(
			Effect.sync(() => makeForegroundProbe(platform, native)),
			(probe) =>
				Effect.promise(() => probe.dispose()).pipe(
					Effect.withSpan("ForegroundApp.dispose"),
				),
		),
);
