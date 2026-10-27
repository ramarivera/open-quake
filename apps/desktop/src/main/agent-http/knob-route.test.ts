import { Effect } from "effect";
import { expect, it } from "vitest";
import type { RuntimeDiscovery } from "./resources";
import { pinAgentKnob } from "./knob-route";
const snapshot = { profileId: "p", revision: 2, route: "dkclaw" as const, agentId: "writer", providerId: "", modelId: "retained/unknown" };
const catalog: RuntimeDiscovery = { capabilities: { health: "supported", chat: "supported", listAgents: "supported", sessions: "unsupported", resources: "unsupported", models: "unsupported", toolEvents: "unsupported", usage: "unsupported" }, agents: [{ id: "writer", name: "Writer" }, { id: "main", name: "Main" }] };
it("KNOB-032/041 pins the saved agent, empty/default or retained model only on a ready matching gateway", async () => {
 for (const modelId of ["", "retained/unknown"]) {
  const result = await Effect.runPromise(pinAgentKnob({ ...snapshot, modelId }, { status: "ready", agentIds: ["writer"] }, { connectionId: "gateway", agentId: "other-selected-agent" }, { generation: 5, status: "connected", connectionId: "gateway" }, () => Effect.succeed(catalog), 3));
  expect(result).toEqual({ connectionId: "gateway", agentId: "writer", ...(modelId ? { modelId } : {}), generation: 3, registryGeneration: 5 });
 }
});
it("KNOB-041 refuses stopped, starting, disconnected and missing identities before discovery", async () => {
 for (const [status, connected, agents, code] of [["stopped", "disconnected", ["writer"], "GATEWAY_STOPPED"], ["starting", "connecting", ["writer"], "GATEWAY_STARTING"], ["ready", "disconnected", ["writer"], "GATEWAY_NOT_READY"], ["ready", "connected", ["other"], "GATEWAY_NOT_READY"]] as const) {
  let calls = 0;
  const result = await Effect.runPromise(pinAgentKnob(snapshot, { status, agentIds: agents }, { connectionId: "gateway" }, { generation: 5, status: connected, connectionId: "gateway" }, () => Effect.sync(() => { calls++; return catalog; }), 3).pipe(Effect.either));
  expect(result._tag === "Left" && result.left.code).toBe(`VOICE.KNOB.${code}`);
  expect(calls).toBe(0);
 }
 const missing = await Effect.runPromise(pinAgentKnob(snapshot, { status: "ready", agentIds: ["writer"] }, { connectionId: "gateway" }, { generation: 5, status: "connected", connectionId: "gateway" }, () => Effect.succeed({ ...catalog, agents: [] }), 3).pipe(Effect.either));
 expect(missing._tag).toBe("Left");
});
