import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { Deferred, Effect, Either, Fiber, Logger, Schema } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const native = vi.hoisted(() => ({
	root: "",
	failLoad: false,
	cleanupFailure: undefined as Error | undefined,
	removals: [] as unknown[],
	windows: [] as { destroyed: boolean; url: string; options: unknown }[],
	permission: (() => true) as (...args: unknown[]) => unknown,
	request: (() => {}) as (...args: unknown[]) => unknown,
	network: (() => {}) as (...args: unknown[]) => unknown,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...actual,
		rm: (...args: Parameters<typeof actual.rm>) => {
			native.removals.push(args[1]);
			return native.cleanupFailure
				? Promise.reject(native.cleanupFailure)
				: actual.rm(...args);
		},
	};
});
vi.mock("electron", () => ({
	app: { getPath: () => native.root },
	session: {
		fromPartition: () => ({
			setPermissionRequestHandler: (handler: typeof native.request) => {
				native.request = handler;
			},
			setPermissionCheckHandler: (handler: typeof native.permission) => {
				native.permission = handler;
			},
			webRequest: {
				onBeforeRequest: (handler: typeof native.network) => {
					native.network = handler;
				},
			},
			on: () => {},
		}),
	},
	BrowserWindow: class {
		state: (typeof native.windows)[number];
		constructor(options: unknown) {
			this.state = { destroyed: false, url: "", options };
			native.windows.push(this.state);
		}
		webContents = {
			setWindowOpenHandler: () => {},
			on: () => {},
			executeJavaScript: async () => undefined,
		};
		isDestroyed() {
			return this.state.destroyed;
		}
		destroy() {
			this.state.destroyed = true;
		}
		async loadURL(url: string) {
			this.state.url = url;
			if (native.failLoad) throw new Error("native load failed");
		}
	},
}));

import { SoundboardDecodeFailed } from "../../../../../packages/edge/src/soundboard/soundboard-errors.js";
import {
	createSoundboardPlayer,
	openSoundboardWorker,
	type SoundboardWorker,
} from "./player";

const entry = {
	fileId: "a",
	path: "/private/music/a.mp3",
	status: "available" as const,
};
beforeEach(async () => {
	native.root = await mkdtemp(join(tmpdir(), "oq-sound-player-"));
	native.windows.length = 0;
	native.failLoad = false;
	native.cleanupFailure = undefined;
	native.removals.length = 0;
});
afterEach(async () => {
	native.cleanupFailure = undefined;
	await rm(native.root, { recursive: true, force: true });
});

describe("native MP3 boundary", () => {
	test("denies every permission and all but its page and exact configured file", async () => {
		const controller = new AbortController();
		const file = "file:///private/music/a.mp3";
		const worker = await openSoundboardWorker(file, controller.signal);
		const state = native.windows[0];
		if (!state) throw new Error("missing window");
		expect(state.options).toMatchObject({
			show: false,
			focusable: false,
			webPreferences: {
				sandbox: true,
				contextIsolation: true,
				nodeIntegration: false,
			},
		});
		expect(native.permission()).toBe(false);
		let granted = true;
		native.request({}, "media", (value: boolean) => {
			granted = value;
		});
		expect(granted).toBe(false);
		const allowed = (url: string) => {
			let result: unknown;
			native.network({ url }, (value: unknown) => {
				result = value;
			});
			return result;
		};
		expect(allowed(file)).toEqual({ cancel: false });
		expect(allowed(state.url)).toEqual({ cancel: false });
		for (const url of [
			"https://example.invalid",
			"file:///private/music/b.mp3",
			`${file}?other`,
		])
			expect(allowed(url)).toEqual({ cancel: true });
		controller.abort();
		await worker.close();
		await worker.close();
		expect(state.destroyed).toBe(true);
		expect(await readdir(native.root)).toEqual([]);
		await expect(worker.invoke("play")).rejects.toBeInstanceOf(
			SoundboardDecodeFailed,
		);
	});
	test("keeps stopped audio and the original acquisition failure independent of residual file cleanup", async () => {
		const controller = new AbortController();
		const report = vi.fn();
		const worker = await openSoundboardWorker(
			"file:///local.mp3",
			controller.signal,
			report,
		);
		native.cleanupFailure = Object.assign(new Error("private cleanup failed"), {
			code: "EPERM",
		});
		await expect(worker.close()).resolves.toBeUndefined();
		await expect(worker.close()).resolves.toBeUndefined();
		expect(report).toHaveBeenCalledExactlyOnceWith(native.cleanupFailure);
		expect(native.windows[0]?.destroyed).toBe(true);
		expect(native.removals).toEqual([
			{ recursive: true, force: true, maxRetries: 3, retryDelay: 50 },
		]);
		native.failLoad = true;
		await expect(
			openSoundboardWorker(
				"file:///local.mp3",
				new AbortController().signal,
				report,
			),
		).rejects.toThrow("native load failed");
		expect(report).toHaveBeenCalledTimes(2);
		expect(native.windows[1]?.destroyed).toBe(true);
	});
	it.effect(
		"reports residual cleanup through the owning runtime with a scrubbed cause",
		() => {
			const messages: unknown[] = [];
			return Effect.gen(function* () {
				yield* createSoundboardPlayer().open(entry);
				native.cleanupFailure = Object.assign(
					new Error("/private/music/secret.mp3 Bearer secret"),
					{ code: "EPERM" },
				);
			}).pipe(
				Effect.scoped,
				Effect.provide(
					Logger.replace(
						Logger.defaultLogger,
						Logger.make(({ message }) => messages.push(message)),
					),
				),
				Effect.tap(() =>
					Effect.sync(() => {
						expect(native.windows[0]?.destroyed).toBe(true);
						const raw = JSON.stringify(messages);
						expect(raw).toContain("soundboard.worker.cleanup.failed");
						expect(raw).toContain("QUAKE.AUDIO.DECODE_FAILED");
						expect(raw).toContain("EPERM");
						expect(raw).not.toMatch(/private|music|secret|Bearer/);
					}),
				),
			);
		},
	);
	test("cleans failed and already-aborted acquisition", async () => {
		native.failLoad = true;
		await expect(
			openSoundboardWorker("file:///local.mp3", new AbortController().signal),
		).rejects.toThrow();
		expect(native.windows[0]?.destroyed).toBe(true);
		expect(await readdir(native.root)).toEqual([]);
		const controller = new AbortController();
		controller.abort();
		await expect(
			openSoundboardWorker("file:///local.mp3", controller.signal),
		).rejects.toBeInstanceOf(SoundboardDecodeFailed);
		expect(native.windows).toHaveLength(1);
		expect(await readdir(native.root)).toEqual([]);
	});
	it.scoped(
		"interrupts pending acquisition and closes the resource if native creation returns late",
		() =>
			Effect.gen(function* () {
				const entered = yield* Deferred.make<void>();
				let finish: (value: SoundboardWorker) => void = () => {};
				let aborted = false;
				let closed = 0;
				const backend = createSoundboardPlayer((_url, signal) => {
					signal.addEventListener("abort", () => {
						aborted = true;
					});
					return new Promise((resolve) => {
						finish = resolve;
						Effect.runSync(Deferred.succeed(entered, undefined));
					});
				});
				const pending = yield* backend
					.open(entry)
					.pipe(Effect.scoped, Effect.fork);
				yield* Deferred.await(entered);
				yield* Fiber.interrupt(pending);
				expect(aborted).toBe(true);
				finish({
					invoke: async () => undefined,
					close: async () => {
						closed++;
					},
				});
				yield* Effect.promise(
					() => new Promise<void>((resolve) => setImmediate(resolve)),
				);
				expect(closed).toBe(1);
			}),
	);
	it.scoped(
		"retains the native error and rejects invalid positions and gains before native use",
		() =>
			Effect.gen(function* () {
				const original = Object.assign(
					new Error("/private/music/a.mp3 token=secret"),
					{ code: "EACCES" },
				);
				let calls = 0;
				const backend = createSoundboardPlayer(async () => ({
					invoke: async (method) => {
						calls++;
						if (method === "play") throw original;
						return -1;
					},
					close: async () => {},
				}));
				const player = yield* backend.open(entry);
				const failed = yield* player.play.pipe(Effect.either);
				expect(failed).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.DECODE_FAILED" },
				});
				if (Either.isLeft(failed)) {
					expect(failed.left.originalCause).toBe(original);
					expect(JSON.stringify(failed.left)).not.toMatch(
						/private|music|secret/,
					);
					expect(
						Schema.decodeUnknownSync(SoundboardDecodeFailed)(
							JSON.parse(JSON.stringify(failed.left)),
						).code,
					).toBe(failed.left.code);
				}
				expect(yield* player.position.pipe(Effect.either)).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.DECODE_FAILED" },
				});
				const before = calls;
				for (const gain of [NaN, Infinity, -0.1, 1.1])
					expect(yield* player.gain(gain).pipe(Effect.either)).toMatchObject({
						_tag: "Left",
					});
				expect(calls).toBe(before);
				expect(
					yield* backend
						.open({ ...entry, path: "https://example.invalid/a.mp3" })
						.pipe(Effect.either),
				).toMatchObject({ _tag: "Left" });
			}),
	);
});
