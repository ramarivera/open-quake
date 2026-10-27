import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { confirmKeyboardReadiness } from "./keyboard-readiness.js";
import { acquireAcceptanceLock } from "./lock.js";
import { finalizeNativeResult } from "./result.js";

const directories: string[] = [];
afterEach(async () => {
	for (const directory of directories.splice(0))
		await rm(directory, { recursive: true, force: true });
});
const incomplete = JSON.stringify({ status: "incomplete" });
const report = {
	status: "completed",
	diagnostics: { storageFailures: 0, dropped: 0 },
};
async function fixture() {
	const root =
		process.env.OPEN_QUAKE_TEST_SCRATCH ??
		join(homedir(), "dev/agentic-scratchpads/open-quake/hardware-e2e-tests");
	await mkdir(root, { recursive: true });
	const directory = await mkdtemp(join(root, "result-"));
	directories.push(directory);
	await writeFile(join(directory, "result.json"), incomplete);
	return directory;
}

it.each([
	["raw serial", '{"serial":"private-device-sentinel"}'],
	["unreviewed span", '{"span_name":"redacted.span"}'],
])(
	"preserves the incomplete report after rejected %s diagnostics",
	async (_name, record) => {
		const directory = await fixture();
		await mkdir(join(directory, "diagnostics"));
		await writeFile(join(directory, "diagnostics", "events.ndjson"), record);
		const error = await finalizeNativeResult(
			directory,
			"private-device-sentinel",
			report,
		).catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(Error);
		expect(String(error)).not.toContain("private-device-sentinel");
		expect(await readFile(join(directory, "result.json"), "utf8")).toBe(
			incomplete,
		);
	},
);

it("preserves the incomplete report when diagnostics cannot be read", async () => {
	const directory = await fixture();
	await expect(
		finalizeNativeResult(directory, "private-device-sentinel", report),
	).rejects.toThrow();
	expect(await readFile(join(directory, "result.json"), "utf8")).toBe(
		incomplete,
	);
});

it.each(["storageFailures", "dropped"] as const)(
	"rejects diagnostics with %s",
	async (field) => {
		const directory = await fixture();
		await mkdir(join(directory, "diagnostics"));
		await writeFile(
			join(directory, "diagnostics", "events.ndjson"),
			'{"span_name":"HardwareAcceptance.run"}',
		);
		await expect(
			finalizeNativeResult(directory, "private-device-sentinel", {
				...report,
				diagnostics: { ...report.diagnostics, [field]: 1 },
			}),
		).rejects.toThrow();
		expect(await readFile(join(directory, "result.json"), "utf8")).toBe(
			incomplete,
		);
	},
);

it("finalizes valid evidence without following a replaced result symlink", async () => {
	const directory = await fixture();
	await mkdir(join(directory, "diagnostics"));
	await writeFile(
		join(directory, "diagnostics", "events.ndjson"),
		'{"span_name":"HardwareAcceptance.run"}',
	);
	const outside = join(directory, "unrelated.json");
	await writeFile(outside, "keep");
	await unlink(join(directory, "result.json"));
	await symlink(outside, join(directory, "result.json"));
	await finalizeNativeResult(directory, "private-device-sentinel", report);
	expect(
		JSON.parse(await readFile(join(directory, "result.json"), "utf8")),
	).toEqual(report);
	expect(await readFile(outside, "utf8")).toBe("keep");
});

it("rejects concurrent lock acquisition and preserves a replacement owner on close", async () => {
	const directory = await fixture();
	const path = join(directory, "owner.lock");
	const first = await acquireAcceptanceLock(path);
	try {
		await expect(acquireAcceptanceLock(path)).rejects.toMatchObject({
			code: "EEXIST",
		});
		await unlink(path);
		const second = await acquireAcceptanceLock(path);
		try {
			await first.close();
			await first.close();
			await expect(acquireAcceptanceLock(path)).rejects.toMatchObject({
				code: "EEXIST",
			});
		} finally {
			await second.close();
		}
	} finally {
		await first.close();
	}
	const next = await acquireAcceptanceLock(path);
	await next.close();
});

it("gives the existing lock PID and safe manual recovery instructions", async () => {
	const directory = await fixture();
	const path = join(directory, "owner.lock");
	await writeFile(path, "12345");
	await expect(acquireAcceptanceLock(path)).rejects.toThrow("PID 12345");
	await expect(acquireAcceptanceLock(path)).rejects.toThrow(
		"Confirm that process is dead before removing",
	);
	await writeFile(path, "private-untrusted-lock-contents");
	const failure = await acquireAcceptanceLock(path).catch(
		(cause: unknown) => cause,
	);
	expect(String(failure)).toContain("PID unknown");
	expect(String(failure)).not.toContain("private-untrusted-lock-contents");
	expect(await readFile(path, "utf8")).toBe("private-untrusted-lock-contents");
});

it("requires a fresh keyboard challenge for each invocation and rejects replay", async () => {
	let previous = "";
	await confirmKeyboardReadiness(async (prompt) => {
		const match = prompt.match(/Type "(QUAKE [^"]+)"/);
		if (!match?.[1]) throw new Error("Missing keyboard challenge");
		previous = match[1];
		return previous;
	});
	await expect(confirmKeyboardReadiness(async () => previous)).rejects.toThrow(
		"new supervised acknowledgement",
	);
	await expect(confirmKeyboardReadiness(async () => "1")).rejects.toThrow(
		"new supervised acknowledgement",
	);
});

it("propagates an existing lock read failure without deleting the lock", async () => {
	const directory = await fixture();
	const path = join(directory, "owner.lock");
	await mkdir(path);
	await expect(acquireAcceptanceLock(path)).rejects.toMatchObject({
		code: "EISDIR",
	});
});
