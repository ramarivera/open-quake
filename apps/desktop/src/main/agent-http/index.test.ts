import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import {
	AgentDraftPort,
	AgentRuntimePort,
} from "../../../../../packages/edge/src/agents/agents-ports";
import { AgentStorage } from "../../../../../packages/edge/src/agents/agents-repository";
import { AgentsService } from "../../../../../packages/edge/src/agents/agents-service";
import { GridVoiceRuntime } from "../../../../../packages/edge/src/voice/surface/index";
import { voiceSurfaceLayer } from "../voice";
import { prepareAgentHttp, registerAgentHttp } from "./index";

vi.mock("electron", () => ({
	app: {},
	ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
	safeStorage: { isEncryptionAvailable: () => false },
}));
afterEach(() => vi.unstubAllGlobals());

it("recognizes saved HTTP configuration before connectivity and after restart without calling the server", async () => {
	const root = await mkdtemp(join(tmpdir(), "oq-runtime-configured-"));
	const fetch = vi.fn(() => {
		throw new Error("Setup must not probe a runtime");
	});
	vi.stubGlobal("fetch", fetch);
	const options = {
		root,
		management: () => undefined,
		renderer: "file:///app/index.html",
		invalidated: async () => {},
		publish: async () => {},
	};
	let runtime = await registerAgentHttp(options);
	try {
		expect(await runtime.configured()).toBe(false);
		await runtime.dispose();
		await writeFile(
			join(root, "connections-v1.json"),
			JSON.stringify({
				version: 1,
				revision: 1,
				cleanupRefs: [],
				connections: [
					{
						id: randomUUID(),
						name: "Offline Hermes",
						kind: "hermes",
						baseURL: "http://127.0.0.1:1",
					},
				],
			}),
		);
		runtime = await registerAgentHttp(options);
		expect(await runtime.configured()).toBe(true);
		expect(runtime.backend.initial.status).toBe("error");
		expect(fetch).not.toHaveBeenCalled();
	} finally {
		await runtime.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

it("keeps direct voice and truthful drafting availability when HTTP acquisition fails", async () => {
	const root = await mkdtemp(join(tmpdir(), "oq-http-unavailable-"));
	const store = join(root, "connections-v1.json");
	await writeFile(store, "{malformed");
	const fetch = vi.fn(() => {
		throw new Error("No HTTP request expected");
	});
	vi.stubGlobal("fetch", fetch);
	const prepared = prepareAgentHttp({
		root,
		management: () => undefined,
		renderer: "file:///app/index.html",
		invalidated: async () => {},
		publish: async () => {},
	});
	const text = vi.fn(() => Effect.void);
	const transcript = vi.fn(() => Effect.void);
	const fallback = GridVoiceRuntime.of({
		select: () => Effect.void,
		startCapture: () => Effect.void,
		releaseCapture: () => Effect.void,
		cancelCapture: () => Effect.void,
		cancelFlow: () => Effect.void,
		sendText: text,
	});
	let voice:
		| Effect.Effect.Success<ReturnType<typeof prepared.createVoiceAdapter>>
		| undefined;
	const agentsLayer = AgentsService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(AgentRuntimePort, prepared.backend),
				Layer.succeed(AgentDraftPort, prepared.drafting),
				Layer.succeed(AgentStorage, {
					read: () => Effect.succeed(Option.none()),
					write: () => Effect.void,
				}),
			),
		),
	);
	const voiceLayer = voiceSurfaceLayer(
		{
			mock: true,
			tones: { play: () => {} },
			runtime: () =>
				Layer.scoped(
					GridVoiceRuntime,
					Effect.gen(function* () {
						voice = yield* prepared.createVoiceAdapter(fallback, transcript);
						return voice.runtime;
					}),
				),
		},
		() => {},
	);
	const application = ManagedRuntime.make(
		Layer.mergeAll(prepared.layer, agentsLayer, voiceLayer),
	);
	prepared.bind(application);
	try {
		await application.runtime();
		expect(await prepared.start()).toBeUndefined();
		if (!voice) throw new Error("Missing voice adapter");
		const request = {
			serial: "fixture",
			keyCode: "1,5",
			agentId: "",
			message: "hello",
		};
		await application.runPromise(voice.runtime.sendText(request));
		await application.runPromise(voice.sendTranscript(request));
		expect(text).toHaveBeenCalledExactlyOnceWith(request);
		expect(transcript).toHaveBeenCalledExactlyOnceWith(request);
		expect(
			(await application.runPromise(AgentsService.view())).draftingAvailable,
		).toBe(false);
		const result = await application.runPromise(
			Effect.either(prepared.drafting.skill({ name: "test", prompt: "draft" })),
		);
		expect(result).toMatchObject({
			_tag: "Left",
			left: { code: "AGENT.DRAFT.UNAVAILABLE" },
		});
		expect(
			await application.runPromise(
				Effect.either(
					AgentsService.request({
						type: "draft-skill",
						name: "test",
						prompt: "draft",
					}),
				),
			),
		).toMatchObject({
			_tag: "Left",
			left: { code: "AGENT.DRAFT.UNAVAILABLE" },
		});
		expect(await readFile(store, "utf8")).toBe("{malformed");
		expect(fetch).not.toHaveBeenCalled();
	} finally {
		await prepared.runtime.dispose();
		await application.dispose();
		await rm(root, { recursive: true, force: true });
	}
});
