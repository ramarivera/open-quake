import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	Cause,
	Context,
	Effect,
	Either,
	Exit,
	Fiber,
	Layer,
	ManagedRuntime,
	Option,
	Redacted,
} from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { QuakeHidOpenFailed } from "../../../../../packages/device/src/device-errors.js";
import { RuntimeUnavailable } from "../../../../../packages/edge/src/agent-http/runtime-errors.js";
import { makeRuntimeHttpTransport } from "../../../../../packages/edge/src/agent-http/transport.js";
import { ChatInterrupted } from "../../../../../packages/edge/src/chat/chat-errors.js";
import { GridVoice } from "../../../../../packages/edge/src/voice/surface/grid-voice-service.js";
import { VoiceRuntimeUnavailable } from "../../../../../packages/edge/src/voice/surface/voice-surface-errors.js";
import {
	GridVoiceRuntime,
	VoiceSurfacePublisher,
	VoiceTonePort,
} from "../../../../../packages/edge/src/voice/surface/voice-surface-ports.js";
import { VoiceSurface } from "../../../../../packages/edge/src/voice/surface/voice-surface-service.js";
import { createAgentConnectionsController } from "../agent-http/connection-controller.js";
import { createAgentConnections } from "../agent-http/connections.js";
import { createDesktopDiagnostics, type DesktopDiagnostics } from "./index.js";
import { prepareDesktopModule } from "./module.js";
import { createDiagnosticStorage } from "./persistence.js";
import { safeCause, safeError, safeSpanName } from "./privacy.js";
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
const directories: string[] = [];
const resources: Array<() => Promise<unknown>> = [];
async function fixture() {
	await mkdir(scratch, { recursive: true });
	const directory = await mkdtemp(join(scratch, "diagnostics-test-"));
	directories.push(directory);
	const diagnostics = createDesktopDiagnostics({ directory });
	resources.push(diagnostics.close);
	return { directory, diagnostics };
}
function runtime(diagnostics: DesktopDiagnostics) {
	const app = ManagedRuntime.make(diagnostics.layer);
	resources.push(() => app.dispose());
	return app;
}
async function records(
	directory: string,
): Promise<Array<Record<string, unknown>>> {
	const files = (await readdir(directory))
		.filter((name) => /^diagnostics\.\d\.ndjson$/.test(name))
		.sort()
		.reverse();
	return (
		await Promise.all(
			files.map((file) => readFile(join(directory, file), "utf8")),
		)
	).flatMap((text) =>
		text.trim()
			? text
					.trim()
					.split("\n")
					.map((line) => JSON.parse(line) as Record<string, unknown>)
			: [],
	);
}
afterEach(async () => {
	for (const close of resources.splice(0).reverse()) await close();
	for (const directory of directories.splice(0))
		await rm(directory, { recursive: true, force: true });
});

describe("production Effect diagnostics", () => {
	it("persists bounded panel tile identities through Effect and Pino without private payloads", async () => {
		const { directory, diagnostics } = await fixture();
		const app = runtime(diagnostics);
		await app.runPromise(
			Effect.gen(function* () {
				yield* Effect.logInfo("panel.input", {
					keyCode: "2,8",
					action: 0,
					result: "accepted",
					serial: "private-serial",
					text: "private-input",
				});
				yield* Effect.logWarning("panel.input", {
					keyCode: "private-profile",
					action: 1,
					result: "failed",
				});
			}),
		);
		await diagnostics.flush();
		const lines = await records(directory);
		const entries = lines.filter((line) => line.event === "panel.input");
		expect(entries[0]).toMatchObject({
			input: { keyCode: "2,8", action: 0, result: "accepted" },
		});
		expect(entries[1]).not.toHaveProperty("input");
		expect(JSON.stringify(lines)).not.toMatch(
			/private-serial|private-input|private-profile/,
		);
	});
	it("MAIN-036 persists closed touch counters and states without native payloads", async () => {
		const { directory, diagnostics } = await fixture();
		const app = runtime(diagnostics);
		await app.runPromise(
			Effect.gen(function* () {
				yield* Effect.logInfo("touch.health", {
					state: "TOUCH_OK",
					reports: 9,
					frames: 7,
					bindAttempts: 1,
					recoveryCycle: 0,
					errorCode: "secret-native-error",
					message: "private-device-path",
					serial: "private-serial",
				});
				yield* Effect.logInfo("touch.state", {
					previous: "TOUCH_OK",
					state: "UNKNOWN",
					path: "private-device-path",
				});
			}),
		);
		await diagnostics.flush();
		const lines = await records(directory);
		expect(lines.find((line) => line.event === "touch.health")).toMatchObject({
			touch: {
				state: "TOUCH_OK",
				reports: 9,
				frames: 7,
				bindAttempts: 1,
				recoveryCycle: 0,
			},
		});
		expect(lines.find((line) => line.event === "touch.state")).toMatchObject({
			touch: { previous: "TOUCH_OK", state: "UNKNOWN" },
		});
		for (const privateValue of [
			"secret-native-error",
			"private-device-path",
			"private-serial",
		])
			expect(JSON.stringify(lines)).not.toContain(privateValue);
	});

	it("retains the named chat turn span and interrupted error identity with its parent trace", async () => {
		const { directory, diagnostics } = await fixture();
		const app = runtime(diagnostics);
		await app.runPromise(
			diagnostics
				.instrument(
					Effect.fail(new ChatInterrupted()).pipe(
						Effect.withSpan("ChatService.turn"),
					),
					"chat.request",
				)
				.pipe(Effect.either),
		);
		await diagnostics.flush();
		const lines = await records(directory);
		const turn = lines.find((line) => line.span_name === "ChatService.turn");
		const request = lines.find((line) => line.span_name === "chat.request");
		expect(turn).toMatchObject({
			outcome: "failure",
			cause: { kind: "Fail", error: { _tag: "ChatInterrupted" } },
		});
		expect(turn?.trace_id).toBe(request?.trace_id);
		expect(turn?.parent_span_id).toBe(request?.span_id);
	});
	it("persists exact typed HTTP consumer failure and original source identities before recovery", async () => {
		const { directory, diagnostics } = await fixture();
		const app = runtime(diagnostics);
		const upstream = Object.assign(
			new TypeError("private provider URL and prompt"),
			{ code: "EACCES" },
		);
		const transport = makeRuntimeHttpTransport(async () => {
			throw upstream;
		});
		const result = await app.runPromise(
			diagnostics
				.instrument(
					Effect.scoped(
						transport.execute({
							connection: {
								id: "private-id",
								name: "private-name",
								kind: "hermes",
								baseURL: "https://secret.example.test/private",
							},
							path: "/v1/chat/completions",
							method: "POST",
							body: { prompt: "private-prompt" },
							credential: Redacted.make("private-token"),
							headers: { "x-tenant": "private-header" },
						}),
					),
					"agent.request",
				)
				.pipe(Effect.either),
		);
		expect(Either.isLeft(result)).toBe(true);
		if (Either.isRight(result)) throw new Error("Expected transport failure");
		expect(result.left).toBeInstanceOf(RuntimeUnavailable);
		expect(result.left.originalCause).toBe(upstream);
		await diagnostics.flush();
		const lines = await records(directory);
		const failed = lines.find(
			(line) => line.span_name === "RuntimeHttpTransport.execute",
		);
		expect(failed).toMatchObject({
			type: "span",
			outcome: "failure",
			cause: {
				kind: "Fail",
				error: {
					_tag: "RuntimeUnavailable",
					code: "AGENT.HTTP.CONNECTION.UNAVAILABLE",
					cause: { name: "TypeError", sourceCode: "EACCES" },
				},
			},
		});
		const outer = lines.find((line) => line.span_name === "agent.request");
		expect(failed?.trace_id).toBe(outer?.trace_id);
		expect(failed?.parent_span_id).toBe(outer?.span_id);
		expect(failed?.request_id).toBe(outer?.request_id);
		expect(failed?.duration_ms).toBeTypeOf("number");
		const encoded = JSON.stringify(lines);
		for (const privateValue of [
			"secret.example",
			"private-",
			"Authorization",
			"Bearer",
			"headers",
			"prompt",
		])
			expect(encoded).not.toContain(privateValue);
	});

	it("observes the real GridVoice failed consumer path while keeping renderer stage behavior", async () => {
		const { directory, diagnostics } = await fixture();
		const stages: string[] = [];
		const ports = Layer.mergeAll(
			Layer.succeed(VoiceSurfacePublisher, {
				publish: (event) =>
					Effect.sync(() => {
						stages.push(event._tag);
					}),
			}),
			Layer.succeed(VoiceTonePort, { play: () => Effect.void }),
		);
		const layer = GridVoice.Default.pipe(
			Layer.provideMerge(
				Layer.succeed(GridVoiceRuntime, {
					select: () => Effect.void,
					startCapture: () => Effect.void,
					releaseCapture: () => Effect.void,
					cancelCapture: () => Effect.void,
					cancelFlow: () => Effect.void,
					sendText: () =>
						Effect.fail(
							new VoiceRuntimeUnavailable(new RangeError("private transcript")),
						),
				}),
			),
			Layer.provideMerge(VoiceSurface.Default.pipe(Layer.provide(ports))),
			Layer.provideMerge(diagnostics.layer),
		);
		const app = ManagedRuntime.make(layer);
		resources.push(() => app.dispose());
		const exit = await app.runPromise(
			diagnostics
				.instrument(
					GridVoice.sendText({
						serial: "private serial",
						keyCode: "private key",
						agentId: "private-agent",
						message: "private prompt",
					}),
					"voice.request",
				)
				.pipe(Effect.exit),
		);
		expect(exit._tag).toBe("Failure");
		expect(stages).toContain("Stage");
		await diagnostics.flush();
		const lines = await records(directory);
		expect(
			lines.find((line) => line.span_name === "GridVoice.sendText"),
		).toMatchObject({
			outcome: "failure",
			cause: {
				error: {
					_tag: "VoiceRuntimeUnavailable",
					code: "VOICE.GRID.RUNTIME_UNAVAILABLE",
					cause: { name: "RangeError" },
				},
			},
		});
		expect(JSON.stringify(lines)).not.toContain("private");
	});

	it("correlates logs, native child fibers, nested Promise runtimes and delayed bound callbacks", async () => {
		const { directory, diagnostics } = await fixture();
		const first = runtime(diagnostics);
		const second = runtime(diagnostics);
		let callback: (() => Promise<void>) | undefined;
		await first.runPromise(
			diagnostics.instrument(
				Effect.gen(function* () {
					yield* Effect.logInfo("private prompt", {
						transcript: "private transcript",
					}).pipe(Effect.annotateLogs({ authorization: "private-token" }));
					const fiber = yield* Effect.logInfo("private child").pipe(
						Effect.withSpan("speech.playback"),
						Effect.fork,
					);
					yield* Fiber.join(fiber);
					yield* Effect.promise(() =>
						second.runPromise(
							diagnostics.instrument(
								Effect.logWarning("private nested"),
								"speech.synthesize",
							),
						),
					);
					yield* Effect.sync(() => {
						callback = diagnostics.bind(() =>
							second.runPromise(
								diagnostics.instrument(
									Effect.logInfo("private delayed"),
									"speech.capture",
								),
							),
						);
					});
				}),
				"voice.request",
			),
		);
		if (!callback) throw new Error("Callback wasn't registered");
		await callback();
		await diagnostics.flush();
		const lines = await records(directory);
		expect(new Set(lines.map((line) => line.trace_id)).size).toBe(1);
		expect(new Set(lines.map((line) => line.request_id)).size).toBe(1);
		expect(
			lines.every(
				(line) =>
					typeof line.trace_id === "string" &&
					typeof line.request_id === "string",
			),
		).toBe(true);
		for (const log of lines.filter((line) => line.type === "log"))
			expect(
				lines.some(
					(line) => line.type === "span" && line.span_id === log.span_id,
				),
			).toBe(true);
		expect(JSON.stringify(lines)).not.toContain("private");
	});

	it("rejects fabricated source frames and keeps bounded failure topology without paths or free-form defects", async () => {
		const source = new TypeError("private error");
		source.stack =
			"TypeError: private error\n    at privateFunction (/Users/private/transport.ts:12:34)\n    at privateFunction (/private/unknown-secret.ts:2:3)";
		Object.assign(source, { cause: source });
		const error = new RuntimeUnavailable(source);
		expect(safeError(error)).toMatchObject({
			code: "AGENT.HTTP.CONNECTION.UNAVAILABLE",
			cause: { name: "TypeError" },
		});
		expect(JSON.stringify(safeError(error))).not.toContain("frames");
		const projected = safeCause(
			Cause.parallel(Cause.die(source), Cause.fail(error)),
		);
		expect(projected).toMatchObject({
			kind: "Parallel",
			left: { kind: "Die" },
			right: { kind: "Fail" },
		});
		expect(JSON.stringify(projected)).not.toMatch(
			/private|unknown-secret|Users/,
		);
		const { directory, diagnostics } = await fixture();
		const app = runtime(diagnostics);
		await app.runPromise(
			diagnostics
				.instrument(Effect.die(source), "app.background")
				.pipe(Effect.exit),
		);
		await diagnostics.flush();
		expect(
			(await records(directory)).find((line) => line.type === "span"),
		).toMatchObject({
			outcome: "failure",
			cause: { kind: "Die", error: { name: "TypeError" } },
		});
	});

	it("doesn't duplicate spans when a service provides the shared diagnostics layer again", async () => {
		const { directory, diagnostics } = await fixture();
		const app = makeDesktopRuntime(Layer.empty, diagnostics);
		await app.runPromise(
			diagnostics
				.instrument(Effect.void, "voice.request")
				.pipe(Effect.provide(diagnostics.layer)),
		);
		await app.dispose();
		await diagnostics.flush();
		const spans = (await records(directory)).filter(
			(line) => line.type === "span",
		);
		expect(new Set(spans.map((line) => line.span_id)).size).toBe(spans.length);
	});

	it("flushes shutdown finalizers and closes idempotently without changing application failures", async () => {
		const { directory, diagnostics } = await fixture();
		const app = ManagedRuntime.make(
			Layer.scopedDiscard(
				Effect.addFinalizer(() => Effect.logInfo("private finalizer")),
			).pipe(Layer.provideMerge(diagnostics.layer)),
		);
		await app.runPromise(diagnostics.instrument(Effect.void, "app.startup"));
		await app.dispose();
		const status = await diagnostics.close();
		expect(await diagnostics.close()).toEqual(status);
		expect(status).toMatchObject({
			closed: true,
			queuedBytes: 0,
			storageFailures: 0,
			dropped: 0,
		});
		expect((await records(directory)).some((line) => line.type === "log")).toBe(
			true,
		);
		expect(
			(await records(directory)).find((line) => line.type === "health"),
		).toMatchObject({ dropped: 0, storageFailures: 0 });
		expect((await stat(directory)).mode & 0o777).toBe(0o700);
		expect(
			(await stat(join(directory, "diagnostics.0.ndjson"))).mode & 0o777,
		).toBe(0o600);
	});

	it("bounds disk and memory, rotates complete NDJSON and survives broken storage", async () => {
		const { directory } = await fixture();
		const store = createDiagnosticStorage({
			directory,
			maxFileBytes: 1024,
			maxFiles: 2,
			maxQueueBytes: 1024,
		});
		resources.push(store.close);
		for (let batch = 0; batch < 15; batch++) {
			for (let index = 0; index < 100; index++)
				store.emit({ type: "test", batch, index });
			await store.flush();
		}
		expect(store.status().dropped).toBeGreaterThan(0);
		expect(store.status().queuedBytes).toBe(0);
		const files = await readdir(directory);
		expect(files).toHaveLength(2);
		for (const file of files)
			expect((await stat(join(directory, file))).size).toBeLessThanOrEqual(
				1024,
			);
		expect((await records(directory)).length).toBeGreaterThan(0);
		await store.close();
		const broken = join(directory, "file-instead-of-directory");
		await writeFile(broken, "file");
		const diagnostics = createDesktopDiagnostics({ directory: broken });
		resources.push(diagnostics.close);
		const app = runtime(diagnostics);
		const original = new RuntimeUnavailable(
			new Error("private dependency failure"),
		);
		const result = await app.runPromise(
			diagnostics
				.instrument(Effect.fail(original), "agent.request")
				.pipe(Effect.either),
		);
		expect(Either.isLeft(result)).toBe(true);
		if (Either.isRight(result)) throw new Error("Expected original failure");
		expect(Cause.originalError(result.left)).toBe(original);
		const status = await diagnostics.close();
		expect(status.storageFailures).toBeGreaterThan(0);
		expect(JSON.stringify(status)).not.toContain("private");
	});
	it("isolates simultaneous requests and records cancellation without remote text", async () => {
		const { directory, diagnostics } = await fixture();
		const app = runtime(diagnostics);
		await app.runPromise(
			Effect.all(
				[
					diagnostics.instrument(
						Effect.yieldNow().pipe(
							Effect.zipRight(Effect.logInfo("private first")),
						),
						"voice.request",
					),
					diagnostics
						.instrument(
							Effect.yieldNow().pipe(Effect.zipRight(Effect.interrupt)),
							"agent.request",
						)
						.pipe(Effect.exit),
				],
				{ concurrency: "unbounded" },
			),
		);
		await diagnostics.flush();
		const lines = await records(directory);
		const first = lines.find(
			(line) => line.span_name === "voice.request" && line.type === "span",
		);
		const second = lines.find(
			(line) => line.span_name === "agent.request" && line.type === "span",
		);
		expect(first).toBeDefined();
		expect(second).toMatchObject({
			outcome: "interrupted",
			cause: { kind: "Interrupt" },
		});
		expect(first?.trace_id).not.toBe(second?.trace_id);
		expect(first?.request_id).not.toBe(second?.request_id);
	});

	it("survives hostile log values and preserves actionable device and network source codes", async () => {
		const { directory, diagnostics } = await fixture();
		const app = runtime(diagnostics);
		const hostile = new Proxy(
			{},
			{
				getPrototypeOf() {
					throw new Error("private hostile");
				},
				getOwnPropertyDescriptor() {
					throw new Error("private hostile");
				},
			},
		);
		expect(() => safeError(hostile)).not.toThrow();
		await app.runPromise(
			diagnostics.instrument(Effect.logWarning(hostile), "app.background"),
		);
		const network = Object.assign(new TypeError("private endpoint refused"), {
			code: "ECONNREFUSED",
			status: 503,
			url: "private-url",
		});
		const hid = new QuakeHidOpenFailed(network);
		await app.runPromise(
			diagnostics
				.instrument(Effect.fail(hid), "app.background")
				.pipe(Effect.exit),
		);
		await diagnostics.flush();
		const lines = await records(directory);
		expect(
			lines.some((line) => line.event === "diagnostics.projection_failed"),
		).toBe(true);
		expect(lines.find((line) => line.outcome === "failure")).toMatchObject({
			cause: {
				error: {
					_tag: "QuakeHidOpenFailed",
					code: "QUAKE.HID.OPEN_FAILED",
					cause: { sourceCode: "ECONNREFUSED", status: 503 },
				},
			},
		});
		expect(JSON.stringify(lines)).not.toContain("private");
	});
});

describe("process-owned runtime diagnostics", () => {
	it("keeps module operation labels and shared finalizer diagnostics on the application sink", async () => {
		const { directory, diagnostics } = await fixture();
		const layer = Layer.scopedDiscard(
			Effect.addFinalizer(() => Effect.logInfo("Application shutdown failed")),
		);
		const module = prepareDesktopModule(
			layer,
			(runtime) => runtime,
			diagnostics,
			"agent.request",
		);
		const application = makeDesktopRuntime(module.layer, diagnostics);
		resources.push(application.dispose);
		module.bind(application);
		await application.runtime();
		const view = module.start();
		const failure = new RuntimeUnavailable();
		const exit = await view.runPromiseExit(Effect.fail(failure));
		expect(Exit.isFailure(exit) && Cause.failureOption(exit.cause)).toEqual(
			Option.some(failure),
		);
		await view.dispose();
		await application.dispose();
		await diagnostics.flush();
		const saved = await records(directory);
		expect(
			saved.filter((r) => r.type === "span" && r.span_name === "agent.request"),
		).toHaveLength(1);
		expect(
			saved.some(
				(r) => r.type === "log" && r.event === "Application shutdown failed",
			),
		).toBe(true);
	});
	it("observes acquisition, all interpreter boundaries and finalizers without changing Effect runtime ownership", async () => {
		const { directory, diagnostics } = await fixture();
		class Port extends Context.Tag("DiagnosticRuntimeFixture")<
			Port,
			{ value: number }
		>() {}
		const live = Layer.scoped(
			Port,
			Effect.acquireRelease(
				Effect.logInfo("HTTP runtime setup failed").pipe(
					Effect.as({ value: 42 }),
				),
				() => Effect.logInfo("Application shutdown failed"),
			),
		);
		const app = makeDesktopRuntime(live, diagnostics, "agent.request");
		resources.push(app.dispose);
		expect(Effect.isEffect(app)).toBe(true);
		const read = Effect.map(Port, (p) => p.value);
		expect(await app.runPromise(read)).toBe(42);
		expect(app.runSync(read)).toBe(42);
		expect(app.runSyncExit(read)._tag).toBe("Success");
		expect((await app.runPromiseExit(read))._tag).toBe("Success");
		expect(await Effect.runPromise(Fiber.join(app.runFork(read)))).toBe(42);
		await new Promise<void>((resolve) =>
			app.runCallback(read, {
				onExit: (exit) => {
					expect(exit._tag).toBe("Success");
					resolve();
				},
			}),
		);
		await app.dispose();
		await diagnostics.flush();
		const saved = await records(directory);
		expect(
			saved.filter((r) => r.type === "span" && r.span_name === "agent.request"),
		).toHaveLength(6);
		expect(
			saved.some(
				(r) => r.type === "log" && r.event === "HTTP runtime setup failed",
			),
		).toBe(true);
		expect(
			saved.some(
				(r) => r.type === "log" && r.event === "Application shutdown failed",
			),
		).toBe(true);
		await expect(app.runPromise(read)).rejects.toThrow(
			"ManagedRuntime disposed",
		);
	});
	it("retains the actual failed connection operation before IPC projects a safe rejection", async () => {
		const { directory, diagnostics } = await fixture();
		const repository = await Effect.runPromise(
			createAgentConnections({
				storage: {
					read: () =>
						Effect.succeed({
							version: 1,
							revision: 0,
							connections: [
								{
									id: "local",
									name: "Local",
									kind: "hermes",
									baseURL: "http://localhost:8642/",
								},
							],
							cleanupRefs: [],
						}),
					write: () => Effect.void,
				},
				credentials: {
					store: () => Effect.succeed("a8ab5f08-bf8d-4940-8790-7ea406d9cbec"),
					resolve: () => Effect.succeed(Redacted.make("private-key")),
					remove: () => Effect.void,
				},
			}),
		);
		const controller = createAgentConnectionsController({
			diagnostics,
			repository,
			managementId: () => 42,
			renderer: "file:///open-quake/renderer/index.html",
			operations: {
				health: () =>
					Effect.fail(
						new RuntimeUnavailable(
							Object.assign(new TypeError("private provider URL"), {
								code: "ECONNREFUSED",
							}),
						),
					),
			},
		});
		try {
			const reply = await controller.request(
				{
					senderId: 42,
					mainFrame: true,
					frameURL: "file:///open-quake/renderer/index.html",
				},
				{ type: "test", id: "local" },
			);
			expect(reply._tag).toBe("rejected");
			await diagnostics.flush();
			const saved = await records(directory);
			const failed = saved.find(
				(r) =>
					r.type === "span" &&
					r.span_name === "agent.connection" &&
					r.outcome === "failure",
			);
			expect(failed).toBeDefined();
			expect(JSON.stringify(failed)).toContain("ECONNREFUSED");
			expect(JSON.stringify(failed)).toContain(
				"AGENT.HTTP.CONNECTION.UNAVAILABLE",
			);
			expect(JSON.stringify(saved)).not.toContain("private-key");
			expect(JSON.stringify(saved)).not.toContain("private provider URL");
		} finally {
			controller.dispose();
		}
	});
});

it.each([
	"FirmwareUpdates.shutdown",
	"HardwareControls.holdChord",
	"ArrangementState.read",
	"ArrangementState.save",
	"NativeDisplay.runTool",
	"NativeDisplay.windowsProbe",
	"NativeDisplay.windowsExtend",
	"PanelPower.setCount",
	"DisplayPrompts.prepareWindows",
])("retains the allowlisted diagnostic span %s", (name) => {
	expect(safeSpanName(name)).toBe(name);
});
