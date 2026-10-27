import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { encodeHardwareCommand } from "@open-quake/protocol";
import { Cause, Effect, Either, Exit, Layer, Stream } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import {
	fakeHardwareReply,
	makeFakeHardwareTransport,
} from "../../../../../../packages/device/src/hardware/hardware-fake.js";
import { HidTransport } from "../../../../../../packages/device/src/hid-transport.js";
import { createDesktopDiagnostics } from "../../diagnostics/index.js";
import { makeDesktopRuntime } from "../../diagnostics/runtime.js";
import { restoring, runHardwareAcceptance } from "./consumer.js";
import {
	acceptanceOptions,
	allowedAcceptanceWrite,
	competingOwners,
} from "./policy.js";
import { summarize } from "./scenarios.js";

vi.mock("node-hid", () => {
	throw new Error("Default acceptance regressions must never load native HID");
});

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});

it.each([false, true])(
	"executes production consumers with mutations=%s and never counts fake passes as native",
	async (mutations) => {
		const root =
			process.env.OPEN_QUAKE_TEST_SCRATCH ??
			join(homedir(), "dev/agentic-scratchpads/open-quake/hardware-e2e-tests");
		await mkdir(root, { recursive: true });
		const directory = await mkdtemp(join(root, "consumer-"));
		cleanup.push(() => rm(directory, { recursive: true, force: true }));
		const diagnostics = createDesktopDiagnostics({ directory, stdout: false });
		cleanup.push(diagnostics.close);
		const fake = await Effect.runPromise(
			makeFakeHardwareTransport({ serial: "private-device-sentinel" }),
		);
		const runtime = makeDesktopRuntime(fake.layer, diagnostics);
		cleanup.push(() => runtime.dispose());
		const results = await runtime.runPromise(
			Effect.scoped(
				runHardwareAcceptance({
					serial: "private-device-sentinel",
					mutations,
					keepAliveIntervalMs: 30,
					keepAliveObservationMs: 1120,
				}),
			),
		);
		await runtime.dispose();
		const health = await diagnostics.close();
		expect(results.filter((item) => item.status === "failed")).toEqual([]);
		expect(summarize("fake", results)).toMatchObject({
			total: 20,
			passed: mutations ? 13 : 10,
			nativePassed: 0,
			nativePercent: 0,
			manualOrSupervised: 7,
		});
		const records = (
			await Promise.all(
				(
					await readdir(directory)
				)
					.filter((name) => name.endsWith(".ndjson"))
					.map((name) => readFile(join(directory, name), "utf8")),
			)
		).join("\n");
		expect(records).not.toContain("private-device-sentinel");
		expect(records).not.toContain('"span_name":"redacted.span"');
		expect(health).toMatchObject({ storageFailures: 0, dropped: 0 });
		const spans = records
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>)
			.filter((row) => row.type === "span");
		const owner = spans.find(
			(row) => row.span_name === "HardwareAcceptance.run",
		);
		expect(owner).toBeDefined();
		expect(
			spans
				.filter((row) => row.span_name === "HardwareControls.refresh")
				.every((row) => row.trace_id === owner?.trace_id),
		).toBe(true);
	},
	10_000,
);

it("restores on failure and retains both the original failure and failed restoration", async () => {
	const original = { _tag: "OriginalFailure" };
	const cleanupFailure = { _tag: "RestorationFailure" };
	let calls = 0;
	const result = await Effect.runPromiseExit(
		restoring(
			Effect.fail(original),
			Effect.sync(() => {
				calls++;
			}).pipe(Effect.zipRight(Effect.fail(cleanupFailure))),
		),
	);
	expect(calls).toBe(1);
	if (!Exit.isFailure(result)) throw new Error("Expected retained failures");
	expect([...Cause.failures(result.cause)]).toEqual([original, cleanupFailure]);
});

it("restores on interruption before propagating the interruption", async () => {
	let restored = false;
	const result = await Effect.runPromiseExit(
		restoring(
			Effect.interrupt,
			Effect.sync(() => {
				restored = true;
			}),
		),
	);
	expect(restored).toBe(true);
	expect(Exit.isFailure(result) && Cause.isInterruptedOnly(result.cause)).toBe(
		true,
	);
});

it("refuses missing native opt-in and unstable identity before a transport is loaded", () => {
	expect(() => acceptanceOptions({})).toThrow("explicit opt-in");
	expect(() =>
		acceptanceOptions({
			OPEN_QUAKE_HW_E2E: "1",
			OPEN_QUAKE_HW_E2E_SERIAL: "AA:BB",
		}),
	).toThrow("canonical");
	expect(
		acceptanceOptions({
			OPEN_QUAKE_HW_E2E: "1",
			OPEN_QUAKE_HW_E2E_SERIAL: "AABB",
			OPEN_QUAKE_HW_E2E_ARTIFACTS: "/owned/scratch",
		}),
	).toMatchObject({ serial: "AABB", mutations: false });
});

it("fails closed for firmware, keyboard, audio and screen-power writes", () => {
	for (const command of [
		{ _tag: "Dfu" },
		{ _tag: "Keyboard", action: 1, modifiers: 0, usage: 4 },
		{ _tag: "Buzzer", level: 80 },
		{ _tag: "ScreenPower", on: false },
	] as const) {
		const bytes = Either.getOrThrow(encodeHardwareCommand(command));
		expect(allowedAcceptanceWrite(bytes, false)).toBe(false);
		expect(allowedAcceptanceWrite(bytes, true)).toBe(false);
	}
	const change = Either.getOrThrow(
		encodeHardwareCommand({ _tag: "Mic", on: false }),
	);
	expect(allowedAcceptanceWrite(change, false)).toBe(false);
	expect(allowedAcceptanceWrite(change, true)).toBe(true);
});

it("detects actual application owners without treating unrelated Electron applications as device owners", () => {
	expect(
		competingOwners(
			"12 1 /Applications/DK-Suite.app/Contents/MacOS/DK-Suite\n13 1 /Applications/1Password.app/Contents/MacOS/1Password\n14 1 /Applications/open-quake.app/Contents/MacOS/open-quake",
			99,
		),
	).toEqual([12, 14]);
	expect(
		competingOwners("99 1 electron /path/oq-hardware-e2e/apps/desktop", 99),
	).toEqual([]);
});

it("ignores only the fixture's launcher ancestry and retains independent owners", () => {
	expect(
		competingOwners(
			[
				"90 1 node /opt/pnpm/bin/pnpm.cjs exec electron /dev/open-quake/out/keyboard-smoke.js",
				"91 90 node /dev/open-quake/node_modules/electron/cli.js out/keyboard-smoke.js",
				"99 91 /dev/open-quake/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron out/keyboard-smoke.js",
				"100 1 node /opt/pnpm/bin/pnpm.cjs exec electron /dev/open-quake/out/main/index.js",
				"101 1 /Applications/open-quake.app/Contents/MacOS/open-quake",
			].join("\n"),
			99,
		),
	).toEqual([100, 101]);
});

it("rejects a replacement serial at connect before opening or writing", async () => {
	const fake = await Effect.runPromise(
		makeFakeHardwareTransport({ serial: "approved" }),
	);
	let discoveries = 0;
	const open = vi.fn(fake.transport.open);
	const source = Layer.succeed(HidTransport, {
		...fake.transport,
		discover: () =>
			fake.transport.discover().pipe(
				Effect.map((devices) => {
					discoveries++;
					return discoveries === 1
						? devices
						: devices.map((info) => ({
								...info,
								serialNumber: "replacement-private",
							}));
				}),
			),
		open,
	});
	const results = await Effect.runPromise(
		Effect.scoped(
			runHardwareAcceptance({
				serial: "approved",
				mutations: true,
				keepAliveIntervalMs: 30,
				keepAliveObservationMs: 1120,
			}),
		).pipe(Effect.provide(source)),
	);
	expect(results.find((item) => item.id === "identity")?.status).toBe("passed");
	expect(results.find((item) => item.id === "connect")?.status).toBe("failed");
	expect(open).not.toHaveBeenCalled();
	expect(await Effect.runPromise(fake.writes)).toEqual([]);
	expect(JSON.stringify(results)).not.toContain("replacement-private");
});

it.each([false, true])(
	"bounds restoration and waits for delayed ACKs, missing readback=%s",
	async (missingReadback) => {
		let mic = 1;
		let luminance = 255;
		let led = 1;
		let micQueries = 0;
		let busy = false;
		const fake = await Effect.runPromise(
			makeFakeHardwareTransport({
				serial: "approved",
				onCommand: ({ opCode, cmdId, subData }) => {
					if (opCode === 1) {
						busy = true;
						if (cmdId === 3) mic = subData[0] ?? mic;
						if (cmdId === 5) luminance = subData[0] ?? luminance;
						if (cmdId === 6) led = subData[0] ?? led;
						return [fakeHardwareReply(0, [0x90])];
					}
					if (opCode !== 2 || busy) return [];
					if (cmdId === 3) {
						micQueries++;
						if (missingReadback && micQueries === 4) return [];
						return [fakeHardwareReply(3, [mic])];
					}
					if (cmdId === 5) return [fakeHardwareReply(5, [luminance])];
					if (cmdId === 6) return [fakeHardwareReply(6, [led])];
					if (cmdId === 46) return [fakeHardwareReply(46, [1, 1, 0, 21])];
					return [];
				},
			}),
		);
		const delayed = Layer.succeed(HidTransport, {
			...fake.transport,
			open: (info) =>
				fake.transport.open(info).pipe(
					Effect.map((handle) => ({
						...handle,
						reports: handle.reports.pipe(
							Stream.mapEffect((report) =>
								report[0] === 0xa3 && report[3] === 0
									? Effect.sleep(20).pipe(
											Effect.tap(() =>
												Effect.sync(() => {
													busy = false;
												}),
											),
											Effect.as(report),
										)
									: Effect.succeed(report),
							),
						),
					})),
				),
		});
		const results = await Effect.runPromise(
			Effect.scoped(
				runHardwareAcceptance({
					serial: "approved",
					mutations: true,
					keepAliveIntervalMs: 30,
					keepAliveObservationMs: 1120,
				}),
			).pipe(Effect.provide(delayed)),
		);
		if (missingReadback)
			expect(results.find((item) => item.id === "mic-roundtrip")).toMatchObject(
				{
					status: "failed",
					cause: {
						kind: "Fail",
						error: {
							_tag: "HardwareReplyTimeout",
							code: "QUAKE.HARDWARE.REPLY_TIMEOUT",
						},
					},
				},
			);
		else expect(results.filter((item) => item.status === "failed")).toEqual([]);
		expect(results.find((item) => item.id === "reconnect")?.status).toBe(
			"passed",
		);
		expect(mic).toBe(1);
		expect(luminance).toBe(255);
		expect(led).toBe(1);
	},
	10_000,
);
