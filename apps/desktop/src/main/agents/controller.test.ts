import { Deferred, Effect, Fiber, Layer, ManagedRuntime, Option } from "effect";
import { describe, expect, it } from "vitest";
import type { AgentState } from "../../../../../packages/edge/src/agents/agents-contracts.js";
import { AgentRuntimePort } from "../../../../../packages/edge/src/agents/agents-ports.js";
import { AgentStorage } from "../../../../../packages/edge/src/agents/agents-repository.js";
import { AgentsService } from "../../../../../packages/edge/src/agents/agents-service.js";
import { agentRequestAllowed, createAgentsHandler } from "./controller";

const source = {
	senderId: 17,
	mainFrame: true,
	frameURL: "file:///app/index.html?surface=management",
};
describe("agents IPC real consumer", () => {
	it("authorizes by management identity, top frame and renderer document", () => {
		expect(
			agentRequestAllowed(
				{ ...source, frameURL: "file://untrusted/app/index.html" },
				17,
				"file:///app/index.html",
			),
		).toBe(false);
		for (const renderer of [
			"file:///app/index.html",
			"http://127.0.0.1:5173/index.html",
		]) {
			const frameURL = `${renderer}?surface=management`;
			expect(agentRequestAllowed({ ...source, frameURL }, 17, renderer)).toBe(
				true,
			);
			expect(agentRequestAllowed({ ...source, frameURL }, 99, renderer)).toBe(
				false,
			);
			expect(
				agentRequestAllowed(
					{ ...source, frameURL, mainFrame: false },
					17,
					renderer,
				),
			).toBe(false);
			expect(
				agentRequestAllowed(
					{
						...source,
						frameURL: "https://hostile.test/index.html?surface=management",
					},
					17,
					renderer,
				),
			).toBe(false);
			expect(
				agentRequestAllowed(
					{ ...source, frameURL: "file:///different/index.html" },
					17,
					renderer,
				),
			).toBe(false);
		}
	});
	it("returns idempotent ready views and exposes interrupted-control recovery through management requests", async () => {
		const entered = await Effect.runPromise(Deferred.make<void>());
		let starts = 0;
		const runtime = ManagedRuntime.make(
			AgentsService.Default.pipe(
				Layer.provide(
					Layer.mergeAll(
						Layer.succeed(AgentStorage, {
							read: () => Effect.succeed(Option.none()),
							write: () => Effect.void,
						}),
						Layer.succeed(AgentRuntimePort, {
							available: true,
							initial: {
								available: true,
								status: "stopped",
								code: "",
								operation: "none",
							},
							start: Effect.suspend(() =>
								++starts === 1
									? Deferred.succeed(entered, undefined).pipe(
											Effect.zipRight(Effect.never),
										)
									: Effect.void,
							),
							stop: Effect.void,
							restart: Effect.void,
							subscribe: () => () => {},
						}),
					),
				),
			),
		);
		const request = createAgentsHandler(
			runtime,
			() => 17,
			"file:///app/index.html",
		);
		try {
			const pending = runtime.runFork(
				AgentsService.request({ type: "runtime", action: "start" }),
			);
			await Effect.runPromise(Deferred.await(entered));
			expect(await runtime.runPromise(AgentsService.view())).toMatchObject({
				runtime: { status: "starting" },
			});
			await Effect.runPromise(Fiber.interrupt(pending));
			expect(await request(source, { type: "read" })).toMatchObject({
				_tag: "success",
				view: { runtime: { status: "error", code: "AGENT.RUNTIME.FAILED" } },
			});
			for (let n = 0; n < 2; n++) {
				expect(
					await request(source, { type: "runtime", action: "start" }),
				).toMatchObject({
					_tag: "success",
					view: { runtime: { status: "ready" } },
				});
			}
			expect(starts).toBe(2);
		} finally {
			await runtime.dispose();
		}
	});

	it("routes authorized commands, rejects extra properties and forged panel callers, and returns no stored credentials", async () => {
		let saved: Option.Option<AgentState> = Option.none();
		let writes = 0;
		const runtime = ManagedRuntime.make(
			AgentsService.Default.pipe(
				Layer.provide(
					Layer.mergeAll(
						Layer.succeed(AgentStorage, {
							read: () => Effect.sync(() => saved),
							write: (state) =>
								Effect.sync(() => {
									saved = Option.some(state);
									writes++;
								}),
						}),
						Layer.succeed(AgentRuntimePort, {
							available: false,
							initial: {
								available: false,
								status: "stopped",
								code: "AGENT.RUNTIME.UNAVAILABLE",
								operation: "none",
							},
							start: Effect.void,
							stop: Effect.void,
							restart: Effect.void,
							subscribe: () => () => {},
						}),
					),
				),
			),
		);
		const request = createAgentsHandler(
			runtime,
			() => 17,
			"file:///app/index.html",
		);
		try {
			const unauthorized = await request(
				{ ...source, senderId: 18 },
				{ type: "create", id: "forged", name: "Bad", emoji: "🤖" },
			);
			expect(unauthorized).toMatchObject({
				_tag: "rejected",
				code: "AGENT.IPC.UNAUTHORIZED",
			});
			expect(writes).toBe(0);
			const invalid = await request(source, {
				type: "create",
				id: "valid",
				name: "Good",
				emoji: "🤖",
				arbitrary: 42,
			});
			expect(invalid).toMatchObject({
				_tag: "rejected",
				code: "AGENT.KEY.INVALID",
			});
			expect(writes).toBe(0);
			const created = await request(source, {
				type: "create",
				id: "valid",
				name: "Good",
				emoji: "🤖",
			});
			expect(created._tag).toBe("success");
			if (created._tag === "success") {
				expect(created.view.agents.map((a) => a.id)).toEqual(["main", "valid"]);
				expect(JSON.stringify(created)).not.toContain("credentialRef");
			}
			expect(
				await request(source, { type: "delete", id: "main", confirmed: true }),
			).toMatchObject({ _tag: "rejected", code: "AGENT.MAIN.PROTECTED" });
			expect(
				await request(source, {
					type: "save-file",
					id: "valid",
					file: "../../escape.md",
					content: "bad",
					revision: 1,
				}),
			).toMatchObject({ _tag: "rejected", code: "AGENT.KEY.INVALID" });
		} finally {
			await runtime.dispose();
		}
	});
});
