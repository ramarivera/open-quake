import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Option } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	makeWindowsForeground,
	type SpawnWindowsForeground,
} from "./windows-foreground";

class FakeProcess extends EventEmitter {
	readonly stdin = new PassThrough();
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();
	readonly requests: string[] = [];
	readonly kill = vi.fn(() => true);
	constructor() {
		super();
		this.stdin.on("data", (chunk: Buffer) => {
			this.requests.push(chunk.toString("utf8").trim());
		});
	}
	reply(status = "foreground", requestId = this.requests.at(-1)): void {
		this.stdout.write(
			`${JSON.stringify({ requestId, status, id: "42", path: "C:\\Editor\\编辑器.exe" })}\r\n`,
		);
	}
	close(): void {
		this.emit("exit", 1);
		this.emit("close", 1);
	}
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("persistent Windows foreground protocol", () => {
	it("reuses one process, shares outstanding work and decodes split UTF-8 replies", async () => {
		const child = new FakeProcess();
		const spawn = vi.fn(() => child);
		const helper = makeWindowsForeground(spawn);
		try {
			const first = helper.probe();
			expect(helper.probe()).toBe(first);
			expect(child.requests).toEqual(["1"]);
			const bytes = Buffer.from(
				`${JSON.stringify({ requestId: "1", status: "foreground", id: "42", path: "C:\\编辑器.exe" })}\r\n`,
			);
			for (const byte of bytes) child.stdout.write(Buffer.from([byte]));
			expect(await first).toEqual(
				Option.some({ id: "42", path: "C:\\编辑器.exe" }),
			);
			const second = helper.probe();
			child.reply("none");
			expect(await second).toEqual(Option.none());
			expect(child.requests).toEqual(["1", "2"]);
			expect(spawn).toHaveBeenCalledTimes(1);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			const disposal = helper.dispose();
			child.close();
			await disposal;
		}
	});

	it.each([
		"not json\n",
		'{"requestId":"999","status":"none"}\n',
		'{"requestId":"1","status":"unknown"}\n',
		'{"requestId":"1","status":"foreground","id":"","path":"private"}\n',
	])(
		"rejects malformed or mismatched output and restarts after close: %s",
		async (output) => {
			const first = new FakeProcess();
			const second = new FakeProcess();
			const spawn = vi
				.fn<SpawnWindowsForeground>()
				.mockReturnValueOnce(first)
				.mockReturnValueOnce(second);
			const helper = makeWindowsForeground(spawn);
			const pending = helper.probe();
			const failure = expect(pending).rejects.toBeDefined();
			first.stdout.write(output);
			await failure;
			expect(first.kill).toHaveBeenCalledTimes(1);
			await expect(helper.probe()).rejects.toThrow("stopping");
			expect(spawn).toHaveBeenCalledTimes(1);
			first.close();
			const recovered = helper.probe();
			second.reply();
			expect(Option.isSome(await recovered)).toBe(true);
			expect(second.requests).toEqual(["2"]);
			const disposal = helper.dispose();
			second.close();
			await disposal;
		},
	);

	it.each(["stdout", "stderr"] as const)(
		"bounds %s output without waiting for a newline",
		async (stream) => {
			const child = new FakeProcess();
			const helper = makeWindowsForeground(() => child);
			const failure = expect(helper.probe()).rejects.toThrow("output limit");
			child[stream].write(Buffer.alloc(64 * 1024, 120));
			expect(child.kill).not.toHaveBeenCalled();
			child[stream].write(Buffer.from("x"));
			await failure;
			expect(child.kill).toHaveBeenCalledTimes(1);
			expect(vi.getTimerCount()).toBe(0);
			const disposal = helper.dispose();
			child.close();
			await disposal;
		},
	);

	it("doesn't buffer unbounded stderr while idle", async () => {
		const child = new FakeProcess();
		const helper = makeWindowsForeground(() => child);
		const pending = helper.probe();
		child.reply();
		await pending;
		child.stderr.write(Buffer.alloc(64 * 1024, 120));
		expect(child.kill).toHaveBeenCalledTimes(1);
		const disposal = helper.dispose();
		child.close();
		await disposal;
	});

	it("enforces a 5 s deadline including startup and cannot overlap a dying child", async () => {
		const child = new FakeProcess();
		const spawn = vi.fn(() => child);
		const helper = makeWindowsForeground(spawn);
		const failure = expect(helper.probe()).rejects.toThrow("deadline");
		await vi.advanceTimersByTimeAsync(4999);
		expect(child.kill).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		await failure;
		expect(child.kill).toHaveBeenCalledTimes(1);
		await expect(helper.probe()).rejects.toThrow("stopping");
		expect(spawn).toHaveBeenCalledTimes(1);
		child.close();
		helper.dispose();
	});

	it.each(["process", "stdin", "stdout", "stderr", "exit"] as const)(
		"rejects %s failure, releases listeners on close and permits recovery",
		async (source) => {
			const child = new FakeProcess();
			const replacement = new FakeProcess();
			const spawn = vi
				.fn<SpawnWindowsForeground>()
				.mockReturnValueOnce(child)
				.mockReturnValueOnce(replacement);
			const helper = makeWindowsForeground(spawn);
			const failure = expect(helper.probe()).rejects.toBeDefined();
			if (source === "exit") child.emit("exit", 1);
			else if (source === "process") child.emit("error", new Error("ENOENT"));
			else child[source].emit("error", new Error("pipe failed"));
			await failure;
			child.close();
			expect(child.eventNames()).toEqual([]);
			expect(child.stdout.listenerCount("data")).toBe(0);
			expect(child.stderr.listenerCount("data")).toBe(0);
			expect(child.stdin.listenerCount("error")).toBe(0);
			const recovered = helper.probe();
			replacement.reply();
			expect(Option.isSome(await recovered)).toBe(true);
			const disposal = helper.dispose();
			replacement.close();
			await disposal;
		},
	);

	it("rejects a lookup failure without restarting the compiled helper", async () => {
		const child = new FakeProcess();
		const spawn = vi.fn(() => child);
		const helper = makeWindowsForeground(spawn);
		const failure = expect(helper.probe()).rejects.toThrow("lookup failed");
		child.reply("error");
		await failure;
		const recovered = helper.probe();
		child.reply();
		await recovered;
		expect(spawn).toHaveBeenCalledTimes(1);
		expect(child.kill).not.toHaveBeenCalled();
		const disposal = helper.dispose();
		child.close();
		await disposal;
	});

	it("preserves synchronous spawn/write causes and handles an asynchronous write failure", async () => {
		const cause = new Error("private token=secret");
		const unavailable = makeWindowsForeground(() => {
			throw cause;
		});
		await expect(unavailable.probe()).rejects.toBe(cause);
		unavailable.dispose();
		for (const synchronous of [true, false]) {
			const child = new FakeProcess();
			vi.spyOn(child.stdin, "write").mockImplementation(
				(...args: Parameters<typeof child.stdin.write>) => {
					const callback = args.find(
						(argument) => typeof argument === "function",
					);
					if (synchronous) throw cause;
					if (typeof callback === "function") callback(cause);
					return false;
				},
			);
			const helper = makeWindowsForeground(() => child);
			await expect(helper.probe()).rejects.toBe(cause);
			expect(child.kill).toHaveBeenCalledTimes(1);
			const disposal = helper.dispose();
			child.close();
			await disposal;
		}
	});

	it("waits for actual child close on disposal and bounds a missing close to 5 s", async () => {
		const child = new FakeProcess();
		const helper = makeWindowsForeground(() => child);
		const first = helper.probe();
		child.reply();
		await first;
		let closed = false;
		const disposal = helper.dispose().then(() => {
			closed = true;
		});
		await Promise.resolve();
		expect(closed).toBe(false);
		expect(child.kill).toHaveBeenCalledTimes(1);
		child.close();
		await disposal;
		expect(closed).toBe(true);
		expect(vi.getTimerCount()).toBe(0);

		const stuck = new FakeProcess();
		const stuckHelper = makeWindowsForeground(() => stuck);
		const request = stuckHelper.probe();
		stuck.reply();
		await request;
		const failed = expect(stuckHelper.dispose()).rejects.toThrow(
			"shutdown deadline",
		);
		await vi.advanceTimersByTimeAsync(5000);
		await failed;
		stuck.close();
	});

	it("doesn't throw from a process event when termination fails and reports the shutdown cause", async () => {
		const child = new FakeProcess();
		const cause = new Error("private termination failure");
		child.kill.mockImplementation(() => {
			throw cause;
		});
		const helper = makeWindowsForeground(() => child);
		const failed = expect(helper.probe()).rejects.toBe(cause);
		child.emit("error", cause);
		await failed;
		const disposal = expect(helper.dispose()).rejects.toBe(cause);
		await vi.advanceTimersByTimeAsync(5000);
		await disposal;
		child.close();
	});

	it("accepts backpressure without sending a second outstanding request", async () => {
		const child = new FakeProcess();
		vi.spyOn(child.stdin, "write").mockReturnValue(false);
		const helper = makeWindowsForeground(() => child);
		const first = helper.probe();
		expect(helper.probe()).toBe(first);
		expect(child.stdin.write).toHaveBeenCalledTimes(1);
		child.reply("none", "1");
		expect(await first).toEqual(Option.none());
		const disposal = helper.dispose();
		child.close();
		await disposal;
	});

	it("disposes lazily and idempotently, rejects in-flight work and never restarts", async () => {
		const child = new FakeProcess();
		const spawn = vi.fn(() => child);
		const unused = makeWindowsForeground(spawn);
		unused.dispose();
		await expect(unused.probe()).rejects.toThrow("disposed");
		expect(spawn).not.toHaveBeenCalled();
		const helper = makeWindowsForeground(spawn);
		const failed = expect(helper.probe()).rejects.toThrow("disposed");
		const disposal = helper.dispose();
		expect(helper.dispose()).toBe(disposal);
		await failed;
		expect(child.stdin.writableEnded).toBe(true);
		expect(child.kill).toHaveBeenCalledTimes(1);
		child.stdout.write('{"requestId":"1","status":"none"}\n');
		child.emit("error", new Error("late error"));
		child.close();
		await disposal;
		await expect(helper.probe()).rejects.toThrow("disposed");
		expect(spawn).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});
});
