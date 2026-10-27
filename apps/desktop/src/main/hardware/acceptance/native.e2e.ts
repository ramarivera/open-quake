import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
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
import { ownNativeDevice } from "./native-owner.js";
import { acceptanceOptions, allowedAcceptanceWrite } from "./policy.js";
import { summarize } from "./scenarios.js";

const command = promisify(execFile);

it("runs the explicitly selected native QUAKE control acceptance inventory", async () => {
	const options = acceptanceOptions(process.env);
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
										allowedAcceptanceWrite(bytes, options.mutations)
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
			const results = await runtime.runPromise(
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
			const sourceHash = createHash("sha256");
			for (const name of [
				"native.e2e.ts",
				"consumer.ts",
				"policy.ts",
				"scenarios.ts",
				"native-owner.ts",
			])
				sourceHash.update(await readFile(new URL(name, import.meta.url)));
			const report = {
				status:
					results.some((item) => item.status === "failed") ||
					health.storageFailures > 0 ||
					health.dropped > 0
						? "failed"
						: "completed",
				revision: revision.trim(),
				platform: process.platform,
				architecture: process.arch,
				suiteSha256: sourceHash.digest("hex"),
				...summarize("native", results),
				diagnostics: health,
				scenarios: results,
			};
			await writeFile(
				join(directory, "result.json"),
				JSON.stringify(report, null, 2),
				{ mode: 0o600 },
			);
			const text = (
				await Promise.all(
					(
						await readdir(join(directory, "diagnostics"))
					)
						.filter((name) => name.endsWith(".ndjson"))
						.map((name) =>
							readFile(join(directory, "diagnostics", name), "utf8"),
						),
				)
			).join("\n");
			assert(
				!text.includes(options.serial),
				"Raw device serial must not enter diagnostics",
			);
			assert(
				!text.includes('"span_name":"redacted.span"'),
				"Acceptance spans must be reviewed names",
			);
			assert.equal(health.storageFailures, 0);
			assert.equal(health.dropped, 0);
			assert.equal(
				report.failed,
				0,
				"Native failures are retained in result.json",
			);
			console.info(
				`Native hardware scenarios: ${report.nativePassed}/${report.total}, ${report.nativePercent.toFixed(1)}%; ${report.skipped} skipped, ${report.manualOrSupervised} manual-or-supervised`,
			);
		} finally {
			await runtime.dispose();
			await diagnostics.close();
		}
	} finally {
		await owner.close();
	}
}, 90_000);
