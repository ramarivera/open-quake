import { ChildProcess, spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import recording from "./__fixtures__/whatsapp-terminal-qr.json";
import { channelCommandRunner } from "./channel-command";

vi.mock("node:child_process", async (original) => ({
	...(await original<typeof import("node:child_process")>()),
	spawn: vi.fn(),
}));

it("CENTER-078 preserves recorded half-block glyphs split across stdout byte chunks", async () => {
	const child = new ChildProcess();
	const stdout = new PassThrough();
	Object.defineProperty(child, "stdout", { value: stdout });
	vi.mocked(spawn).mockReturnValue(child);
	const lines: string[] = [];
	const pending = channelCommandRunner(
		process.execPath,
		process.cwd(),
	)({
		args: ["fake-whatsapp"],
		timeoutMs: 1000,
		onLine: (line) => lines.push(line),
	});
	const bytes = Buffer.from(recording.output);
	const split = bytes.indexOf(Buffer.from("▄")) + 1;
	stdout.write(bytes.subarray(0, split));
	stdout.write(bytes.subarray(split, split + 1));
	stdout.write(bytes.subarray(split + 1));
	child.emit("close", 0);
	expect(await pending).toBe(recording.output);
	expect(lines).toEqual(recording.output.trimEnd().split("\n"));
});
