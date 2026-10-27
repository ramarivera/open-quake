import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { encodeHardwareCommand } from "@open-quake/protocol";
import { Cause, Effect, Either, Exit } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { makeFakeHardwareTransport } from "../../../../../../packages/device/src/hardware/hardware-fake.js";
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
			"/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-hardware-e2e/tests";
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
			"12 /Applications/DK-Suite.app/Contents/MacOS/DK-Suite\n13 /Applications/1Password.app/Contents/MacOS/1Password\n14 /Applications/open-quake.app/Contents/MacOS/open-quake",
			99,
		),
	).toEqual([12, 14]);
	expect(
		competingOwners("99 electron /path/oq-hardware-e2e/apps/desktop", 99),
	).toEqual([]);
});
