import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	Cause,
	Deferred,
	Effect,
	Either,
	Layer,
	ManagedRuntime,
	Option,
	Schema,
} from "effect";
import { ipcMain, powerMonitor } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import { HostActionFailed } from "../../../../../packages/device/src/actions/action-errors";
import {
	KeyRuntime,
	KeyRuntimePort,
} from "../../../../../packages/device/src/actions/key-runtime-service";
import { QuakeHidWriteFailed } from "../../../../../packages/device/src/device-errors";
import { QuakeDevice } from "../../../../../packages/device/src/device-service";
import { defaultHardwarePreferences } from "../../../../../packages/device/src/hardware/hardware-contracts";
import {
	HardwarePreferencesFailed,
	HardwareUnavailable,
} from "../../../../../packages/device/src/hardware/hardware-errors";
import { makeFakeHardwareTransport } from "../../../../../packages/device/src/hardware/hardware-fake";
import { HardwarePreferencesStore } from "../../../../../packages/device/src/hardware/hardware-repository";
import { HardwareControls } from "../../../../../packages/device/src/hardware/hardware-service";
import {
	createEmptyProfileKey,
	ProfileEnvelope,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import { createDesktopDiagnostics } from "../diagnostics";
import { hardwareRequest } from "./controller";
import { registerHardware } from "./index";
import { qmkRequest } from "./qmk-controller";

vi.mock("electron", () => ({
	ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
	powerMonitor: new EventEmitter(),
}));
vi.mock("./host-keyboard", () => ({ hostKeyboardAvailable: () => false }));

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
	for (const close of cleanups.splice(0).reverse()) await close();
});
async function capture() {
	const root =
		process.env.OPEN_QUAKE_TEST_SCRATCH ??
		join(homedir(), "dev/agentic-scratchpads/open-quake/diagnostics-tests");
	await mkdir(root, { recursive: true });
	const directory = await mkdtemp(join(root, "hardware-"));
	cleanups.push(() => rm(directory, { recursive: true, force: true }));
	const diagnostics = createDesktopDiagnostics({ directory });
	cleanups.push(diagnostics.close);
	const runtime = ManagedRuntime.make(diagnostics.layer);
	cleanups.push(() => runtime.dispose());
	return { diagnostics, runtime, directory };
}
async function retained(directory: string) {
	const raw = (
		await Promise.all(
			(
				await readdir(directory)
			)
				.filter((file) => file.endsWith(".ndjson"))
				.map((file) => readFile(join(directory, file), "utf8")),
		)
	).join("\n");
	expect(raw).not.toMatch(
		/private-sentinel|Bearer|secret-sentinel|serial-sentinel|session-sentinel|profile-sentinel|page-sentinel/,
	);
	expect(raw).not.toContain('"span_name":"redacted.span"');
	return raw
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}
function correlated(
	child: Record<string, unknown> | undefined,
	parent: Record<string, unknown> | undefined,
) {
	expect(parent?.trace_id).toMatch(/^[0-9a-f]{32}$/);
	expect(parent?.span_id).toMatch(/^[0-9a-f]{16}$/);
	expect(parent?.request_id).toEqual(expect.any(String));
	expect(child).toMatchObject({
		trace_id: parent?.trace_id,
		request_id: parent?.request_id,
		parent_span_id: parent?.span_id,
	});
}

it.each(["toggleMic", "qmk", "lighting", "lock"] as const)(
	"retains the actual hardware IPC %s write failure before response recovery",
	async (operation) => {
		const { diagnostics, runtime, directory } = await capture();
		const original = Object.assign(
			new Error("/private-sentinel Bearer secret-sentinel"),
			{ code: "EACCES" },
		);
		let observed: HardwareUnavailable | undefined;
		const response = await runtime.runPromise(
			diagnostics.instrument(
				Effect.scoped(
					Effect.gen(function* () {
						const fake = yield* makeFakeHardwareTransport({
							serial: "serial-sentinel",
						});
						const device = yield* QuakeDevice.pipe(
							Effect.provide(
								QuakeDevice.DefaultWithoutDependencies.pipe(
									Layer.provide(fake.layer),
								),
							),
						);
						const connection = yield* device.connect();
						const controls = yield* HardwareControls.pipe(
							Effect.provide(HardwareControls.Default),
						);
						const lockFinished = yield* Deferred.make<void>();
						const current = yield* controls.create(connection, {
							serial: "serial-sentinel",
							session: "session-sentinel",
						});
						yield* current.refresh();
						if (operation === "lock")
							yield* current.configure({
								...defaultHardwarePreferences,
								knobLedAlwaysOn: false,
							});
						yield* fake.failWrite(original);
						const management = {
							webContents: {
								mainFrame: {},
								getURL: () => "file:///app/index.html?surface=management",
							},
						};
						const dispose = registerHardware(
							() => ({
								...current,
								setLocked: (locked) =>
									current
										.setLocked(locked)
										.pipe(
											Effect.ensuring(
												Deferred.succeed(lockFinished, undefined),
											),
										),
								toggleMic: () =>
									current.toggleMic().pipe(
										Effect.tapError((error) =>
											Effect.sync(() => {
												if (error instanceof HardwareUnavailable)
													observed = error;
											}),
										),
									),
							}),
							() => management,
							true,
							"file:///app/index.html",
							diagnostics,
						);
						try {
							if (operation === "lock") {
								yield* Effect.sync(() => powerMonitor.emit("lock-screen"));
								yield* Deferred.await(lockFinished);
								yield* Effect.yieldNow();
								return undefined;
							}
							const handler = vi.mocked(ipcMain.handle).mock.calls.at(-1)?.[1];
							if (!handler) throw new Error("Missing hardware handler");
							return yield* Effect.promise(() =>
								Reflect.apply(handler, undefined, [
									{
										sender: management.webContents,
										senderFrame: management.webContents.mainFrame,
									},
									operation === "toggleMic"
										? { _tag: "toggleMic", session: "session-sentinel" }
										: operation === "qmk"
											? {
													_tag: "qmk",
													serial: "serial-sentinel",
													session: "session-sentinel",
													operations: [{ _tag: "protocol" }],
												}
											: {
													_tag: "lighting",
													serial: "serial-sentinel",
													session: "session-sentinel",
													action: { _tag: "select" },
												},
								]),
							);
						} finally {
							yield* Effect.promise(dispose);
						}
					}),
				),
				"app.background",
			),
		);
		if (operation === "lock") expect(response).toBeUndefined();
		else
			expect(response).toEqual({
				_tag: "failure",
				code:
					operation === "lighting"
						? "QUAKE.LIGHTING.TARGET_UNAVAILABLE"
						: "QUAKE.HARDWARE.UNAVAILABLE",
			});
		if (operation === "toggleMic") {
			expect(observed).toBeInstanceOf(HardwareUnavailable);
			expect(observed?.originalCause).toBeInstanceOf(QuakeHidWriteFailed);
			if (observed?.originalCause instanceof QuakeHidWriteFailed)
				expect(observed.originalCause.originalCause).toBe(original);
		}
		await diagnostics.flush();
		const records = await retained(directory);
		const dispatch = records.find(
			(r) =>
				r.type === "span" &&
				r.span_name ===
					(operation === "toggleMic"
						? "DesktopHardware.dispatch"
						: operation === "qmk"
							? "DesktopHardware.qmk"
							: "DesktopHardware.lighting"),
		);
		if (operation === "lock") {
			const locked = records.find(
				(r) => r.type === "span" && r.span_name === "DesktopHardware.lock",
			);
			const event = records.find((r) => r.event === "hardware.lock.failed");
			expect(locked).toMatchObject({
				outcome: "failure",
				cause: {
					kind: "Fail",
					error: {
						_tag: "HardwareUnavailable",
						cause: {
							_tag: "QuakeHidWriteFailed",
							cause: { sourceCode: "EACCES" },
						},
					},
				},
			});
			expect(event).toMatchObject({
				trace_id: locked?.trace_id,
				span_id: locked?.span_id,
				request_id: locked?.request_id,
				cause: locked?.cause,
			});
			return;
		}
		const ipc = records.find(
			(r) => r.type === "span" && r.span_name === "DesktopHardware.ipc",
		);
		expect(ipc?.outcome).toBe("success");
		const hardwareCause = {
			kind: "Fail",
			error: {
				_tag: "HardwareUnavailable",
				code: "QUAKE.HARDWARE.UNAVAILABLE",
				cause: {
					_tag: "QuakeHidWriteFailed",
					code: "QUAKE.HID.WRITE_FAILED",
					cause: { sourceCode: "EACCES" },
				},
			},
		};
		if (operation === "lighting") {
			expect(dispatch).toMatchObject({
				outcome: "failure",
				cause: {
					kind: "Fail",
					error: {
						_tag: "LightingTargetUnavailable",
						code: "QUAKE.LIGHTING.TARGET_UNAVAILABLE",
						cause: hardwareCause.error,
					},
				},
			});
			const boundary = records.find(
				(r) => r.type === "span" && r.span_id === dispatch?.parent_span_id,
			);
			correlated(dispatch, boundary);
			correlated(boundary, ipc);
		} else {
			expect(dispatch).toMatchObject({
				outcome: "failure",
				cause: {
					kind: "Fail",
					error: {
						_tag: "HardwareUnavailable",
						code: "QUAKE.HARDWARE.UNAVAILABLE",
						cause: {
							_tag: "QuakeHidWriteFailed",
							code: "QUAKE.HID.WRITE_FAILED",
							cause: { sourceCode: "EACCES" },
						},
					},
				},
			});
			correlated(dispatch, ipc);
		}
		const event = records.find(
			(r) =>
				r.event ===
				(operation === "qmk"
					? "hardware.qmk.failed"
					: "hardware.request.failed"),
		);
		expect(event).toMatchObject({
			type: "log",
			cause: dispatch?.cause,
			trace_id: dispatch?.trace_id,
			span_id: dispatch?.span_id,
			request_id: dispatch?.request_id,
		});
	},
);

it("retains deferred preference failures and links their ended configure parent", async () => {
	const { diagnostics, runtime, directory } = await capture();
	const original = Object.assign(
		new Error("/private-sentinel secret-sentinel"),
		{ code: "ENOSPC" },
	);
	const failure = new HardwarePreferencesFailed(original);
	await runtime.runPromise(
		diagnostics.instrument(
			Effect.scoped(
				Effect.gen(function* () {
					const fake = yield* makeFakeHardwareTransport();
					const device = yield* QuakeDevice.pipe(
						Effect.provide(
							QuakeDevice.DefaultWithoutDependencies.pipe(
								Layer.provide(fake.layer),
							),
						),
					);
					const controls = yield* HardwareControls.pipe(
						Effect.provide(
							HardwareControls.DefaultWithoutDependencies.pipe(
								Layer.provide(
									Layer.succeed(HardwarePreferencesStore, {
										read: () => Effect.succeed(Option.none()),
										write: () => Effect.fail(failure),
									}),
								),
							),
						),
					);
					const current = yield* controls.create(yield* device.connect(), {
						serial: "serial-sentinel",
						session: "session-sentinel",
					});
					yield* current.configure({
						...defaultHardwarePreferences,
						knobLedAlwaysOn: true,
					});
					yield* Effect.sleep(550);
					expect((yield* current.snapshot()).preferenceStatus).toBe("failed");
				}),
			),
			"app.background",
		),
	);
	expect(failure.originalCause).toBe(original);
	await diagnostics.flush();
	const records = await retained(directory);
	const saving = records.find(
		(r) => r.type === "span" && r.span_name === "HardwareControls.saveDeferred",
	);
	const soon = records.find(
		(r) => r.type === "span" && r.span_name === "HardwareControls.saveSoon",
	);
	expect(saving).toMatchObject({
		outcome: "failure",
		cause: {
			kind: "Fail",
			error: {
				code: failure.code,
				_tag: failure._tag,
				cause: { sourceCode: "ENOSPC" },
			},
		},
	});
	correlated(saving, soon);
	expect(records.some((r) => r.event === "hardware.preferences.failed")).toBe(
		true,
	);
});

function keys(
	execute: KeyRuntimePort["Type"]["execute"],
	overrides: Partial<KeyRuntimePort["Type"]> = {},
) {
	const type = overrides.executeOwned ? "homeAssistant" : "multiActions";
	const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
	const envelope = Schema.decodeUnknownSync(ProfileEnvelope)({
		schemaVersion: 1,
		profiles: [
			{
				id: "profile-sentinel",
				name: "private-sentinel",
				revision: 0,
				pages: [
					{
						id: "page-sentinel",
						keys: [
							{
								...empty,
								childrenName: type,
								config: {
									...empty.config,
									type,
									actions: [],
									subActions: [
										{
											config: {
												type: "hotkey",
												actions: [{ type: "key", value: "a" }],
											},
										},
									],
								},
							},
						],
					},
				],
			},
		],
		activeByDevice: {
			"serial-sentinel": {
				profileId: "profile-sentinel",
				pageId: "page-sentinel",
			},
		},
	});
	return KeyRuntime.DefaultWithoutDependencies.pipe(
		Layer.provide(
			Layer.succeed(KeyRuntimePort, {
				read: Effect.succeed(envelope),
				execute,
				publish: () => Effect.void,
				select: () => Effect.void,
				alarm: () => Effect.void,
				...overrides,
			}),
		),
	);
}

it.each(["failure", "cancel"] as const)(
	"retains a deferred physical key sequence %s before recovery/reset",
	async (mode) => {
		const { diagnostics, directory } = await capture();
		const failure = new HostActionFailed(
			Object.assign(new Error("private-sentinel Bearer secret-sentinel"), {
				code: "EACCES",
			}),
		);
		const entered = Effect.runSync(Deferred.make<void>());
		const runtime = ManagedRuntime.make(
			keys(() =>
				Deferred.succeed(entered, undefined).pipe(
					Effect.zipRight(
						mode === "failure" ? Effect.fail(failure) : Effect.never,
					),
				),
			).pipe(Layer.provideMerge(diagnostics.layer)),
		);
		cleanups.push(() => runtime.dispose());
		await runtime.runPromise(
			diagnostics.instrument(
				Effect.gen(function* () {
					yield* KeyRuntime.activate("serial-sentinel", "1,1", "press");
					yield* Deferred.await(entered);
					// The physical press has already returned. Yield so the deferred worker can recover.
					yield* Effect.yieldNow();
					if (mode === "cancel") yield* KeyRuntime.reset("serial-sentinel");
				}),
				"app.background",
			),
		);
		await runtime.dispose();
		await diagnostics.flush();
		const records = await retained(directory);
		const sequence = records.find(
			(r) => r.type === "span" && r.span_name === "KeyRuntime.sequence",
		);
		const activation = records.find(
			(r) => r.type === "span" && r.span_name === "KeyRuntime.activate",
		);
		correlated(sequence, activation);
		if (mode === "failure") {
			expect(sequence).toMatchObject({
				outcome: "failure",
				cause: {
					kind: "Fail",
					error: {
						code: failure.code,
						_tag: failure._tag,
						cause: { sourceCode: "EACCES" },
					},
				},
			});
			const event = records.find((r) => r.event === "key.sequence.failed");
			expect(event).toMatchObject({
				cause: sequence?.cause,
				trace_id: sequence?.trace_id,
				span_id: sequence?.span_id,
			});
		} else {
			expect(sequence).toMatchObject({
				outcome: "interrupted",
			});
			expect(JSON.stringify(sequence?.cause)).toContain("Interrupt");
			expect(JSON.stringify(sequence?.cause)).not.toMatch(/Fail|Die/);
			expect(records.some((r) => r.event === "key.sequence.failed")).toBe(
				false,
			);
		}
	},
);

it("links owned activation completion to its preparation after that span ends and retains the exact catalog failure", async () => {
	const { diagnostics, directory } = await capture();
	const original = Object.assign(
		new Error("private-sentinel secret-sentinel"),
		{ code: "EACCES" },
	);
	const failure = new HostActionFailed(original);
	const runtime = ManagedRuntime.make(
		keys(() => Effect.void, { executeOwned: () => Effect.fail(failure) }).pipe(
			Layer.provideMerge(diagnostics.layer),
		),
	);
	cleanups.push(() => runtime.dispose());
	const result = await runtime.runPromise(
		diagnostics.instrument(
			Effect.gen(function* () {
				const completion = yield* KeyRuntime.prepareActivation(
					"serial-sentinel",
					"1,1",
					"press",
				);
				yield* Effect.yieldNow();
				return yield* Effect.either(completion);
			}),
			"app.background",
		),
	);
	expect(Either.isLeft(result)).toBe(true);
	if (Either.isLeft(result))
		expect(Cause.originalError(result.left)).toBe(failure);
	expect(failure.originalCause).toBe(original);
	await diagnostics.flush();
	const records = await retained(directory);
	const prepare = records.find(
		(r) => r.type === "span" && r.span_name === "KeyRuntime.prepareActivation",
	);
	const complete = records.find(
		(r) => r.type === "span" && r.span_name === "KeyRuntime.completeActivation",
	);
	const owned = records.find(
		(r) => r.type === "span" && r.span_name === "KeyRuntime.ownedAction",
	);
	const activate = records.find(
		(r) => r.type === "span" && r.span_name === "KeyRuntime.activate",
	);
	correlated(complete, prepare);
	correlated(owned, activate);
	expect(prepare?.outcome).toBe("success");
	expect(complete).toMatchObject({
		outcome: "failure",
		cause: {
			kind: "Fail",
			error: { code: failure.code, cause: { sourceCode: "EACCES" } },
		},
	});
	expect(owned?.cause).toEqual(complete?.cause);
	expect(records.filter((r) => r.event === "key.input.failed")).toHaveLength(1);
});

it.each(["dispatch", "qmk"] as const)(
	"records interrupted hardware %s spans without a failure event",
	async (operation) => {
		const { diagnostics, runtime, directory } = await capture();
		await runtime.runPromise(
			diagnostics.instrument(
				Effect.scoped(
					Effect.gen(function* () {
						const fake = yield* makeFakeHardwareTransport();
						const device = yield* QuakeDevice.pipe(
							Effect.provide(
								QuakeDevice.DefaultWithoutDependencies.pipe(
									Layer.provide(fake.layer),
								),
							),
						);
						const connection = yield* device.connect();
						const controls = yield* HardwareControls.pipe(
							Effect.provide(HardwareControls.Default),
						);
						const session = yield* controls.create(connection, {
							serial: "serial-sentinel",
							session: "session-sentinel",
						});
						const interrupted = {
							...session,
							snapshot: () => Effect.interrupt,
						};
						const exit = yield* Effect.exit(
							operation === "dispatch"
								? hardwareRequest({ _tag: "read" }, interrupted, true)
								: qmkRequest({ _tag: "qmkTargets" }, [interrupted]),
						);
						expect(exit._tag).toBe("Failure");
					}),
				),
				"app.background",
			),
		);
		await diagnostics.flush();
		const records = await retained(directory);
		expect(
			records.some(
				(record) =>
					record.event === "hardware.request.failed" ||
					record.event === "hardware.qmk.failed",
			),
		).toBe(false);
		expect(
			records.find(
				(record) =>
					record.span_name ===
					(operation === "dispatch"
						? "DesktopHardware.dispatch"
						: "DesktopHardware.qmk"),
			),
		).toMatchObject({ outcome: "interrupted" });
	},
);
