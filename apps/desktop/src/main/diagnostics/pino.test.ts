import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import {
	Cause,
	Effect,
	Exit,
	Fiber,
	Layer,
	Logger,
	ManagedRuntime,
	Option,
	Tracer,
} from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeUnavailable } from "../../../../../packages/edge/src/agent-http/runtime-errors.js";
import { makeRuntimeHttpTransport } from "../../../../../packages/edge/src/agent-http/transport.js";
import { createDesktopDiagnostics } from "./index.js";
import { createPinoOutput } from "./pino.js";
import { makeDesktopRuntime } from "./runtime.js";

const scratch =
	process.env.OPEN_QUAKE_TEST_SCRATCH ??
	join(
		homedir(),
		"dev",
		"agentic-scratchpads",
		"open-quake",
		"diagnostics-tests",
	);
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture(stdout?: Writable | false, drainMs?: number) {
	await mkdir(scratch, { recursive: true });
	const directory = await mkdtemp(join(scratch, "pino-"));
	cleanup.push(() => rm(directory, { recursive: true, force: true }));
	const chunks: string[] = [];
	const sink =
		stdout ??
		new Writable({
			write(chunk, _encoding, done) {
				chunks.push(String(chunk));
				done();
			},
		});
	const diagnostics = createDesktopDiagnostics({
		directory,
		stdout: sink,
		...(drainMs === undefined ? {} : { stdoutDrainMs: drainMs }),
	});
	cleanup.push(diagnostics.close);
	return { directory, diagnostics, chunks };
}
const parse = (text: string): Array<Record<string, unknown>> =>
	text
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Record<string, unknown>);

describe("assembled Effect 3 / Pino consumer", () => {
	it("keeps actual native span IDs, parent chains, concurrent/deferred ownership and safe tracer events", async () => {
		const { directory, diagnostics, chunks } = await fixture();
		const native = Effect.runSync(Effect.tracer);
		const spans: Tracer.Span[] = [];
		const tracer = Tracer.make({
			context: (f, fiber) => native.context(f, fiber),
			span: (...args) => {
				const span = native.span(...args);
				spans.push(span);
				return span;
			},
		});
		const upstream = Object.assign(
			new TypeError("PRIVATE_PROVIDER_URL_AND_TOKEN"),
			{ code: "EACCES" },
		);
		const transport = makeRuntimeHttpTransport(async () => {
			await Promise.resolve();
			throw upstream;
		});
		let acquisitions = 0;
		const service = Layer.scopedDiscard(
			Effect.gen(function* () {
				acquisitions++;
				yield* Effect.logInfo("PRIVATE_ACQUISITION");
				yield* Effect.addFinalizer(() => Effect.logInfo("PRIVATE_FINALIZER"));
			}),
		);
		let applicationLogs = 0;
		const app = makeDesktopRuntime(
			Layer.mergeAll(
				service,
				Layer.setTracer(tracer),
				Logger.add(
					Logger.make(() => {
						applicationLogs++;
					}),
				),
			),
			diagnostics,
		);
		cleanup.push(() => app.dispose());
		const callbacks: Array<() => Promise<Tracer.Span>> = [];
		const active: Tracer.Span[] = [];
		const consume = Effect.fn("ChatService.turn")(function* () {
			const span = yield* Effect.currentSpan;
			active.push(span);
			yield* Effect.logError("PRIVATE_MESSAGE", upstream).pipe(
				Effect.annotateLogs({ secret: "PRIVATE_ANNOTATION" }),
			);
			yield* Effect.sync(() =>
				callbacks.push(
					diagnostics.bind(() =>
						app.runPromise(
							Effect.gen(function* () {
								yield* Effect.logWarning("PRIVATE_DEFERRED");
								return yield* Effect.currentSpan;
							}).pipe(Effect.withSpan("speech.playback")),
						),
					),
				),
			);
			const child = yield* Effect.logInfo("PRIVATE_FIBER").pipe(
				Effect.withSpan("speech.capture"),
				Effect.fork,
			);
			yield* Fiber.join(child);
			return yield* Effect.scoped(
				transport.execute({
					connection: {
						id: "PRIVATE_ID",
						name: "PRIVATE_NAME",
						kind: "hermes",
						baseURL: "https://private.example.test",
					},
					path: "/v1/chat/completions",
					method: "POST",
					body: { prompt: "PRIVATE_PROMPT" },
				}),
			);
		});
		// One reusable graph, concurrent invocations and a third invocation after acquisition.
		const exits = await Promise.all([
			app.runPromiseExit(consume()),
			app.runPromiseExit(consume()),
		]);
		exits.push(await app.runPromiseExit(consume()));
		for (const exit of exits) {
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				const error = Option.getOrThrow(Cause.failureOption(exit.cause));
				expect(error).toBeInstanceOf(RuntimeUnavailable);
				if (error instanceof RuntimeUnavailable)
					expect(error.originalCause).toBe(upstream);
			}
		}
		const deferred = await Promise.all(callbacks.map((callback) => callback()));
		await app.dispose();
		const status = await diagnostics.close();
		expect(acquisitions).toBe(1);
		expect(status).toMatchObject({
			closed: true,
			queuedBytes: 0,
			pinoFailures: 0,
			stdoutFailures: 0,
			stdoutPendingBytes: 0,
			stdoutTimedOut: false,
		});
		const text = await readFile(
			join(directory, "diagnostics.0.ndjson"),
			"utf8",
		);
		expect(parse(chunks.join(""))).toEqual(
			parse(text).filter((record) => record.type !== "health"),
		);
		expect(text).not.toContain("PRIVATE_");
		expect(text).not.toContain("private.example");
		const records = parse(text);
		const spanRecords = records.filter((record) => record.type === "span");
		expect(new Set(spanRecords.map((record) => record.span_id)).size).toBe(
			spans.length,
		);
		for (const span of spans) {
			const record = spanRecords.find((line) => line.span_id === span.spanId);
			expect(record).toMatchObject({
				trace_id: span.traceId,
				span_id: span.spanId,
				span_name: span.name,
			});
			if (Option.isSome(span.parent))
				expect(record?.parent_span_id).toBe(span.parent.value.spanId);
		}
		const ownerRequests = active.map(
			(span) =>
				spanRecords.find((record) => record.span_id === span.spanId)
					?.request_id,
		);
		expect(new Set(ownerRequests).size).toBe(3);
		expect(applicationLogs).toBeGreaterThan(0);
		expect(ownerRequests.every((id) => typeof id === "string")).toBe(true);
		for (const [index, span] of deferred.entries()) {
			expect(span.traceId).toBe(active[index]?.traceId);
			const runtimeParent = Option.getOrThrow(span.parent);
			const parent = spans.find(
				(candidate) => candidate.spanId === runtimeParent.spanId,
			);
			expect(parent && Option.getOrThrow(parent.parent).spanId).toBe(
				active[index]?.spanId,
			);
			expect(
				spanRecords.find((record) => record.span_id === span.spanId)
					?.request_id,
			).toBe(ownerRequests[index]);
		}
		for (const record of records.filter(
			(record) => record.type === "log" && record.span_id,
		)) {
			const span = spans.find(
				(candidate) => candidate.spanId === record.span_id,
			);
			expect(record.trace_id).toBe(span?.traceId);
			expect(record.span_name).toBe(span?.name);
		}
		for (const span of spans.filter((span) => active.includes(span))) {
			// Real NativeSpan events, produced by our replacement of Effect's raw tracerLogger.
			expect(
				"events" in span &&
					JSON.stringify(span.events, (_key, value: unknown) =>
						typeof value === "bigint" ? value.toString() : value,
					),
			).not.toContain("PRIVATE_");
			expect(
				"events" in span &&
					JSON.stringify(span.events, (_key, value: unknown) =>
						typeof value === "bigint" ? value.toString() : value,
					),
			).toContain("effect.log");
		}
		expect(records.find((record) => record.level === "ERROR")).toMatchObject({
			pino_level: 50,
		});
		expect(
			records.filter(
				(record) => record.event === "effect.log" && record.uncorrelated,
			),
		).toHaveLength(2);
		const evidence = process.env.OPEN_QUAKE_DIAGNOSTIC_EVIDENCE;
		if (evidence) await writeFile(evidence, text, { mode: 0o600 });
	});

	it("preserves explicit external parent IDs and doesn't reuse a constructed request's owner", async () => {
		const { diagnostics, chunks } = await fixture();
		const app = ManagedRuntime.make(diagnostics.layer);
		cleanup.push(() => app.dispose());
		let reusable = diagnostics.instrument(
			Effect.logInfo("PRIVATE_LOG"),
			"voice.request",
		);
		await app.runPromise(
			diagnostics.instrument(
				Effect.sync(() => {
					reusable = diagnostics.instrument(
						Effect.logInfo("PRIVATE_LOG"),
						"voice.request",
					);
				}),
				"app.startup",
			),
		);
		const nativeParent = Effect.runSync(Effect.makeSpan("agent.request"));
		const external = Tracer.externalSpan({
			traceId: nativeParent.traceId,
			spanId: nativeParent.spanId,
		});
		await app.runPromise(reusable.pipe(Effect.withParentSpan(external)));
		await app.dispose();
		await diagnostics.close();
		const records = parse(chunks.join(""));
		const voice = records.find(
			(record) =>
				record.type === "span" && record.span_name === "voice.request",
		);
		expect(voice).toMatchObject({
			trace_id: external.traceId,
			parent_span_id: external.spanId,
		});
		const startup = records.find(
			(record) => record.type === "span" && record.span_name === "app.startup",
		);
		expect(voice?.request_id).not.toBe(startup?.request_id);
	});

	it("retains the executing span when a shared diagnostics layer is provided again", async () => {
		const { diagnostics, chunks } = await fixture();
		const app = makeDesktopRuntime(Layer.empty, diagnostics);
		cleanup.push(() => app.dispose());
		const active = await app.runPromise(
			Effect.gen(function* () {
				const span = yield* Effect.currentSpan;
				yield* Effect.logInfo("PRIVATE_LOG").pipe(
					Effect.provide(diagnostics.layer),
				);
				return span;
			}).pipe(Effect.withSpan("ChatService.turn")),
		);
		await app.dispose();
		await diagnostics.close();
		const records = parse(chunks.join(""));
		expect(records.find((record) => record.type === "log")).toMatchObject({
			trace_id: active.traceId,
			span_id: active.spanId,
			span_name: active.name,
		});
		expect(
			records.filter(
				(record) => record.type === "span" && record.span_id === active.spanId,
			),
		).toHaveLength(1);
	});

	it("retains the exact application failure with absent diagnostics and broken local/stdout destinations", async () => {
		const original = new RuntimeUnavailable(new Error("PRIVATE_ORIGINAL"));
		const absent = makeDesktopRuntime(Layer.empty);
		cleanup.push(() => absent.dispose());
		const absentExit = await absent.runPromiseExit(Effect.fail(original));
		if (!Exit.isFailure(absentExit)) throw new Error("Expected failure");
		expect(Option.getOrThrow(Cause.failureOption(absentExit.cause))).toBe(
			original,
		);
		const sink = new Writable({
			write(_chunk, _encoding, done) {
				done(Object.assign(new Error("PRIVATE_PIPE"), { code: "EPIPE" }));
			},
		});
		const { directory } = await fixture(false);
		const broken = join(directory, "file");
		await writeFile(broken, "not a directory");
		const diagnostics = createDesktopDiagnostics({
			directory: broken,
			stdout: sink,
		});
		cleanup.push(diagnostics.close);
		const app = makeDesktopRuntime(Layer.empty, diagnostics);
		cleanup.push(() => app.dispose());
		const exit = await app.runPromiseExit(Effect.fail(original));
		if (!Exit.isFailure(exit)) throw new Error("Expected failure");
		expect(
			Cause.originalError(Option.getOrThrow(Cause.failureOption(exit.cause))),
		).toBe(original);
		await app.dispose();
		const status = await diagnostics.close();
		expect(status.storageFailures).toBeGreaterThan(0);
		expect(status.stdoutFailures).toBeGreaterThan(0);
		expect(status.lastOutputFailure).toMatchObject({ sourceCode: "EPIPE" });
		expect(JSON.stringify(status)).not.toContain("PRIVATE_");
	});
});

describe("Pino destination lifecycle", () => {
	it("waits for accepted output callbacks including a tail arriving during drain", async () => {
		const callbacks: Array<(cause?: Error | null) => void> = [];
		const lines: string[] = [];
		const stdout = new Writable({
			write(_chunk, _encoding, done) {
				callbacks.push(done);
			},
		});
		const output = createPinoOutput((line) => lines.push(line), {
			stdout,
			stdoutDrainMs: 500,
		});
		output.emit({ event: "first" });
		let drained = false;
		const drain = output.drain().then(() => {
			drained = true;
		});
		output.emit({ event: "tail" });
		callbacks.shift()?.();
		await Promise.resolve();
		expect(drained).toBe(false);
		callbacks.shift()?.();
		await drain;
		await output.close();
		expect(parse(lines.join("")).map((line) => line.event)).toEqual([
			"first",
			"tail",
		]);
		expect(output.status()).toMatchObject({
			stdoutPendingBytes: 0,
			stdoutTimedOut: false,
		});
		expect(stdout.listenerCount("error")).toBe(0);
	});

	it("bounds stalled stdout, reports timeout honestly, and still drains private storage", async () => {
		const stdout = new Writable({ write() {} });
		const { diagnostics, directory } = await fixture(stdout, 10);
		const app = makeDesktopRuntime(Layer.empty, diagnostics);
		cleanup.push(() => app.dispose());
		await app.runPromise(Effect.logInfo("PRIVATE_LOG"));
		await app.dispose();
		const first = diagnostics.close();
		expect(diagnostics.close()).toBe(first);
		const status = await first;
		expect(status).toMatchObject({
			closed: true,
			queuedBytes: 0,
			stdoutTimedOut: true,
			storageFailures: 0,
		});
		expect(status.stdoutPendingBytes).toBeGreaterThan(0);
		expect(
			parse(
				await readFile(join(directory, "diagnostics.0.ndjson"), "utf8"),
			).some((line) => line.type === "log"),
		).toBe(true);
		expect(
			parse(
				await readFile(join(directory, "diagnostics.0.ndjson"), "utf8"),
			).find((record) => record.type === "health"),
		).toMatchObject({ stdoutTimedOut: true });
		// Late asynchronous failures must remain handled after a timed-out drain.
		expect(() =>
			stdout.emit("error", new Error("PRIVATE_LATE_ERROR")),
		).not.toThrow();
	});

	it("keeps the stdout queue bounded and contains synchronous Pino/destination failure", async () => {
		// The stream accepts all these writes without ever acknowledging one.
		const stdout = new Writable({
			highWaterMark: 16 * 1024 * 1024,
			write() {},
		});
		const lines: string[] = [];
		const output = createPinoOutput((line) => lines.push(line), {
			stdout,
			stdoutMaxBytes: 1024,
			stdoutDrainMs: 1,
		});
		for (let index = 0; index < 100; index++)
			output.emit({ event: "bounded", index });
		expect(output.status().stdoutPendingBytes).toBeLessThanOrEqual(1024);
		expect(output.status().stdoutDropped).toBeGreaterThan(0);
		expect(lines).toHaveLength(100);
		await output.close();
		const broken = createPinoOutput(
			() => {
				throw new Error("PRIVATE_DESTINATION");
			},
			{ stdout: false },
		);
		expect(() => broken.emit({ event: "safe" })).not.toThrow();
		expect(broken.status().pinoFailures).toBe(1);
		expect(JSON.stringify(broken.status())).not.toContain("PRIVATE_");
		await broken.close();
	});

	it("retains failed flush status while attempting file cleanup", async () => {
		const { diagnostics, directory } = await fixture(false);
		const app = makeDesktopRuntime(Layer.empty, diagnostics);
		cleanup.push(() => app.dispose());
		await app.runPromise(Effect.void);
		await diagnostics.flush();
		const fs = await import("node:fs/promises");
		// FileHandles share a prototype. Inject only the fsync boundary after acquisition.
		const probe = await fs.open(join(directory, "sync-probe"), "w");
		const prototype: object = Object.getPrototypeOf(probe);
		await probe.close();
		const failure = vi
			.spyOn(prototype as { sync: () => Promise<void> }, "sync")
			.mockRejectedValue(new Error("PRIVATE_FSYNC"));
		try {
			await app.dispose();
			const status = await diagnostics.close();
			expect(status.closed).toBe(true);
			expect(status.storageFailures).toBeGreaterThan(0);
			expect(status.lastFailure?.code).toBe("DIAGNOSTICS.STORAGE_FAILED");
		} finally {
			failure.mockRestore();
			await rm(join(directory, "sync-probe"));
		}
	});
});
