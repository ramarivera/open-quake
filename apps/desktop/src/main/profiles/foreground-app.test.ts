import type { SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Option, TestClock, Tracer } from "effect";
import { afterEach, vi } from "vitest";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
	type Profile,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileForegroundFailed } from "../../../../../packages/device/src/profiles/profile-errors.js";
import { installProfileCatalog } from "../../../../../packages/device/src/profiles/profile-manager-invariants.js";
import { ProfileManager } from "../../../../../packages/device/src/profiles/profile-manager-service.js";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../packages/device/src/profiles/profile-repository.js";
import {
	ProfileSwitching,
	ProfileSwitchingPort,
} from "../../../../../packages/device/src/profiles/profile-switching-service.js";
import {
	makeForegroundProbe,
	makeScopedForegroundProbe,
} from "./foreground-app";

const native = vi.hoisted(() => ({
	spawn:
		vi.fn<
			(
				command: string,
				args: readonly string[],
				options: SpawnOptions,
			) => FakeProcess
		>(),
	execFile: vi.fn<() => void>(),
}));
vi.mock("node:child_process", () => native);
class FakeProcess extends EventEmitter {
	readonly stdin = new PassThrough();
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();
	readonly kill = vi.fn(() => {
		this.close();
		return true;
	});
	readonly requests: string[] = [];
	autoReply = true;
	app: { id: string; path: string } | undefined = {
		id: "10",
		path: "C:\\Editor\\editor.exe",
	};
	constructor() {
		super();
		this.stdin.on("data", (chunk: Buffer) => {
			const requestId = chunk.toString("utf8").trim();
			this.requests.push(requestId);
			if (this.autoReply) this.reply(requestId);
		});
	}
	reply(requestId = this.requests.at(-1)): void {
		this.stdout.write(
			`${JSON.stringify({ requestId, status: this.app ? "foreground" : "none", ...this.app })}\n`,
		);
	}
	close(): void {
		this.emit("exit", 0);
		this.emit("close", 0);
	}
}
afterEach(() => {
	vi.resetAllMocks();
	vi.useRealTimers();
});

describe("Windows foreground probe consumer", () => {
	it.effect(
		"uses the persistent helper by default, caches for 500 ms and refreshes owner identity",
		() =>
			Effect.gen(function* () {
				const child = new FakeProcess();
				native.spawn.mockReturnValue(child);
				yield* Effect.scoped(
					Effect.gen(function* () {
						const probe = yield* makeScopedForegroundProbe("win32");
						expect(yield* probe()).toEqual(Option.some(child.app));
						const changed = { id: "11", path: "C:\\第二\\other.exe" };
						child.app = changed;
						yield* TestClock.adjust(500);
						expect(yield* probe()).not.toEqual(Option.some(changed));
						expect(child.requests).toEqual(["1"]);
						yield* TestClock.adjust(1);
						expect(yield* probe()).toEqual(Option.some(changed));
						expect(child.requests).toEqual(["1", "2"]);
						expect(native.spawn).toHaveBeenCalledTimes(1);
						expect(native.execFile).not.toHaveBeenCalled();
						const call = native.spawn.mock.calls[0];
						if (!call) throw new Error("Missing child spawn");
						const [command, args, options] = call;
						expect(command).toBe("powershell.exe");
						expect(options).toMatchObject({
							windowsHide: true,
							stdio: ["pipe", "pipe", "pipe"],
						});
						const encoded = args.at(-1);
						if (!encoded) throw new Error("Missing PowerShell command");
						const script = Buffer.from(encoded, "base64").toString("utf16le");
						expect(script.indexOf("Add-Type")).toBeLessThan(
							script.indexOf("while ("),
						);
						expect(script.match(/Add-Type/g)).toHaveLength(1);
					}),
				);
				expect(child.kill).toHaveBeenCalledTimes(1);
				child.close();
			}),
	);

	it.effect(
		"shares overlapping consumers, including when one waiter is interrupted",
		() =>
			Effect.gen(function* () {
				const child = new FakeProcess();
				child.autoReply = false;
				native.spawn.mockReturnValue(child);
				yield* Effect.scoped(
					Effect.gen(function* () {
						const probe = yield* makeScopedForegroundProbe("win32");
						const first = yield* probe().pipe(Effect.fork);
						const second = yield* probe().pipe(Effect.fork);
						yield* TestClock.adjust(0);
						expect(child.requests).toEqual(["1"]);
						yield* Fiber.interrupt(first);
						child.reply();
						expect(yield* Fiber.join(second)).toEqual(Option.some(child.app));
					}),
				);
				expect(child.kill).toHaveBeenCalledTimes(1);
				child.close();
			}),
	);

	it.effect(
		"caches an absent foreground app and rejects a disposed probe even with a fresh cache",
		() =>
			Effect.gen(function* () {
				const child = new FakeProcess();
				child.app = undefined;
				native.spawn.mockReturnValue(child);
				const probe = makeForegroundProbe("win32");
				expect(yield* probe()).toEqual(Option.none());
				expect(yield* probe()).toEqual(Option.none());
				expect(child.requests).toHaveLength(1);
				yield* Effect.promise(() => probe.dispose());
				const result = yield* probe().pipe(Effect.either);
				expect(result._tag).toBe("Left");
				child.close();
			}),
	);

	it.effect(
		"preserves spawn causes privately through the real adapter and retries after recovery",
		() =>
			Effect.gen(function* () {
				const cause = Object.assign(
					new Error("token=secret C:\\private\\app.exe"),
					{ code: "ENOENT" },
				);
				native.spawn.mockImplementationOnce(() => {
					throw cause;
				});
				const child = new FakeProcess();
				native.spawn.mockReturnValue(child);
				yield* Effect.scoped(
					Effect.gen(function* () {
						const probe = yield* makeScopedForegroundProbe("win32");
						const result = yield* probe().pipe(Effect.either);
						expect(result._tag).toBe("Left");
						if (result._tag === "Left") {
							expect(result.left).toBeInstanceOf(ProfileForegroundFailed);
							expect(result.left.code).toBe("QUAKE.PROFILE.FOREGROUND_FAILED");
							expect(result.left.originalCause).toBe(cause);
							expect(result.left.diagnosticCause.sourceCode).toBe("ENOENT");
							expect(JSON.stringify(result.left)).not.toMatch(/secret|private/);
						}
						expect(yield* probe()).toEqual(Option.some(child.app));
					}),
				);
				child.close();
			}),
	);

	it.effect(
		"closes in-flight helpers on scope interruption and never revives disposed probes",
		() =>
			Effect.gen(function* () {
				const child = new FakeProcess();
				child.autoReply = false;
				native.spawn.mockReturnValue(child);
				const work = yield* Effect.scoped(
					Effect.gen(function* () {
						const probe = yield* makeScopedForegroundProbe("win32");
						yield* probe();
					}),
				).pipe(Effect.fork);
				yield* TestClock.adjust(0);
				expect(child.requests).toHaveLength(1);
				yield* Fiber.interrupt(work);
				expect(child.kill).toHaveBeenCalledTimes(1);
				child.close();
			}),
	);

	it.each([
		"deadline",
		"malformed",
		"mismatched",
		"overflow",
		"crash",
	] as const)(
		"exposes a typed, private %s failure through the default Windows adapter and recovers",
		async (failure) => {
			vi.useFakeTimers();
			const child = new FakeProcess();
			child.autoReply = false;
			const replacement = new FakeProcess();
			native.spawn.mockReturnValueOnce(child).mockReturnValue(replacement);
			const probe = makeForegroundProbe("win32");
			try {
				const pending = Effect.runPromise(probe().pipe(Effect.either));
				expect(child.requests).toEqual(["1"]);
				if (failure === "deadline") await vi.advanceTimersByTimeAsync(5000);
				else if (failure === "malformed")
					child.stdout.write("token=secret C:\\private\n");
				else if (failure === "mismatched") child.reply("unrelated");
				else if (failure === "overflow")
					child.stdout.write(Buffer.alloc(65537, 120));
				else child.emit("exit", 1);
				const result = await pending;
				expect(result._tag).toBe("Left");
				if (result._tag === "Left") {
					expect(result.left).toBeInstanceOf(ProfileForegroundFailed);
					expect(result.left.code).toBe("QUAKE.PROFILE.FOREGROUND_FAILED");
					expect(result.left.originalCause).toBeInstanceOf(Error);
					expect(JSON.stringify(result.left)).not.toMatch(
						/secret|private|editor/,
					);
				}
				child.close();
				expect(await Effect.runPromise(probe())).toEqual(
					Option.some(replacement.app),
				);
				expect(native.spawn).toHaveBeenCalledTimes(2);
				expect(native.execFile).not.toHaveBeenCalled();
			} finally {
				await probe.dispose();
				child.close();
				replacement.close();
			}
		},
	);

	it.effect(
		"retains a privacy-safe named span for lookup failures and never caches failed replies",
		() =>
			Effect.gen(function* () {
				const child = new FakeProcess();
				child.autoReply = false;
				native.spawn.mockReturnValue(child);
				const tracer = yield* Effect.tracer;
				const spans: Tracer.Span[] = [];
				const recording = Tracer.make({
					span: (...args) => {
						const span = tracer.span(...args);
						spans.push(span);
						return span;
					},
					context: (run, fiber) => tracer.context(run, fiber),
				});
				yield* Effect.scoped(
					Effect.gen(function* () {
						const probe = yield* makeScopedForegroundProbe("win32");
						const failed = yield* probe().pipe(Effect.either, Effect.fork);
						yield* TestClock.adjust(0);
						child.stdout.write(
							`${JSON.stringify({ requestId: "1", status: "error" })}\n`,
						);
						const failure = yield* Fiber.join(failed);
						expect(failure._tag).toBe("Left");
						if (failure._tag === "Left") {
							expect(failure.left.code).toBe("QUAKE.PROFILE.FOREGROUND_FAILED");
							expect(JSON.stringify(failure.left)).not.toContain(
								child.app?.path,
							);
						}
						child.autoReply = true;
						expect(yield* probe()).toEqual(Option.some(child.app));
						const probes = spans.filter(
							(span) => span.name === "ForegroundApp.probe",
						);
						expect(probes).toHaveLength(2);
						expect(probes[0]?.status._tag).toBe("Ended");
						expect(
							Object.fromEntries(probes[0]?.attributes ?? []),
						).toMatchObject({ platform: "win32", cacheHit: false });
						for (const span of spans)
							expect(
								JSON.stringify(Object.fromEntries(span.attributes)),
							).not.toMatch(/editor.exe|C:\\/);
						expect(child.requests).toEqual(["1", "2"]);
					}),
				).pipe(Effect.withTracer(recording));
			}),
	);

	it.effect(
		"drives real linked-profile delivery from Windows identities and keeps the selection on no match",
		() => {
			const child = new FakeProcess();
			native.spawn.mockReturnValue(child);
			const pushes: string[] = [];
			let stored: unknown = encodeProfileEnvelope(
				installProfileCatalog(createInitialProfileEnvelope(), "win32"),
			);
			const services = Layer.mergeAll(
				ProfileManager.DefaultWithoutDependencies,
				ProfileSwitching.DefaultWithoutDependencies,
			).pipe(
				Layer.provideMerge(
					ProfileRepository.Default.pipe(
						Layer.provide(
							profileStorageLayer({
								read: async () => stored,
								write: async (value) => {
									stored = value;
								},
							}),
						),
					),
				),
				Layer.provide(
					Layer.scoped(
						ProfileSwitchingPort,
						Effect.gen(function* () {
							const foreground = yield* makeScopedForegroundProbe("win32");
							return {
								platform: "win32" as const,
								foreground,
								push: (serial: string, profile: Profile) =>
									Effect.sync(() => {
										pushes.push(`${serial}:${profile.id}`);
									}),
							};
						}),
					),
				),
			);
			return Effect.gen(function* () {
				yield* Effect.scoped(
					Effect.gen(function* () {
						const switching = yield* ProfileSwitching;
						const manager = yield* ProfileManager;
						yield* switching.connect("test-device");
						pushes.length = 0;
						yield* manager.command({
							type: "link",
							id: "1-1",
							link: {
								profileId: "1-1",
								appPath: "C:\\Editor\\editor.exe",
								appIdentifier: "editor",
							},
						});
						const probe = yield* switching.probe().pipe(Effect.fork);
						yield* TestClock.adjust(300);
						yield* Fiber.join(probe);
						expect(pushes).toEqual(["test-device:1-1"]);
						yield* TestClock.adjust(501);
						child.app = { id: "20", path: "D:\\Unrelated\\else.exe" };
						yield* switching.probe();
						expect(pushes).toEqual(["test-device:1-1"]);
						expect(child.requests).toEqual(["1", "2"]);
						expect(native.spawn).toHaveBeenCalledTimes(1);
						expect(native.execFile).not.toHaveBeenCalled();
					}).pipe(Effect.provide(services)),
				);
				expect(child.kill).toHaveBeenCalledTimes(1);
				child.close();
			});
		},
	);
});

it.effect(
	"MAIN-084 denies native foreground reads until fake Accessibility permission is granted",
	() =>
		Effect.gen(function* () {
			let trusted = false,
				denied = 0,
				reads = 0;
			const probe = yield* makeScopedForegroundProbe(
				"darwin",
				async () => {
					reads++;
					return Option.some({ id: "fake", path: "/Applications/Fake.app" });
				},
				{
					trusted: () => trusted,
					denied: () => {
						denied++;
					},
				},
			);
			expect((yield* probe().pipe(Effect.either))._tag).toBe("Left");
			expect((yield* probe().pipe(Effect.either))._tag).toBe("Left");
			expect(reads).toBe(0);
			expect(denied).toBe(1);
			trusted = true;
			expect(yield* probe()).toEqual(
				Option.some({ id: "fake", path: "/Applications/Fake.app" }),
			);
			expect(reads).toBe(1);
			trusted = false;
			expect((yield* probe().pipe(Effect.either))._tag).toBe("Left");
			expect(denied).toBe(2);
		}).pipe(Effect.scoped),
);
