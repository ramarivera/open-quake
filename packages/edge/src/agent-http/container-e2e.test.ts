import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Redacted, Stream } from "effect";
import { makeHermesRuntimeAdapter } from "./hermes/hermes-adapter.js";
import { makeOpenClawAdapter } from "./openclaw/index.js";
import type {
	RuntimeConnection,
	RuntimeConversationEvent,
} from "./runtime-contracts.js";
import type { RuntimeProviderAdapter } from "./runtime-ports.js";
import { makeRuntimeHttpTransport } from "./transport.js";

// Only the opt-in Compose runner enables live inference. Ordinary CI stays offline.
describe.skipIf(process.env.OPEN_QUAKE_E2E_RUN !== "1")(
	"disposable real agent containers",
	() => {
		const required = (name: string) => {
			const value = process.env[name];
			if (!value) throw new Error(`Missing ${name}`);
			return value;
		};
		for (const kind of [
			"hermes",
			"openclaw-responses",
			"openclaw-chat",
		] as const) {
			it(`${kind}: authenticates, streams inference and continues the same session without tools`, async () => {
				const report = async (stage: string, passed = false) => {
					const prefix = required("OPEN_QUAKE_E2E_REPORT_PREFIX");
					await writeFile(
						`${prefix}-${kind}-acceptance.json`,
						JSON.stringify({ kind, stage, passed }),
						{ mode: 0o600 },
					);
				};
				await report("authentication rejection");
				const hermes = kind === "hermes";
				const baseURL = required(
					hermes ? "OPEN_QUAKE_E2E_HERMES_URL" : "OPEN_QUAKE_E2E_OPENCLAW_URL",
				);
				const token = required("OPEN_QUAKE_E2E_RUNTIME_TOKEN");
				const path = hermes ? "/v1/capabilities" : "/v1/models";
				const unauthenticated = await fetch(`${baseURL}${path}`, {
					redirect: "error",
					signal: AbortSignal.timeout(5000),
				});
				await unauthenticated.body?.cancel();
				expect(unauthenticated.status).toBe(401);
				const http = makeRuntimeHttpTransport();
				const credentials = {
					resolve: () => Effect.succeed(Redacted.make(token)),
				};
				const adapter: RuntimeProviderAdapter = hermes
					? makeHermesRuntimeAdapter({
							transport: http,
							credentials,
							limits: { timeoutMs: 90000 },
						})
					: makeOpenClawAdapter({
							http,
							credentials,
							protocol:
								kind === "openclaw-responses" ? "responses" : "chatCompletions",
						});
				const connection: RuntimeConnection = {
					id: kind,
					name: "Disposable E2E",
					kind: hermes ? "hermes" : "openclaw",
					baseURL,
					credentialRef: "ephemeral",
				};
				await report("health and capability discovery");
				expect(
					(await Effect.runPromise(adapter.health(connection))).status,
				).toBe("ready");
				expect(
					(await Effect.runPromise(adapter.capabilities(connection))).chat,
				).toBe("supported");
				if (hermes) {
					if (!adapter.listModels)
						throw new Error("Hermes model discovery unavailable");
					const models = await Effect.runPromise(
						adapter.listModels(connection),
					);
					expect(models.some((entry) => entry.id === "e2e-default")).toBe(true);
					const response = await fetch(`${baseURL}/v1/toolsets`, {
						headers: { Authorization: `Bearer ${token}` },
						redirect: "error",
						signal: AbortSignal.timeout(5000),
					});
					const tools: unknown = await response.json();
					expect(tools).toMatchObject({ data: expect.arrayContaining([]) });
					if (
						typeof tools !== "object" ||
						tools === null ||
						!("data" in tools) ||
						!Array.isArray(tools.data)
					)
						throw new Error("Missing real toolset inventory");
					expect(
						tools.data.filter(
							(entry: unknown) =>
								typeof entry === "object" &&
								entry !== null &&
								"enabled" in entry &&
								entry.enabled,
						),
					).toEqual([]);
				}
				const conversationId = randomUUID();
				const marker = `OQ_${randomUUID().replaceAll("-", "")}`;
				const collect = async (message: string, sessionId?: string) =>
					Array.from(
						await Effect.runPromise(
							adapter
								.streamConversation(connection, {
									connectionId: kind,
									conversationId,
									...(hermes ? { modelId: "e2e-default" } : {}),
									...(sessionId ? { sessionId } : {}),
									messages: [{ role: "user", content: message }],
								})
								.pipe(Stream.runCollect, Effect.timeout("100 seconds")),
						),
					);
				const text = (events: readonly RuntimeConversationEvent[]) =>
					events
						.flatMap((event) =>
							event._tag === "textDelta" ? [event.textDelta] : [],
						)
						.join("");
				await report("first streamed reply");
				const first = await collect(
					`Remember the exact marker ${marker}. Reply with only that marker. Do not use tools.`,
				);
				expect(text(first)).toContain(marker);
				const terminals = first.filter((event) => event._tag === "completed");
				expect(terminals).toHaveLength(1);
				const sessionId = terminals[0]?.sessionId;
				expect(sessionId).toBeTruthy();
				await report("remote session continuation");
				const second = await collect(
					"What exact marker did I give you in my previous message? Reply with only that marker. Do not use tools.",
					sessionId,
				);
				expect(text(second)).toContain(marker);
				expect(second.filter((event) => event._tag === "completed")).toEqual([
					{ _tag: "completed", sessionId },
				]);
				expect(
					[...first, ...second].filter((event) => event._tag === "tool"),
				).toEqual([]);
				await report("completed", true);
			}, 220000);
		}
	},
);
