import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { Effect, Layer } from "effect";
import { it } from "vitest";
import { QuakeHidWriteFailed } from "../../../../../../packages/device/src/device-errors.js";
import { HidTransport } from "../../../../../../packages/device/src/hid-transport.js";
import { makeNodeHidLayer } from "../../../../../../packages/device/src/node-hid.js";
import { createDesktopDiagnostics } from "../../diagnostics/index.js";
import { makeDesktopRuntime } from "../../diagnostics/runtime.js";
import { runHardwareAcceptance } from "./consumer.js";
import { runExtendedAcceptance } from "./extended.js";
import { ownNativeDevice } from "./native-owner.js";
import {
	acceptanceOptions,
	allowedAcceptanceWrite,
	allowedExtendedWrite,
} from "./policy.js";
import { finalizeNativeResult } from "./result.js";
import { summarize } from "./scenarios.js";

const command = promisify(execFile);

it("runs the explicitly selected native QUAKE control acceptance inventory", async () => {
	const options = acceptanceOptions(process.env);
	const extended = process.env.OPEN_QUAKE_HW_E2E_EXTENDED === "1";
	const allows = extended ? allowedExtendedWrite : allowedAcceptanceWrite;
	const owner = await ownNativeDevice(options.directory);
	const { directory } = owner;
	try {
		await writeFile(
			join(directory, "result.json"),
			JSON.stringify({ status: "incomplete", reason: "run has not completed" }),
			{ flag: "wx", mode: 0o600 },
		);
		const diagnostics = createDesktopDiagnostics({
			directory: join(directory, "diagnostics"),
			stdout: false,
		});
		const layer = Layer.unwrapEffect(
			HidTransport.pipe(
				Effect.map((transport) =>
					Layer.succeed(HidTransport, {
						...transport,
						open: (info) =>
							transport.open(info).pipe(
								Effect.map((handle) => ({
									...handle,
									write: (bytes) =>
										allows(bytes, options.mutations)
											? handle.write(bytes)
											: Effect.fail(new QuakeHidWriteFailed(undefined)),
								})),
							),
					}),
				),
				Effect.provide(makeNodeHidLayer()),
			),
		);
		const runtime = makeDesktopRuntime(layer, diagnostics, "voice.device");
		try {
			const extra = extended
				? await runtime.runPromise(
						Effect.scoped(
							runExtendedAcceptance({
								serial: options.serial,
								mutations: options.mutations,
								cycles: 12,
							}),
						),
					)
				: undefined;
			const results = extended
				? []
				: await runtime.runPromise(
						Effect.scoped(
							runHardwareAcceptance({
								serial: options.serial,
								mutations: options.mutations,
								keepAliveIntervalMs: 15_000,
								keepAliveObservationMs: 17_000,
							}),
						),
					);
			await runtime.dispose();
			const health = await diagnostics.close();
			const { stdout: revision } = await command("git", ["rev-parse", "HEAD"]);
			const { stdout: dirty } = await command("git", ["status", "--porcelain"]);
			const sourceHash = createHash("sha256");
			for (const name of [
				"native.e2e.ts",
				"consumer.ts",
				"policy.ts",
				"scenarios.ts",
				"native-owner.ts",
				"result.ts",
				"exact-device.ts",
				"lock.ts",
				"extended.ts",
				"v3-lighting.ts",
			])
				sourceHash.update(await readFile(new URL(name, import.meta.url)));
			const report = {
				status:
					(extra
						? extra.checks.some((item) => item.status === "failed")
						: results.some((item) => item.status === "failed")) ||
					health.storageFailures > 0 ||
					health.dropped > 0
						? "failed"
						: "completed",
				revision: revision.trim(),
				dirty: dirty.trim().length > 0,
				platform: process.platform,
				architecture: process.arch,
				suiteSha256: sourceHash.digest("hex"),
				...(extra
					? {
							passed: extra.checks.filter((item) => item.status === "passed")
								.length,
							failed: extra.checks.filter((item) => item.status === "failed")
								.length,
							total: extra.checks.length,
							suite: "supplemental-native",
							...extra,
						}
					: summarize("native", results)),
				diagnostics: health,
				scenarios: results,
			};
			await finalizeNativeResult(directory, options.serial, report);
			assert.equal(
				report.failed,
				0,
				"Native failures are retained in result.json",
			);
			console.info(
				extended
					? `Supplemental native checks: ${report.passed}/${report.total} passed, ${report.failed} failed`
					: `Native hardware scenarios: ${report.passed}/${report.total}; see result.json for bounded coverage`,
			);
		} finally {
			await runtime.dispose();
			await diagnostics.close();
		}
	} finally {
		await owner.close();
	}
}, 90_000);
