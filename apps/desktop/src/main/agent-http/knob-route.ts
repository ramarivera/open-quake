import { Effect } from "effect";
import { VoiceKnobRejected } from "../../../../../packages/edge/src/voice/surface/voice-surface-errors";
import type { KnobCaptureSnapshot, PinnedAgentRoute } from "../../../../../packages/edge/src/voice/surface/voice-surface-ports";
import type { AgentConnectionSelection } from "../../shared/agent-connections";
import type { RuntimeDiscovery } from "./resources";
import type { RuntimeRegistrySnapshot } from "./runtime-registry";

export interface KnobAgentState {
  readonly status: "ready" | "starting" | "stopping" | "error" | "stopped";
  readonly agentIds: readonly string[];
}
/** Local workspace IDs become HTTP agent IDs only after discovery confirms that exact identity. */
export const pinAgentKnob = Effect.fn("AgentHttp.pinAgentKnob")(function* (
  snapshot: KnobCaptureSnapshot,
  state: KnobAgentState,
  selected: AgentConnectionSelection | undefined,
  registry: RuntimeRegistrySnapshot,
  discover: (id: string) => Effect.Effect<RuntimeDiscovery, unknown>,
  generation: number,
): Effect.fn.Return<PinnedAgentRoute, VoiceKnobRejected> {
  if (state.status === "stopped" || state.status === "stopping") return yield* new VoiceKnobRejected("GatewayStopped");
  if (state.status === "starting" || registry.status === "connecting") return yield* new VoiceKnobRejected("GatewayStarting");
  if (state.status !== "ready" || !selected || registry.status !== "connected" || registry.connectionId !== selected.connectionId) return yield* new VoiceKnobRejected("GatewayNotReady");
  const agentId = snapshot.agentId || "main";
  if (!state.agentIds.includes(agentId)) return yield* new VoiceKnobRejected("GatewayNotReady");
  const catalog = yield* discover(selected.connectionId).pipe(Effect.mapError(cause => new VoiceKnobRejected("GatewayNotReady", cause)));
  if (catalog.capabilities.listAgents !== "supported" || !catalog.agents.some(a => a.id === agentId)) return yield* new VoiceKnobRejected("GatewayNotReady");
  return { connectionId: selected.connectionId, agentId, ...(snapshot.modelId ? { modelId: snapshot.modelId } : {}), generation, registryGeneration: registry.generation };
});
