import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	Deferred,
	Effect,
	Exit,
	Fiber,
	Layer,
	ManagedRuntime,
	Option,
	Redacted,
	Schema,
	Scope,
	Stream,
	TestClock,
	TestContext,
} from "effect";
import { describe, expect, it, vi } from "vitest";
import { defaultAssistantSettings } from "../../../../../packages/device/src/profiles/assistant-contracts";
import {
	SessionId,
	TurnId,
} from "../../../../../packages/edge/src/chat/chat-contracts";
import {
	EMPTY_HA_STORE,
	HaStore,
} from "../../../../../packages/edge/src/home-assistant/ha-contracts";
import {
	HaPorts,
	HomeAssistantService,
} from "../../../../../packages/edge/src/home-assistant/ha-service";
import {
	GridVoiceRuntime,
	VoiceSurface,
	VoiceSurfacePublisher,
	VoiceTonePort,
} from "../../../../../packages/edge/src/voice/surface";
import { CHAT_DISCONNECT, CHAT_EVENT, CHAT_REQUEST } from "../../shared/chat";
import type { VoiceSurfaceEvent } from "../../shared/voice-surface";
import { createAgentHttpVoiceAdapter } from "../agent-http/voice-adapter";
import { prepareDesktopModule } from "../diagnostics/module";
import type { AssistantHaPort } from "./assistant-ha";
import { createAssistantHaPort } from "./assistant-ha-port";
import { createModelCredentials } from "./credentials";
import { createDirectChat, profileFromModel } from "./host";
import { createDirectChatBridge } from "./preload";
import { decodeChatRequest, makeDesktopChatConnection } from "./rpc-server";
import { createDirectChatVoice } from "./voice";

const sessionId = () => Schema.decodeUnknownSync(SessionId)(randomUUID());
const turnId = () => Schema.decodeUnknownSync(TurnId)(randomUUID());
const packet = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
function fixtureServer() {
	const calls: {
		path: string;
		auth: string | undefined;
		body: {
			temperature?: number | undefined;
			top_p?: number | undefined;
			enable_search?: boolean | undefined;
			enable_thinking?: boolean | undefined;
			model: string;
			messages: readonly { readonly role: string; readonly content: string }[];
		};
	}[] = [];
	let release: (() => void) | undefined;
	let disconnected: (() => void) | undefined;
	const closed = new Promise<void>((resolve) => {
		disconnected = resolve;
	});
	const server = createServer(async (req, res) => {
		let text = "";
		for await (const chunk of req) text += String(chunk);
		const body = Schema.decodeUnknownSync(
			Schema.parseJson(
				Schema.Struct({
					model: Schema.String,
					max_tokens: Schema.optional(Schema.Number),
					temperature: Schema.optional(Schema.Number),
					top_p: Schema.optional(Schema.Number),
					enable_search: Schema.optional(Schema.Boolean),
					enable_thinking: Schema.optional(Schema.Boolean),
					messages: Schema.Array(
						Schema.Struct({ role: Schema.String, content: Schema.String }),
					),
				}),
			),
		)(text);
		calls.push({ path: req.url ?? "", auth: req.headers.authorization, body });
		res.writeHead(200, { "content-type": "text/event-stream" });
		const part = (content: string, finish_reason: string | null = null) =>
			packet({
				id: "fixture",
				model: body.model,
				object: "chat.completion.chunk",
				created: 1,
				choices: [{ index: 0, delta: { content }, finish_reason }],
			});
		const unreported = body.messages.at(-1)?.content === "long without usage";
		const routing = body.messages.some(
			(m) => m.role === "system" && m.content.includes("userRequestAction"),
		);
		const answer = routing
			? JSON.stringify({
					userRequestAction: body.messages
						.at(-1)
						?.content.startsWith("operate HA")
						? "operatingEquipment"
						: "standardChat",
					searchOptions: { shouldDoWebSearch: false, searchString: "" },
				})
			: body.messages.some((m) =>
						m.content.startsWith("Choose one Home Assistant action"),
					)
				? JSON.stringify({
						entity_id:
							body.messages.at(-1)?.content === "operate HA denied"
								? "light.denied"
								: "light.allowed",
						service: "toggle",
						service_data: {},
					})
				: "fixture answer";
		res.write(part(unreported ? "界".repeat(800) : answer));
		if (body.messages.at(-1)?.content === "block") {
			res.on("close", () => disconnected?.());
			release = () => res.end();
			return;
		}
		res.write(part("", "stop"));
		if (!unreported)
			res.write(
				packet({
					id: "fixture",
					model: body.model,
					created: 1,
					choices: [],
					usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
				}),
			);
		res.end("data: [DONE]\n\n");
	});
	return { server, calls, closed, release: () => release?.() };
}
async function fixture(
	sampling: { temperature?: number; topP?: number } = {},
	provider = "generic",
	initialModel = "fixture-model",
	homeAssistant?: AssistantHaPort,
	extra: Pick<
		Parameters<typeof createDirectChat>[0],
		"fetch" | "keySettings"
	> = {},
) {
	const directory = await mkdtemp(join(tmpdir(), "oq-direct-chat-"));
	const endpoint = fixtureServer();
	await new Promise<void>((resolve) =>
		endpoint.server.listen(0, "127.0.0.1", resolve),
	);
	const address = endpoint.server.address();
	if (!address || typeof address === "string") throw new Error("port");
	const values = new Map<string, string>();
	const creds = await Effect.runPromise(
		createModelCredentials({
			put: async (value) => {
				const ref = randomUUID();
				values.set(ref, value);
				return ref;
			},
			get: async (ref) => {
				const value = values.get(ref);
				if (!value) throw new Error("missing");
				return value;
			},
			remove: async (ref) => {
				values.delete(ref);
			},
		}),
	);
	const reference = await Effect.runPromise(
		creds.management.store(Redacted.make("fixture-key")),
	);
	let selectedProvider = provider;
	let model = initialModel;
	let role: "none" | "default" | "fallback" = "default";
	let maxTokens = 512;
	let baseUrl = `http://127.0.0.1:${address.port}/v1`;
	const host = createDirectChat({
		...extra,
		directory,
		...(homeAssistant ? { homeAssistant } : {}),
		credentials: creds.ai,
		models: () =>
			Effect.succeed([
				{
					id: "configured",
					role,
					provider: selectedProvider,
					model,
					baseUrl,
					maxTokens,
					credentialRef: reference,
					...sampling,
				},
			]),
	});
	const listeners = new Set<(event: unknown, input: unknown) => void>();
	const scope = await host.runtime.runPromise(Scope.make());
	const connection = await host.runtime.runPromise(
		makeDesktopChatConnection(host, (message) => {
			for (const listener of listeners) listener({}, message);
		}).pipe(Scope.extend(scope)),
	);
	const bridge = createDirectChatBridge({
		invoke: async (channel, input) => {
			if (channel === CHAT_REQUEST)
				return host.runtime.runPromise(connection.write(input));
			if (channel === CHAT_DISCONNECT)
				return host.runtime.runPromise(Scope.close(scope, Exit.void));
			throw new Error("channel");
		},
		on: (channel, callback) => {
			expect(channel).toBe(CHAT_EVENT);
			listeners.add(callback);
		},
		removeListener: (_channel, callback) => listeners.delete(callback),
	});
	return {
		host,
		bridge,
		endpoint,
		reference,
		creds,
		setBaseUrl: (value: string) => {
			baseUrl = value;
		},
		setMaxTokens: (value: number) => {
			maxTokens = value;
		},
		changeRole: (value: typeof role) => {
			role = value;
		},
		changeProvider: (value: string) => {
			selectedProvider = value;
		},
		changeModel: (value: string) => {
			model = value;
		},
		async close() {
			await bridge.dispose();
			await host.dispose();
			endpoint.release();
			endpoint.server.closeAllConnections();
			await new Promise<void>((resolve) =>
				endpoint.server.close(() => resolve()),
			);
			await rm(directory, { recursive: true });
		},
	};
}

function voiceFixture(
	host: ReturnType<typeof createDirectChat>,
	publish: (event: VoiceSurfaceEvent) => Effect.Effect<void>,
	decorate = false,
	wakeChatWindow = Effect.void,
) {
	let direct:
		| Effect.Effect.Success<ReturnType<typeof createDirectChatVoice>>
		| undefined;
	const fallback = GridVoiceRuntime.of({
		select: () => Effect.void,
		startCapture: () => Effect.void,
		releaseCapture: () => Effect.void,
		cancelCapture: () => Effect.void,
		cancelFlow: () => Effect.void,
		sendText: () => Effect.die("old path"),
	});
	const voice = ManagedRuntime.make(
		Layer.scoped(
			GridVoiceRuntime,
			Effect.gen(function* () {
				direct = yield* createDirectChatVoice(host, fallback, wakeChatWindow);
				return decorate
					? (yield* createAgentHttpVoiceAdapter(
							{
								selected: () => Effect.succeed(undefined),
								stream: () => Stream.die("external stream must not run"),
								clear: () => Effect.die("external clear must not run"),
								cancel: () => Effect.die("external cancel must not run"),
								generation: () => 0,
							},
							direct.runtime,
						)).runtime
					: direct.runtime;
			}),
		).pipe(
			Layer.provideMerge(
				VoiceSurface.Default.pipe(
					Layer.provide(
						Layer.mergeAll(
							Layer.succeed(VoiceSurfacePublisher, { publish }),
							Layer.succeed(VoiceTonePort, { play: () => Effect.void }),
						),
					),
				),
			),
		),
	);
	return {
		voice,
		send: (
			request: Parameters<NonNullable<typeof direct>["sendTranscript"]>[0],
		) =>
			Effect.suspend(() =>
				direct ? direct.sendTranscript(request) : Effect.die("missing runtime"),
			),
	};
}

it.each([
	{ wake: true, voice: false, type: "aiChat", expected: 1 },
	{ wake: true, voice: true, type: "aiChat", expected: 1 },
	{ wake: false, voice: false, type: "aiChat", expected: 0 },
	{ wake: true, voice: false, type: "clawbot", expected: 0 },
] as const)(
	"wakes saved assistant selection without inference: $wake/$voice/$type",
	async ({ wake, voice, type, expected }) => {
		const f = await fixture({}, "generic", "fixture-model", undefined, {
			keySettings: () =>
				Effect.succeed({
					...defaultAssistantSettings(),
					useAgent: false,
					enableVoiceInput: voice,
					enableWakeTalkWindow: wake,
				}),
		});
		const activate = vi.fn();
		const v = voiceFixture(
			f.host,
			() => Effect.void,
			false,
			Effect.sync(activate),
		);
		try {
			await v.voice.runPromise(
				GridVoiceRuntime.pipe(
					Effect.flatMap((runtime) =>
						runtime.select("device", "1,1", type, Option.none()),
					),
				),
			);
			expect(activate).toHaveBeenCalledTimes(expected);
			expect(f.endpoint.calls).toHaveLength(0);
		} finally {
			await v.voice.dispose();
			await f.close();
		}
	},
);

it("pins a specific saved knob model before edits and dispatches through the actual direct chat consumer", async () => {
	const f = await fixture();
	const events: VoiceSurfaceEvent[] = [];
	const v = voiceFixture(f.host, (event) =>
		Effect.sync(() => {
			events.push(event);
		}),
	);
	try {
		await v.voice.runPromise(GridVoiceRuntime);
		const pinned = await f.host.runtime.runPromise(
			f.host.pinKnobModel("configured", "fixture-model"),
		);
		f.changeModel("later-model");
		const knob = {
			profileId: "profile",
			revision: 7,
			route: "direct" as const,
			providerId: "configured",
			modelId: "fixture-model",
		};
		await v.voice.runPromise(
			v.send({
				serial: "QK",
				keyCode: "0,1",
				agentId: "",
				message: "pinned",
				knob,
				directModel: pinned,
			}),
		);
		await vi.waitFor(() =>
			expect(
				events.some((e) => e._tag === "Chunk" && e.chunk.type === "end"),
			).toBe(true),
		);
		expect(f.endpoint.calls).toHaveLength(1);
		expect(f.endpoint.calls[0]?.body.model).toBe("fixture-model");
		for (const [id, model] of [
			["missing", "later-model"],
			["configured", " "],
		]) {
			expect(
				(
					await f.host.runtime.runPromise(
						f.host.pinKnobModel(id ?? "", model ?? "").pipe(Effect.either),
					)
				)._tag,
			).toBe("Left");
		}
		const custom = await f.host.runtime.runPromise(
			f.host.pinKnobModel("configured", "fixture-model"),
		);
		expect(custom.profile.modelId).toBe("fixture-model");
		const denied = await v.voice.runPromise(
			v
				.send({
					serial: "QK",
					keyCode: "0,1",
					agentId: "",
					message: "must not fall back",
					knob,
				})
				.pipe(Effect.either),
		);
		expect(denied._tag).toBe("Left");
		expect(f.endpoint.calls).toHaveLength(1);
		f.setBaseUrl("http://remote.invalid/v1?api_key=must-not-run");
		expect(
			(
				await f.host.runtime.runPromise(
					f.host.pinKnobModel("configured", "later-model").pipe(Effect.either),
				)
			)._tag,
		).toBe("Left");
		f.setBaseUrl("https://example.invalid/v1");
		await Effect.runPromise(f.creds.management.remove(f.reference));
		expect(
			(
				await f.host.runtime.runPromise(
					f.host.pinKnobModel("configured", "later-model").pipe(Effect.either),
				)
			)._tag,
		).toBe("Left");
	} finally {
		await v.voice.dispose();
		await f.close();
	}
});

describe("desktop chat RPC through actual SDK and HTTP", () => {
	it.each([
		"moonshot-v1-8k",
		"moonshot-v1-32k",
		"moonshot-v1-128k",
		"kimi-k2-turbo",
		"kimi-k2-thinking",
		"kimi-k2-thinking-turbo",
	])(
		"preserves legacy Moonshot requests for %s before and after canonicalization",
		async (model) => {
			for (const provider of ["moonshot", "kimi"]) {
				const f = await fixture(
					{ temperature: 0.4, topP: 0.8 },
					provider,
					model,
				);
				try {
					const session = sessionId();
					await f.bridge.submit({
						sessionId: session,
						turnId: turnId(),
						text: "legacy",
					});
					await vi.waitFor(async () =>
						expect(
							(await f.bridge.history(session)).turns[0]?.snapshot.terminal,
						).toMatchObject({ _tag: "Some", value: { outcome: "completed" } }),
					);
					expect(f.endpoint.calls).toHaveLength(1);
					expect(f.endpoint.calls[0]?.body).toMatchObject({
						model,
						temperature: 0.4,
						top_p: 0.8,
					});
					expect(f.endpoint.calls[0]?.body).not.toHaveProperty("thinking");
				} finally {
					await f.close();
				}
			}
		},
	);

	it.each([
		"gpt-4o",
		"gpt-4o-mini",
		"gpt-4o-2024-08-06",
		"gpt-4.1",
		"gpt-4.1-mini",
		"gpt-4.1-nano-2025-04-14",
	])(
		"sends saved OpenAI sampling through actual RPC and SDK for %s",
		async (model) => {
			const f = await fixture({ temperature: 0, topP: 1 }, "openai", model);
			try {
				const session = sessionId();
				await f.bridge.submit({
					sessionId: session,
					turnId: turnId(),
					text: "sampling",
				});
				await vi.waitFor(async () =>
					expect(
						(await f.bridge.history(session)).turns[0]?.snapshot.terminal,
					).toMatchObject({ _tag: "Some", value: { outcome: "completed" } }),
				);
				expect(f.endpoint.calls).toHaveLength(1);
				expect(f.endpoint.calls[0]?.body).toMatchObject({
					model,
					temperature: 0,
					top_p: 1,
				});
			} finally {
				await f.close();
			}
		},
	);

	it.each([{}, { temperature: 0, topP: 1 }, { temperature: 2, topP: 0 }])(
		"sends saved sampling through actual RPC and SDK, preserving omission %j",
		async (sampling) => {
			const f = await fixture(sampling);
			try {
				const session = sessionId();
				await f.bridge.submit({
					sessionId: session,
					turnId: turnId(),
					text: "sampling",
				});
				await vi.waitFor(async () =>
					expect(
						(await f.bridge.history(session)).turns[0]?.snapshot.terminal,
					).toMatchObject({ _tag: "Some", value: { outcome: "completed" } }),
				);
				const body = f.endpoint.calls[0]?.body;
				if (sampling.temperature === undefined)
					expect(body).not.toHaveProperty("temperature");
				else expect(body?.temperature).toBe(sampling.temperature);
				if (sampling.topP === undefined)
					expect(body).not.toHaveProperty("top_p");
				else expect(body?.top_p).toBe(sampling.topP);
			} finally {
				await f.close();
			}
		},
	);

	it("keeps an SDK reply without provider usage completed beyond the byte estimate reserve", async () => {
		const f = await fixture();
		try {
			const session = sessionId(),
				turn = turnId();
			await f.bridge.submit({
				sessionId: session,
				turnId: turn,
				text: "long without usage",
			});
			await vi.waitFor(async () => {
				const saved = await f.bridge.history(session);
				expect(saved.turns[0]?.snapshot.terminal).toMatchObject({
					_tag: "Some",
					value: { outcome: "completed", usage: { provenance: "estimated" } },
				});
				expect(saved.turns[0]?.snapshot.text).toBe("界".repeat(800));
			});
			await f.bridge.submit({
				sessionId: session,
				turnId: turnId(),
				text: "next",
			});
			await vi.waitFor(() => expect(f.endpoint.calls).toHaveLength(2));
			expect(f.endpoint.calls[1]?.body.messages).toContainEqual({
				role: "assistant",
				content: "界".repeat(800),
			});
		} finally {
			await f.close();
		}
	});
	it("classifies only literal loopback hosts as local provider endpoints", () => {
		for (const [hostname, expected] of [
			["127.0.0.1", "loopback"],
			["127.50.2.3", "loopback"],
			["localhost", "loopback"],
			["[::1]", "loopback"],
			["127.example.com", "remote"],
			["provider.example.com", "remote"],
		] as const) {
			expect(
				profileFromModel({
					id: "row",
					role: "default",
					provider: "generic",
					model: "fixture",
					baseUrl: `https://${hostname}/v1`,
					maxTokens: 512,
					credentialRef: "00000000-0000-4000-8000-000000000001",
				}).endpointPolicy,
			).toBe(expected);
		}
	});
	it("keeps large saved output limits inside the conservative context window", async () => {
		const f = await fixture();
		try {
			f.setMaxTokens(16384);
			await f.bridge.submit({
				sessionId: sessionId(),
				turnId: turnId(),
				text: "hello",
			});
			await vi.waitFor(() => expect(f.endpoint.calls).toHaveLength(1));
			expect(f.endpoint.calls[0]?.body).toMatchObject({ max_tokens: 1024 });
		} finally {
			await f.close();
		}
	});

	it("dispatches saved model/key, streams once, continues durable history and keeps owner out of RPC", async () => {
		const f = await fixture();
		try {
			const session = sessionId(),
				turn = turnId();
			await f.bridge.submit({
				sessionId: session,
				turnId: turn,
				text: "  hello\n",
			});
			const text: string[] = [];
			await new Promise<void>((resolve, reject) => {
				const off = f.bridge.subscribe(
					session,
					turn,
					(delivery) => {
						if (delivery._tag === "snapshot") {
							text.push(delivery.snapshot.text);
							if (delivery.snapshot.terminal._tag === "Some") {
								off();
								resolve();
							}
						} else if (delivery.chunk.type === "answer")
							text.push(delivery.chunk.textDelta);
						else if (delivery.chunk.type === "end") {
							off();
							resolve();
						}
					},
					(code) => reject(new Error(code)),
				);
			});
			expect(text.join("")).toBe("fixture answer");
			expect(f.endpoint.calls).toHaveLength(1);
			expect(f.endpoint.calls[0]).toMatchObject({
				path: "/v1/chat/completions",
				auth: "Bearer fixture-key",
				body: { model: "fixture-model" },
			});
			f.changeModel("another-model");
			const next = turnId();
			await f.bridge.submit({ sessionId: session, turnId: next, text: "next" });
			await new Promise<void>((resolve, reject) => {
				const off = f.bridge.subscribe(
					session,
					next,
					(event) => {
						if (
							(event._tag === "snapshot" &&
								event.snapshot.terminal._tag === "Some") ||
							(event._tag === "chunk" && event.chunk.type === "end")
						) {
							off();
							resolve();
						}
					},
					(code) => reject(new Error(code)),
				);
			});
			expect(f.endpoint.calls[1]?.body.model).toBe("another-model");
			expect(
				f.endpoint.calls[1]?.body.messages.some(
					(m) => m.role === "assistant" && m.content === "fixture answer",
				),
			).toBe(true);
			const history = await f.bridge.history(session);
			expect(history.turns).toHaveLength(2);
			expect(JSON.stringify(history)).not.toContain("desktop-user");
			expect(JSON.stringify(history)).not.toContain("fixture-key");
			await f.bridge.rename(session, "Manual title");
			expect((await f.bridge.list())[0]?.title).toBe("Manual title");
			await f.bridge.clear(session);
			expect(await f.bridge.list()).toEqual([]);
		} finally {
			await f.close();
		}
	}, 10000);
	it("physically cancels a blocked provider and ends once", async () => {
		const f = await fixture();
		try {
			const session = sessionId(),
				turn = turnId();
			await f.bridge.submit({
				sessionId: session,
				turnId: turn,
				text: "block",
			});
			await new Promise<void>((resolve, reject) => {
				const off = f.bridge.subscribe(
					session,
					turn,
					(event) => {
						if (
							(event._tag === "snapshot" && event.snapshot.text) ||
							(event._tag === "chunk" && event.chunk.type === "answer")
						) {
							off();
							resolve();
						}
					},
					(code) => reject(new Error(code)),
				);
			});
			await f.bridge.cancel(session, turn);
			await f.endpoint.closed;
			expect((await f.bridge.snapshot(session, turn)).terminal).toMatchObject({
				_tag: "Some",
				value: { outcome: "cancelled" },
			});
			expect(f.endpoint.calls).toHaveLength(1);
		} finally {
			await f.close();
		}
	}, 10000);
	it("removes renderer authority/trace fields and rejects unknown methods", () => {
		expect(
			decodeChatRequest({
				_tag: "Request",
				id: "1",
				tag: "chat.list",
				payload: undefined,
				headers: [["authorization", "unsafe"]],
				traceId: "spoof",
				owner: "spoof",
			}),
		).toEqual({
			_tag: "Request",
			id: "1",
			tag: "chat.list",
			payload: undefined,
			headers: [],
		});
		expect(
			decodeChatRequest({
				_tag: "Request",
				id: "1",
				tag: "chat.exec",
				payload: {},
				headers: [],
			}),
		).toBeUndefined();
	});
	it("rejects oversized method inputs and headers before RPC dispatch", () => {
		const base = {
			_tag: "Request",
			id: "1",
			tag: "chat.submit",
			headers: [],
			payload: { sessionId: sessionId(), turnId: turnId(), text: "valid" },
		};
		expect(decodeChatRequest(base)).toBeDefined();
		expect(
			decodeChatRequest({
				...base,
				payload: { ...base.payload, text: "x".repeat(32769) },
			}),
		).toBeUndefined();
		expect(
			decodeChatRequest({ ...base, payload: { ...base.payload, text: "   " } }),
		).toBeUndefined();
		expect(
			decodeChatRequest({
				...base,
				payload: { ...base.payload, secret: "unsupported" },
			}),
		).toBeUndefined();
		expect(
			decodeChatRequest({
				...base,
				headers: Array.from({ length: 17 }, () => ["key", "value"]),
			}),
		).toBeUndefined();
		expect(
			decodeChatRequest({ ...base, headers: [["key", "x".repeat(1025)]] }),
		).toBeUndefined();
		const pasted = "  paragraph\n";
		expect(
			decodeChatRequest({
				...base,
				payload: { ...base.payload, text: pasted },
			}),
		).toMatchObject({ payload: { text: pasted } });
	});
	it("routes finalized voice through the real SDK and cancels without reentering its lock", async () => {
		const f = await fixture();
		const events: VoiceSurfaceEvent[] = [];
		let direct:
			| Effect.Effect.Success<ReturnType<typeof createDirectChatVoice>>
			| undefined;
		const fallback = GridVoiceRuntime.of({
			select: () => Effect.void,
			startCapture: () => Effect.void,
			releaseCapture: () => Effect.void,
			cancelCapture: () => Effect.void,
			cancelFlow: (serial, keyCode) =>
				direct?.cancelText(serial, keyCode) ?? Effect.void,
			sendText: () => Effect.die("old path"),
		});
		const voice = ManagedRuntime.make(
			Layer.scoped(
				GridVoiceRuntime,
				Effect.gen(function* () {
					direct = yield* createDirectChatVoice(f.host, fallback);
					return direct.runtime;
				}),
			).pipe(
				Layer.provideMerge(
					VoiceSurface.Default.pipe(
						Layer.provide(
							Layer.mergeAll(
								Layer.succeed(VoiceSurfacePublisher, {
									publish: (event) =>
										Effect.sync(() => {
											events.push(event);
										}),
								}),
								Layer.succeed(VoiceTonePort, { play: () => Effect.void }),
							),
						),
					),
				),
			),
		);
		try {
			const runtime = await voice.runPromise(GridVoiceRuntime);
			const request = {
				serial: "fixture",
				keyCode: "1,5",
				agentId: "main",
				message: "block",
			};
			await voice.runPromise(
				Effect.suspend(() =>
					direct
						? direct.sendTranscript(request)
						: Effect.die("missing runtime"),
				),
			);
			await vi.waitFor(() =>
				expect(
					events.some((e) => e._tag === "Chunk" && e.chunk.type === "answer"),
				).toBe(true),
			);
			expect(events.find((e) => e._tag === "TurnStarted")).toMatchObject({
				source: "voice",
				prompt: "block",
			});
			await voice.runPromise(
				runtime
					.cancelFlow(request.serial, request.keyCode)
					.pipe(Effect.timeout("1 second")),
			);
			await f.endpoint.closed;
			expect(f.endpoint.calls).toHaveLength(1);
		} finally {
			await voice.dispose();
			await f.close();
		}
	}, 10000);
	it("drains buffered voice chunks and the terminal stage before cancellation returns", async () => {
		const f = await fixture();
		const events: VoiceSurfaceEvent[] = [];
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		let entered = false;
		const v = voiceFixture(f.host, (event) =>
			Effect.gen(function* () {
				if (event._tag === "Chunk" && event.chunk.type === "answer") {
					entered = true;
					yield* Effect.promise(() => blocked);
				}
				events.push(event);
			}),
		);
		try {
			const runtime = await v.voice.runPromise(GridVoiceRuntime);
			await v.voice.runPromise(
				v.send({
					serial: "fixture",
					keyCode: "1,5",
					agentId: "main",
					message: "block",
				}),
			);
			await vi.waitFor(() => expect(entered).toBe(true));
			let finished = false;
			const cancelling = v.voice
				.runPromise(runtime.cancelFlow("fixture", "1,5"))
				.then(() => {
					finished = true;
				});
			await f.endpoint.closed;
			expect(finished).toBe(false);
			release();
			await cancelling;
			expect(
				events.filter((e) => e._tag === "Chunk" && e.chunk.type === "end"),
			).toHaveLength(1);
			expect(
				events.filter((e) => e._tag === "Stage" && e.stage._tag === "idle"),
			).toHaveLength(1);
			expect(
				await v.voice.runPromise(VoiceSurface.activeFlow("fixture")),
			).toMatchObject({ _tag: "None" });
		} finally {
			release();
			await v.voice.dispose();
			await f.close();
		}
	}, 10000);
	it("cancels and drains acceptance interrupted by a replacement capture", async () => {
		const f = await fixture();
		const events: VoiceSurfaceEvent[] = [];
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		let accepted: { sessionId: SessionId; turnId: TurnId } | undefined;
		const host = {
			...f.host,
			submit: (input: Parameters<typeof f.host.submit>[0], scope?: string) =>
				f.host.submit(input, scope).pipe(
					Effect.tap(() => {
						accepted = input;
						return Effect.promise(() => blocked);
					}),
				),
		};
		const v = voiceFixture(host, (event) =>
			Effect.sync(() => {
				events.push(event);
			}),
		);
		try {
			await v.voice.runPromise(GridVoiceRuntime);
			const caller = v.voice.runFork(
				v.send({
					serial: "fixture",
					keyCode: "1,5",
					agentId: "main",
					message: "block",
				}),
			);
			await vi.waitFor(() => expect(accepted).toBeDefined());
			const interrupting = v.voice.runPromise(Fiber.interrupt(caller));
			release();
			await interrupting;
			await f.endpoint.closed;
			if (!accepted) throw new Error("submission not observed");
			expect(
				(
					await f.host.runtime.runPromise(
						f.host.snapshot(accepted.sessionId, accepted.turnId),
					)
				).terminal,
			).toMatchObject({ _tag: "Some", value: { outcome: "cancelled" } });
			expect(
				events.filter((e) => e._tag === "Chunk" && e.chunk.type === "end"),
			).toHaveLength(1);
			expect(
				await v.voice.runPromise(VoiceSurface.activeFlow("fixture")),
			).toMatchObject({ _tag: "None" });
			await v.voice.runPromise(
				v.send({
					serial: "fixture",
					keyCode: "1,5",
					agentId: "main",
					message: "next",
				}),
			);
			await vi.waitFor(() => expect(f.endpoint.calls).toHaveLength(2));
		} finally {
			release();
			await v.voice.dispose();
			await f.close();
		}
	}, 10000);

	it("closing a renderer RPC connection aborts only the turns that connection submitted", async () => {
		const f = await fixture();
		try {
			const session = sessionId(),
				turn = turnId();
			await f.bridge.submit({
				sessionId: session,
				turnId: turn,
				text: "block",
			});
			await vi.waitFor(() => expect(f.endpoint.calls).toHaveLength(1));
			await f.bridge.dispose();
			await f.endpoint.closed;
			expect(
				(await f.host.runtime.runPromise(f.host.snapshot(session, turn)))
					.terminal,
			).toMatchObject({ _tag: "Some", value: { outcome: "cancelled" } });
		} finally {
			await f.close();
		}
	}, 10000);
});

it("AI-010: pins an in-flight model, refreshes the next submission and revokes a removed key", async () => {
	const f = await fixture();
	try {
		const firstSession = sessionId(),
			firstTurn = turnId();
		await f.bridge.submit({
			sessionId: firstSession,
			turnId: firstTurn,
			text: "block",
		});
		await vi.waitFor(() => expect(f.endpoint.calls).toHaveLength(1));
		f.changeModel("edited-model");
		f.setMaxTokens(1024);
		expect(f.endpoint.calls[0]?.body.model).toBe("fixture-model");
		await f.bridge.submit({
			sessionId: sessionId(),
			turnId: turnId(),
			text: "next request",
		});
		await vi.waitFor(() => expect(f.endpoint.calls).toHaveLength(2));
		expect(f.endpoint.calls[1]).toMatchObject({
			auth: "Bearer fixture-key",
			body: { model: "edited-model", max_tokens: 1024 },
		});
		expect(
			(await f.bridge.snapshot(firstSession, firstTurn)).terminal._tag,
		).toBe("None");
		await Effect.runPromise(f.creds.management.remove(f.reference));
		await vi.waitFor(async () =>
			expect(
				(await f.bridge.snapshot(firstSession, firstTurn)).terminal,
			).toMatchObject({
				_tag: "Some",
				value: { outcome: "failed", errorCode: "AI.PROVIDER.AUTH_REVOKED" },
			}),
		);
		const removedSession = sessionId(),
			removedTurn = turnId();
		await f.bridge.submit({
			sessionId: removedSession,
			turnId: removedTurn,
			text: "removed key",
		});
		await vi.waitFor(async () =>
			expect(
				(await f.bridge.snapshot(removedSession, removedTurn)).terminal,
			).toMatchObject({
				_tag: "Some",
				value: { outcome: "failed", errorCode: "AI.PROVIDER.AUTH_REVOKED" },
			}),
		);
		expect(f.endpoint.calls).toHaveLength(2);
	} finally {
		await f.close();
	}
});

it("AI-041/054/055/056/059/062 binds saved assistant settings to subsequent fake-provider turns", async () => {
	const f = await fixture();
	try {
		const sid = sessionId();
		const settings = {
			...defaultAssistantSettings(),
			useAgent: false,
			modelRowId: "configured",
			modelId: "my-custom-model",
			roleId: -1,
			customPrompt: "Custom system role",
			temperature: 1.4,
			topP: 0.65,
		};
		const first = await f.host.runtime.runPromise(
			f.host.submit(
				{ sessionId: sid, turnId: turnId(), text: "one" },
				"main",
				undefined,
				settings,
			),
		);
		await f.host.runtime.runPromise(Stream.runDrain(first.events));
		expect(f.endpoint.calls[0]?.body).toMatchObject({
			model: "my-custom-model",
			temperature: 1.4,
			top_p: 0.65,
			messages: [
				{ role: "system", content: "Custom system role" },
				{ role: "user", content: "one" },
			],
		});
		const second = await f.host.runtime.runPromise(
			f.host.submit(
				{ sessionId: sid, turnId: turnId(), text: "two" },
				"main",
				undefined,
				{
					...settings,
					customPrompt: "Next role",
					modelId: "next-custom-model",
				},
			),
		);
		await f.host.runtime.runPromise(Stream.runDrain(second.events));
		expect(f.endpoint.calls[1]?.body.messages).toEqual([
			{ role: "system", content: "Next role" },
			{ role: "user", content: "two" },
		]);
		expect(f.endpoint.calls[0]?.body.model).toBe("my-custom-model");
		expect(f.endpoint.calls[1]?.body.model).toBe("next-custom-model");
	} finally {
		await f.close();
	}
});
it("AI-053/058 router switch classifies chat and blocks equipment without dispatch", async () => {
	const f = await fixture();
	try {
		const settings = {
			...defaultAssistantSettings(),
			modelRowId: "configured",
		};
		const turn = await f.host.runtime.runPromise(
			f.host.submit(
				{ sessionId: sessionId(), turnId: turnId(), text: "chat" },
				"main",
				undefined,
				settings,
			),
		);
		await f.host.runtime.runPromise(Stream.runDrain(turn.events));
		expect(f.endpoint.calls).toHaveLength(2);
		expect(f.endpoint.calls[0]?.body.messages[0]?.content).toContain(
			"userRequestAction",
		);
		const blocked = await f.host.runtime.runPromise(
			f.host
				.submit(
					{ sessionId: sessionId(), turnId: turnId(), text: "operate HA" },
					"main",
					undefined,
					{
						...settings,
						homeAssistantControl: true,
						entityIds: ["light.allowed"],
					},
				)
				.pipe(Effect.either),
		);
		if (blocked._tag === "Left") throw blocked.left;
		const chunks = await f.host.runtime.runPromise(
			Stream.runCollect(blocked.right.events),
		);
		expect(Array.from(chunks).at(-1)).toMatchObject({
			type: "end",
			outcome: "failed",
		});
		expect(f.endpoint.calls).toHaveLength(3);
	} finally {
		await f.close();
	}
});

it.each(["allowed", "denied", "revoked"] as const)(
	"AI-058 executes only the current assistant/global HA intersection: %s",
	async (permission) => {
		const executed: string[] = [];
		let reads = 0;
		const f = await fixture({}, "generic", "fixture-model", {
			snapshot: () =>
				Effect.sync(() => ({
					origin: "http://fake.invalid",
					tokenMask: "",
					state: "Connected",
					reason: "",
					certificate: null,
					trusted: [],
					entities: ["light.allowed", "light.denied"].map((entity_id) => ({
						entity_id,
						name: entity_id,
						state: "off",
						area: "",
						attributes: {},
					})),
					services: [
						{ domain: "light", service: "toggle", name: "Toggle", fields: [] },
					],
					allowlist:
						++reads > 1 && permission === "revoked" ? [] : ["light.allowed"],
				})),
			execute: (key) =>
				Effect.sync(() => {
					executed.push(key.entity_id);
				}),
		});
		try {
			const result = await f.host.runtime.runPromise(
				f.host
					.submit(
						{
							sessionId: sessionId(),
							turnId: turnId(),
							text: `operate HA ${permission}`,
						},
						"main",
						undefined,
						{
							...defaultAssistantSettings(),
							homeAssistantControl: true,
							entityIds: ["light.allowed"],
						},
					)
					.pipe(Effect.either),
			);
			if (permission === "allowed") {
				if (result._tag === "Left") throw result.left;
				await f.host.runtime.runPromise(Stream.runDrain(result.right.events));
				expect(executed).toEqual(["light.allowed"]);
			} else {
				if (result._tag === "Left") throw result.left;
				const chunks = await f.host.runtime.runPromise(
					Stream.runCollect(result.right.events),
				);
				expect(Array.from(chunks).at(-1)).toMatchObject({
					type: "end",
					outcome: "failed",
				});
				expect(executed).toEqual([]);
			}
			const prompt = f.endpoint.calls[1]?.body.messages[0]?.content ?? "";
			expect(prompt).toContain("light.allowed");
			expect(prompt).not.toContain("light.denied");
		} finally {
			await f.close();
		}
	},
);

it("AI-059 MGMT-285 sends explicit search/thinking controls and rejects unsupported search before I/O", async () => {
	const f = await fixture({}, "qwen", "qwen3.6-plus");
	try {
		for (const enabled of [false, true]) {
			const turn = await f.host.runtime.runPromise(
				f.host.submit(
					{ sessionId: sessionId(), turnId: turnId(), text: "hello" },
					"main",
					undefined,
					{
						...defaultAssistantSettings(),
						useAgent: false,
						webSearch: enabled,
						thinking: enabled,
					},
				),
			);
			await f.host.runtime.runPromise(Stream.runDrain(turn.events));
			expect(f.endpoint.calls.at(-1)?.body).toMatchObject({
				enable_search: enabled,
				enable_thinking: enabled,
			});
		}
	} finally {
		await f.close();
	}
	const unsupported = await fixture();
	try {
		const result = await unsupported.host.runtime.runPromise(
			unsupported.host
				.submit(
					{ sessionId: sessionId(), turnId: turnId(), text: "hello" },
					"main",
					undefined,
					{ ...defaultAssistantSettings(), useAgent: false, webSearch: true },
				)
				.pipe(Effect.either),
		);
		expect(result._tag).toBe("Left");
		expect(unsupported.endpoint.calls).toHaveLength(0);
	} finally {
		await unsupported.close();
	}
});
it.each([false, true])(
	"AI-056 clears incompatible saved-row sampling for reasoning models, pinned=%s",
	async (isPinned) => {
		const f = await fixture(
			{ temperature: 1.2, topP: 0.8 },
			"openai",
			"gpt-4o",
		);
		try {
			const settings = {
				...defaultAssistantSettings(),
				useAgent: false,
				modelId: "gpt-5.1",
			};
			const pinned = isPinned
				? await f.host.runtime.runPromise(
						f.host.pinKnobModel("configured", "gpt-5.1"),
					)
				: undefined;
			const turn = await f.host.runtime.runPromise(
				f.host.submit(
					{ sessionId: sessionId(), turnId: turnId(), text: "hello" },
					"main",
					pinned,
					settings,
				),
			);
			await f.host.runtime.runPromise(Stream.runDrain(turn.events));
			expect(f.endpoint.calls[0]?.body.model).toBe("gpt-5.1");
			expect(f.endpoint.calls[0]?.body.temperature).toBeUndefined();
			expect(f.endpoint.calls[0]?.body.top_p).toBeUndefined();
		} finally {
			await f.close();
		}
	},
);
it("MGMT-302 resets only the selected key through the production HTTP and direct-chat composition", async () => {
	const f = await fixture();
	const events: VoiceSurfaceEvent[] = [];
	const v = voiceFixture(
		f.host,
		(event) =>
			Effect.sync(() => {
				events.push(event);
			}),
		true,
	);
	try {
		const runtime = await v.voice.runPromise(GridVoiceRuntime);
		const request = {
			serial: "mock-reset",
			keyCode: "1,5",
			agentId: "main",
			message: "first",
		};
		const send = async (keyCode: string, count: number) => {
			await v.voice.runPromise(runtime.sendText({ ...request, keyCode }));
			await vi.waitFor(() =>
				expect(
					events.filter((e) => e._tag === "Chunk" && e.chunk.type === "end"),
				).toHaveLength(count),
			);
		};
		await send("1,5", 1);
		await send("1,6", 2);
		await send("1,5", 3);
		const sessions = () =>
			events.filter((e) => e._tag === "TurnStarted").map((e) => e.sessionId);
		expect(sessions()[2]).toBe(sessions()[0]);
		if (!runtime.resetContext) throw new Error("missing resetContext");
		await v.voice.runPromise(runtime.resetContext(request.serial, "1,5"));
		await send("1,5", 4);
		await send("1,6", 5);
		expect(sessions()[3]).not.toBe(sessions()[0]);
		expect(sessions()[4]).toBe(sessions()[1]);
		expect(
			f.endpoint.calls[3]?.body.messages.filter((m) => m.role === "user"),
		).toHaveLength(1);
		expect(
			f.endpoint.calls[4]?.body.messages.filter((m) => m.role === "user"),
		).toHaveLength(2);
	} finally {
		await v.voice.dispose();
		await f.close();
	}
});

it.each(["busy", "duplicate"] as const)(
	"rejected HA turn never executes equipment: %s",
	async (reason) => {
		const executed: string[] = [];
		const f = await fixture({}, "generic", "fixture-model", {
			snapshot: () =>
				Effect.succeed({
					origin: "http://fake.invalid",
					tokenMask: "",
					state: "Connected",
					reason: "",
					certificate: null,
					trusted: [],
					entities: [
						{
							entity_id: "light.allowed",
							name: "Fake",
							state: "off",
							area: "",
							attributes: {},
						},
					],
					services: [
						{ domain: "light", service: "toggle", name: "Toggle", fields: [] },
					],
					allowlist: ["light.allowed"],
				}),
			execute: (key) =>
				Effect.sync(() => {
					executed.push(key.entity_id);
				}),
		});
		try {
			const sid = sessionId();
			const tid = turnId();
			const first = await f.host.runtime.runPromise(
				f.host.submit({
					sessionId: sid,
					turnId: tid,
					text: reason === "busy" ? "block" : "hello",
				}),
			);
			if (reason === "busy")
				await vi.waitFor(() => expect(f.endpoint.calls).toHaveLength(1));
			else await f.host.runtime.runPromise(Stream.runDrain(first.events));
			const result = await f.host.runtime.runPromise(
				f.host
					.submit(
						{
							sessionId: sid,
							turnId: reason === "busy" ? turnId() : tid,
							text: "operate HA",
						},
						"main",
						undefined,
						{
							...defaultAssistantSettings(),
							homeAssistantControl: true,
							entityIds: ["light.allowed"],
						},
					)
					.pipe(Effect.either),
			);
			expect(result._tag).toBe("Left");
			expect(executed).toEqual([]);
			expect(f.endpoint.calls).toHaveLength(1);
			if (reason === "busy")
				await f.host.runtime.runPromise(f.host.cancel(sid, tid));
		} finally {
			await f.close();
		}
	},
);

it("rechecks session/profile identity after pending HA generation with TestClock", async () => {
	const clock = ManagedRuntime.make(TestContext.TestContext);
	const testClock = await clock.runPromise(TestClock.testClock());
	const entered = await clock.runPromise(Deferred.make<void>());
	const executed: string[] = [];
	let current = true;
	let reads = 0;
	const f = await fixture({}, "generic", "fixture-model", {
		snapshot: () =>
			Effect.gen(function* () {
				if (++reads === 1) {
					yield* Deferred.succeed(entered, undefined);
					yield* Effect.sleep("5 seconds");
				}
				return {
					origin: "http://fake.invalid",
					tokenMask: "",
					state: "Connected" as const,
					reason: "",
					certificate: null,
					trusted: [],
					entities: [
						{
							entity_id: "light.allowed",
							name: "Fake",
							state: "off",
							area: "",
							attributes: {},
						},
					],
					services: [
						{ domain: "light", service: "toggle", name: "Toggle", fields: [] },
					],
					allowlist: ["light.allowed"],
				};
			}).pipe(Effect.withClock(testClock)),
		execute: (key) =>
			Effect.sync(() => {
				executed.push(key.entity_id);
			}),
	});
	try {
		const turn = await f.host.runtime.runPromise(
			f.host.submit(
				{ sessionId: sessionId(), turnId: turnId(), text: "operate HA" },
				"main",
				undefined,
				{
					...defaultAssistantSettings(),
					homeAssistantControl: true,
					entityIds: ["light.allowed"],
				},
				() => current,
			),
		);
		await clock.runPromise(Deferred.await(entered));
		current = false;
		await clock.runPromise(TestClock.adjust("10 seconds"));
		const chunks = await f.host.runtime.runPromise(
			Stream.runCollect(turn.events),
		);
		expect(executed).toEqual([]);
		expect(Array.from(chunks).at(-1)).toMatchObject({
			type: "end",
			outcome: "failed",
		});
	} finally {
		await f.close();
		await clock.dispose();
	}
});

it("pins Auto routing metadata while another session submits plain chat", async () => {
	let release = () => {};
	let entered = () => {};
	const paused = new Promise<void>((resolve) => {
		release = resolve;
	});
	const classifying = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const executed: string[] = [];
	const f = await fixture(
		{},
		"generic",
		"fixture-model",
		{
			snapshot: () =>
				Effect.succeed({
					origin: "http://fake.invalid",
					tokenMask: "",
					state: "Connected",
					reason: "",
					certificate: null,
					trusted: [],
					entities: [
						{
							entity_id: "light.allowed",
							name: "Fake",
							state: "off",
							area: "",
							attributes: {},
						},
					],
					services: [
						{ domain: "light", service: "toggle", name: "Toggle", fields: [] },
					],
					allowlist: ["light.allowed"],
				}),
			execute: (key) =>
				Effect.sync(() => {
					executed.push(key.entity_id);
				}),
		},
		{
			fetch: async (input, init) => {
				if (String(init?.body).includes("userRequestAction")) {
					entered();
					await paused;
				}
				return globalThis.fetch(input, init);
			},
		},
	);
	try {
		const settings = {
			...defaultAssistantSettings(),
			homeAssistantControl: true,
			entityIds: ["light.allowed"],
		};
		const routed = await f.host.runtime.runPromise(
			f.host.submit(
				{ sessionId: sessionId(), turnId: turnId(), text: "operate HA" },
				"main",
				undefined,
				settings,
			),
		);
		await classifying;
		const plain = await f.host.runtime.runPromise(
			f.host.submit(
				{ sessionId: sessionId(), turnId: turnId(), text: "hello" },
				"main",
				undefined,
				{ ...settings, useAgent: false },
			),
		);
		await f.host.runtime.runPromise(Stream.runDrain(plain.events));
		release();
		const chunks = await f.host.runtime.runPromise(
			Stream.runCollect(routed.events),
		);
		expect(Array.from(chunks).at(-1)).toMatchObject({
			type: "end",
			outcome: "completed",
		});
		expect(executed).toEqual(["light.allowed"]);
		expect(f.endpoint.calls).toHaveLength(4);
	} finally {
		release();
		await f.close();
	}
});

it.each(["classification", "action"] as const)(
	"disconnect/profile reset interrupts pending %s before equipment execution",
	async (phase) => {
		const clock = ManagedRuntime.make(TestContext.TestContext);
		const entered = await clock.runPromise(Deferred.make<void>());
		let interrupted = false;
		const executed: string[] = [];
		const f = await fixture(
			{},
			"generic",
			"fixture-model",
			{
				snapshot: () =>
					Effect.succeed({
						origin: "http://fake.invalid",
						tokenMask: "",
						state: "Connected",
						reason: "",
						certificate: null,
						trusted: [],
						entities: [
							{
								entity_id: "light.allowed",
								name: "Fake",
								state: "off",
								area: "",
								attributes: {},
							},
						],
						services: [
							{
								domain: "light",
								service: "toggle",
								name: "Toggle",
								fields: [],
							},
						],
						allowlist: ["light.allowed"],
					}),
				execute: (key) =>
					Effect.sync(() => {
						executed.push(key.entity_id);
					}),
			},
			{
				fetch: async (input, init) => {
					const request = new Request(input, init);
					const body = await request.clone().text();
					if (
						body.includes(
							phase === "classification"
								? "userRequestAction"
								: "Choose one Home Assistant action",
						)
					)
						await clock.runPromise(
							Deferred.succeed(entered, undefined).pipe(
								Effect.zipRight(Effect.sleep("5 seconds")),
								Effect.onInterrupt(() =>
									Effect.sync(() => {
										interrupted = true;
									}),
								),
							),
							{ signal: request.signal },
						);
					return fetch(request);
				},
			},
		);
		const events: VoiceSurfaceEvent[] = [];
		const v = voiceFixture(f.host, (event) =>
			Effect.sync(() => {
				events.push(event);
			}),
		);
		try {
			const runtime = await v.voice.runPromise(GridVoiceRuntime);
			const pinned = await f.host.runtime.runPromise(
				f.host.pinKnobModel("configured", "fixture-model"),
			);
			await v.voice.runPromise(
				v.send({
					serial: "fixture",
					keyCode: "0,1",
					agentId: "main",
					message: "operate HA",
					directModel: pinned,
					knob: {
						profileId: "profile",
						revision: 1,
						route: "direct",
						providerId: "configured",
						modelId: "fixture-model",
						assistantSettings: {
							...defaultAssistantSettings(),
							homeAssistantControl: true,
							entityIds: ["light.allowed"],
						},
					},
				}),
			);
			await clock.runPromise(Deferred.await(entered));
			await v.voice.runPromise(runtime.cancelFlow("fixture", "0,1"));
			await clock.runPromise(TestClock.adjust("10 seconds"));
			expect(interrupted).toBe(true);
			expect(executed).toEqual([]);
			expect(
				events.filter((e) => e._tag === "Chunk" && e.chunk.type === "end"),
			).toMatchObject([{ chunk: { outcome: "cancelled" } }]);
		} finally {
			await v.voice.dispose();
			await f.close();
			await clock.dispose();
		}
	},
);

it.each(["none", "default", "fallback"] as const)(
	"explicit assistant row obeys saved eligibility: %s",
	async (role) => {
		const f = await fixture();
		f.changeRole(role);
		try {
			const result = await f.host.runtime.runPromise(
				f.host
					.submit(
						{ sessionId: sessionId(), turnId: turnId(), text: "hello" },
						"main",
						undefined,
						{
							...defaultAssistantSettings(),
							useAgent: false,
							modelRowId: "configured",
						},
					)
					.pipe(Effect.either),
			);
			if (role === "none") {
				expect(result._tag).toBe("Left");
				expect(f.endpoint.calls).toHaveLength(0);
			} else {
				if (result._tag === "Left") throw result.left;
				await f.host.runtime.runPromise(Stream.runDrain(result.right.events));
				expect(f.endpoint.calls).toHaveLength(1);
			}
		} finally {
			await f.close();
		}
	},
);

it("default assistant typed messages reach Auto routing", async () => {
	const f = await fixture({}, "generic", "fixture-model", undefined, {
		keySettings: () => Effect.succeed(defaultAssistantSettings()),
	});
	const events: VoiceSurfaceEvent[] = [];
	const v = voiceFixture(f.host, (event) =>
		Effect.sync(() => {
			events.push(event);
		}),
	);
	try {
		const runtime = await v.voice.runPromise(GridVoiceRuntime);
		await v.voice.runPromise(
			runtime.sendText({
				serial: "fixture",
				keyCode: "1,1",
				agentId: "main",
				message: "typed hello",
			}),
		);
		await vi.waitFor(() =>
			expect(
				events.some((e) => e._tag === "Chunk" && e.chunk.type === "end"),
			).toBe(true),
		);
		expect(f.endpoint.calls).toHaveLength(2);
		expect(f.endpoint.calls[0]?.body.messages[0]?.content).toContain(
			"userRequestAction",
		);
		expect(f.endpoint.calls[1]?.body.messages.at(-1)?.content).toBe(
			"typed hello",
		);
		expect(events.find((e) => e._tag === "TurnStarted")).toMatchObject({
			source: "typed",
		});
	} finally {
		await v.voice.dispose();
		await f.close();
	}
});

it.each(["cancelled", "superseded"] as const)(
	"production HA composition drops a %s assistant turn queued behind integration work",
	async (ending) => {
		const executed: string[] = [];
		const entities = [
			{
				entity_id: "light.allowed",
				state: "off",
				attributes: {},
				area: "Other",
			},
		];
		let stored: HaStore = { ...EMPTY_HA_STORE, allowlist: ["light.allowed"] };
		let pauseWrite: Promise<void> | undefined;
		let release = () => {};
		let entered = () => {};
		const writing = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const integrations = prepareDesktopModule(
			HomeAssistantService.Default.pipe(
				Layer.provide(
					Layer.succeed(HaPorts, {
						store: {
							read: async () => stored,
							write: async (value) => {
								entered();
								await pauseWrite;
								stored = Schema.decodeUnknownSync(HaStore)(value);
							},
						},
						vault: {
							put: async () => "fake-ref",
							get: async () => "fake-token",
							remove: async () => {},
						},
						open: async () => ({
							entities: async () => entities,
							services: async () => [
								{
									domain: "light",
									service: "toggle",
									name: "Toggle",
									fields: [],
								},
							],
							states: async () => entities,
							execute: async (_domain, _service, data) => {
								executed.push(String(data.entity_id));
							},
							close: () => {},
						}),
						place: async () => {},
					}),
				),
			),
			() => ({}),
		);
		integrations.standalone();
		await integrations.runtime.runPromise(
			HomeAssistantService.connect("http://fake.invalid", "fake-token", true),
		);
		pauseWrite = new Promise<void>((resolve) => {
			release = resolve;
		});
		// Keep the actual HA semaphore occupied without operating equipment.
		const holding = integrations.runtime.runPromise(
			HomeAssistantService.allowlist(["light.allowed"]),
		);
		await writing;
		const calls = vi.spyOn(integrations.runtime, "runPromise");
		const f = await fixture(
			{},
			"generic",
			"fixture-model",
			createAssistantHaPort(() => integrations.runtime),
		);
		let current = true;
		try {
			const session = sessionId(),
				turn = turnId();
			const accepted = await f.host.runtime.runPromise(
				f.host.submit(
					{ sessionId: session, turnId: turn, text: "operate HA" },
					"main",
					undefined,
					{
						...defaultAssistantSettings(),
						homeAssistantControl: true,
						entityIds: ["light.allowed"],
					},
					() => current,
				),
			);
			// Two production snapshots, then execute is queued on the held semaphore.
			await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(3));
			if (ending === "cancelled")
				await f.host.runtime.runPromise(f.host.cancel(session, turn));
			else current = false;
			release();
			await holding;
			await f.host.runtime.runPromise(Stream.runDrain(accepted.events));
			// Join a subsequent locked integration operation so no detached work is left pending.
			await integrations.runtime.runPromise(
				HomeAssistantService.allowlist(["light.allowed"]),
			);
			expect(executed).toEqual([]);
			expect(
				(await f.host.runtime.runPromise(f.host.snapshot(session, turn)))
					.terminal,
			).toMatchObject({
				_tag: "Some",
				value: { outcome: ending === "cancelled" ? "cancelled" : "failed" },
			});
		} finally {
			release();
			await holding;
			await f.close();
			await integrations.runtime.dispose();
		}
	},
);

it.each(["", "qwen3.6-plus", "my-custom-model"])(
	"followed General Settings provider reconciles saved Qwen controls and model on the next turn: %s",
	async (modelId) => {
		const f = await fixture({}, "qwen", "qwen3.6-plus");
		const settings = {
			...defaultAssistantSettings(),
			useAgent: false,
			thinking: true,
			webSearch: true,
			modelId,
		};
		try {
			const submit = async () => {
				const turn = await f.host.runtime.runPromise(
					f.host.submit(
						{ sessionId: sessionId(), turnId: turnId(), text: "hello" },
						"main",
						undefined,
						settings,
					),
				);
				return Array.from(
					await f.host.runtime.runPromise(Stream.runCollect(turn.events)),
				).at(-1);
			};
			expect(await submit()).toMatchObject({
				type: "end",
				outcome: "completed",
			});
			expect(f.endpoint.calls[0]?.body).toMatchObject({
				model: modelId || "qwen3.6-plus",
				enable_thinking: true,
				enable_search: true,
			});
			f.changeProvider("deepseek");
			f.changeModel("deepseek-v4-flash");
			expect(await submit()).toMatchObject({
				type: "end",
				outcome: "completed",
			});
			expect(f.endpoint.calls).toHaveLength(2);
			expect(f.endpoint.calls[1]?.body.model).toBe(
				modelId === "my-custom-model" ? modelId : "deepseek-v4-flash",
			);
			expect(f.endpoint.calls[1]?.body.enable_thinking).toBeUndefined();
			expect(f.endpoint.calls[1]?.body.enable_search).toBeUndefined();
		} finally {
			await f.close();
		}
	},
);
