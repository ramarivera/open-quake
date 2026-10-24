#!/usr/bin/env node
/** LEAD ONLY. Never imported by the app. No HID writes, no control interface opens. */
import { execFileSync } from "node:child_process";
import { closeSync, openSync, writeSync } from "node:fs";
import {
	competingProcesses,
	isProbeCollection,
	TOUCH_PROBE_IDENTITY,
	validateOutput,
} from "./touch-probe-guards.mjs";

const args = process.argv.slice(2);
if (!args.includes("--capture")) {
	process.stderr.write(
		"Refusing hardware access. Opt in with --capture --out <absolute scratch file> [--duration-ms 5000].\n",
	);
	process.exit(2);
}
const outputIndex = args.indexOf("--out"),
	durationIndex = args.indexOf("--duration-ms");
if (outputIndex < 0 || !args[outputIndex + 1])
	throw new Error("Explicit --out in lane scratch is required");
const duration = durationIndex < 0 ? 5000 : Number(args[durationIndex + 1]);
if (!Number.isInteger(duration) || duration < 1 || duration > 60000)
	throw new Error("Duration must be 1–60000 ms");
const assertAlone = () => {
	const processes = competingProcesses(
		execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" }),
		process.pid,
	);
	if (processes.length)
		throw new Error(
			`Refusing capture while open-quake or DK-Suite is running. PIDs: ${processes.join(", ")}`,
		);
};
assertAlone();
const output = validateOutput(args[outputIndex + 1]);
// These imports and every HID operation occur only after all opt-in/process/path guards.
const hid = await import("node-hid");
const descriptors = (
	await hid.devicesAsync(
		TOUCH_PROBE_IDENTITY.vendorId,
		TOUCH_PROBE_IDENTITY.productId,
	)
).filter(isProbeCollection);
const devices = [
	...new Map(descriptors.map((device) => [device.path, device])).values(),
];
if (devices.length !== 1)
	throw new Error(
		`Expected exactly one FF73/71 collection, found ${devices.length}`,
	);
const device = devices[0];
assertAlone();
const fd = openSync(output, "wx", 0o600);
let handle;
let timer;
let finished = false;
const finish = async (error) => {
	if (finished) return;
	finished = true;
	if (timer) clearTimeout(timer);
	if (handle) {
		handle.removeAllListeners("data");
		await handle.close().catch(() => {
			process.exitCode = 1;
		});
	}
	closeSync(fd);
	if (error) {
		process.stderr.write(
			"Touch capture stopped after an HID/read/write failure.\n",
		);
		process.exitCode = 1;
	}
};
try {
	writeSync(
		fd,
		`${JSON.stringify({ type: "capture", identity: TOUCH_PROBE_IDENTITY, source: "hardware", startedAt: new Date().toISOString() })}\n`,
	);
	handle = await hid.HIDAsync.open(device.path, {
		nonExclusive: process.platform === "darwin",
	});
	let frames = 0;
	handle.on("data", (bytes) => {
		if (finished) return;
		try {
			writeSync(
				fd,
				`${JSON.stringify({ at: Date.now(), bytes: Array.from(bytes) })}\n`,
			);
		} catch (error) {
			void finish(error);
		}
		if (++frames >= 10000) void finish();
	});
	handle.on("error", (error) => {
		void finish(error);
	});
	process.once("SIGINT", () => {
		void finish();
	});
	process.once("SIGTERM", () => {
		void finish();
	});
	timer = setTimeout(() => {
		void finish();
	}, duration);
	process.stdout.write(
		`Capturing FF73/71 only for at most ${duration} ms to ${output}\n`,
	);
} catch (error) {
	await finish(error);
}
