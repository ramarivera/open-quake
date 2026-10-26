import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	Effect,
	Exit,
	Fiber,
	Layer,
	ManagedRuntime,
	Redacted,
	Schema,
	Scope,
} from "effect";
import { describe, expect, it, vi } from "vitest";
import {
	SessionId,
	TurnId,
} from "../../../../../packages/edge/src/chat/chat-contracts";
import {
	GridVoiceRuntime,
	VoiceSurface,
	VoiceSurfacePublisher,
	VoiceTonePort,
} from "../../../../../packages/edge/src/voice/surface";
import { CHAT_DISCONNECT, CHAT_EVENT, CHAT_REQUEST } from "../../shared/chat";
import type { VoiceSurfaceEvent } from "../../shared/voice-surface";
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
			temperature?: number;
			top_p?: number;
			model: string;
			messages: { role: string; content: string }[];
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
		const body = JSON.parse(text);
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
		res.write(part(unreported ? "界".repeat(800) : "fixture answer"));
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
	let model = initialModel;
	let maxTokens = 512;
	let baseUrl = `http://127.0.0.1:${address.port}/v1`;
	const host = createDirectChat({
		directory,
		credentials: creds.ai,
		models: () =>
			Effect.succeed([
				{
					id: "configured",
					role: "default",
					provider,
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
				direct = yield* createDirectChatVoice(host, fallback);
				return direct.runtime;
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
			["configured", "fixture-model"],
		]) {
			expect(
				(
					await f.host.runtime.runPromise(
						f.host.pinKnobModel(id ?? "", model ?? "").pipe(Effect.either),
					)
				)._tag,
			).toBe("Left");
		}
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
