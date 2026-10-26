# Design

## Context

Agents are later-phase. The first release must run normal chat and direct knob voice with no runtime installation, gateway, agent catalog download, or marketplace account. A persisted agent-route action is visibly unavailable rather than silently mapped to normal chat.

Approved (Ramiro, 2026-10-23): build an in-process tool-calling loop over the existing Vercel AI SDK provider facade. It reuses ChatService sessions, local storage, capabilities, and error policies. This follows the atlas's suggested replacement path and avoids a mandatory installer for a partially known gateway. An optional user-managed OpenClaw compatibility adapter may follow after protocol research; choosing it is not settled product direction.

Alternative considered: bundle OpenClaw plus Node/Python/Git installers and preserve DK-Suite gateway behavior. That adds a large lifecycle and unverified protocol dependency before a basic chat loop is proven. Alternative considered: translate model text into shell commands. Reject this because text is not a validated tool invocation or authorization.

## Goals / Non-goals

Goal: Reuse the chat/provider contracts and dispatch only registered capabilities with bounded runs.

Non-goal: Do not redistribute recovered agent workspaces or make an unknown gateway a first-release dependency.

## Decisions

Approved (Ramiro, 2026-10-23): the draft specifications encode the recommendations below. Supplied product direction is fixed; other design choices await acceptance before implementation. Evidence labels describe recovered observations, not approval of the proposed replacements.

### Package ownership and conductor boundaries

Approved (Ramiro, 2026-10-23): `packages/edge/src/agents/` holds agent contracts, pure run/tool invariants, repository, AgentService, and an optional gateway adapter. AI calls still use `AiProviderService`; no `@effect/ai` or raw SDK reaches tools/UI. `packages/client/` exposes typed registry/session/connection subscriptions. Desktop main provides optional runtime process and host capability adapters; renderer owns agent picker, confirmation controls, and cards.

AgentService declares its dependencies and named Effect.fn methods. Contracts/RPC are Schema-first and errors use shared catalog leaves with private original causes and scrubbed projections. Root Layers choose runtime backend once. A capability registry is the sole binding from tool name to input Schema, permission, autonomy, gate, and Effect. Domain services own actual file/profile/host/HA operations.

### Agent catalog and session lifecycle

An agent record has local stable ID, localized display label, revision, user-authored instructions, provider/model references, and an allowlist of capability IDs. Bundle only newly authored local templates with provenance, never recovered commercial template text. Imported IDs such as studykeeper/materialfinder are compatibility identifiers, not promises of cloned prompts or skills. Local CRUD/switch/reset works without cloud sync or account registration.

Backend states are disabled, starting, ready, stopping, failed. Start and health check time out at 10s; stop waits at most 5s and reports failure truthfully. Owned helper processes only are eligible for stop; never kill unrelated user runtimes. Default runtime starts on explicit enablement, not app launch. Repeated enable returns the same ready backend rather than creating duplicate loops.

Each agent has isolated conversation/session storage keyed by agent ID and revision. Sending pins agent, model, instruction revision, and tool allowlist. Switching selection affects the next send; the previous run remains attached to its original agent. Reset cancels that agent's active run, increments its session generation, then clears that agent's context. Ignore events from prior generations. A different agent is unaffected. The chat concurrency rule still applies per conversation.

### Run and tool states

Run states are queued, running, awaitingConfirmation, completed, failed, cancelled, timedOut. A tool invocation has runId, toolCallId, capability ID, validated input, status, and result/error. Accumulate argument deltas until a complete structured call is available; Schema-decode before any dispatch. A tool result is returned to the model only once, and only after real execution. User decline returns a typed denied tool result. Tool output is untrusted data and cannot grant access to another capability.

Approved (Ramiro, 2026-10-23): allow at most 8 model steps and 16 tool calls per run, at most one active host-mutating tool, 30s per tool, 120s waiting for confirmation, and a 300s absolute run deadline from acceptance, including confirmation time. Each provider step has a 60s deadline capped by remaining run time. Whichever deadline expires first wins. AgentService uses the shared conversation/event contracts under an explicit agent execution class; the direct-normal-chat 60s whole-turn handler does not wrap this loop. Intermediate tool/model steps do not emit outward chat end chunks. A single tool may specify a stricter registered timeout. Hitting a budget stops further dispatch and ends with a stable budget/deadline outcome.

Read-only tools may run automatically only when explicitly declared auto and enabled by the agent allowlist. Write/sensitive tools require confirmation by default. Never-policy tools are rejected without executing. Confirmation binds runId, toolCallId, capability ID, exact normalized arguments, selected targets, and a nonce. Any changed target or arguments requires a new confirmation; duplicate clicks cannot run a tool twice. A later confirmation after cancellation/expiry is stale.

Cancellation interrupts provider streams and cancellable tools, revokes pending approvals, and emits one terminal run outcome. A non-cancellable operation already dispatched may finish; record its actual eventual result as a late execution record without returning it to a finished model turn or repeating the operation. Never claim that cancellation reversed a host side effect. Do not automatically replay writes after a crash or provider retry. Persist dispatched tool IDs before invocation to detect ambiguous interrupted side effects; show unknown completion after restart until resolved.

### Stream and device presentation

Use `ai-chat-core` v1 chunks for answer/followUp/end. A separate typed agent event stream carries run status and tool cards keyed by runId/toolCallId, with ordered per-run event IDs and snapshot recovery. It does not inject new chunk kinds into the chat protocol. Cards show requested capability, safe argument summary, permission status, and actual pending/running/succeeded/failed/denied state. Escape tool output and truncate previews; no command executes from a text card or markdown parser.

Approved (Ramiro, 2026-10-23): desktop confirmation is the initial control; the panel displays status with a link to the desktop. Add panel approval only after touch identity and deliberate activation are verified by the panel/device lane. Knob dkclaw dispatch passes its pinned agent/model and transcript to this same runtime. Agent switching never resets another agent's device conversation implicitly.

### Optional OpenClaw compatibility boundary

The recovered store names serverUrl/serverToken/learnedGatewayProtocol establish configuration names, not handshake/auth/message semantics. Do not infer that printer_3d_gateway is the Claw chat gateway. A compatibility adapter needs a versioned protocol description, handshake/auth fixtures, model/tool capability negotiation, stream mapping, timeout/cancellation checks, and explicit endpoint trust before release. Default connection is loopback only; remote endpoints are a later explicit configuration requiring authenticated TLS. No protocol autodowngrade after auth failure and no reuse of DecoKee credentials.

### Evidence and deliberate replacements

Read-only root `R` is `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion`; `RS` is `R/artifacts/recovered_sources`.

- S: `RS/webpack:__dk-suite_src_utils_openclawAgentCatalog.js` and `webpack:__dk-suite_src_utils_openclawInitEditionStore.js`, local agent IDs, editions, localization keys, and seed versions.
- S: `RS/webpack:__dk-suite_src_views_Wizard_composables_openClawInstallMixin.js`, installer UI and Node/Python/Git setup events. It does not establish installer subprocess safety or gateway protocol.
- N: `R/artifacts/ipc_channels.txt`, switch-agent, get-current-agent, agent-send-message, reset-session, and connection/model IPC names. This design proposes explicit semantics rather than claiming recovered payload parity.
- S: `RS/webpack:__dk-suite_src_utils_quakeToolCommandParse.js`, exec/search command preview classification; `webpack:__dk-suite_src_utils_useQuakeBotLayout.js`, card layout; chat markdown/segment helpers, presentation evidence only.
- P: `R/SUBAGENT_AI_ARCHITECTURE.md` and `R/DK_SUITE_INSIGHTS.md`, runtime packaging and suggested tool-loop replacement; `R/artifacts/gateway_files.txt`, gateway binary inventory with unresolved role.
- Product scope: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, section 6 and Later phases.

Deliberately drop mandatory bundled runtime/installer, cloud marketplace/sharing, edition subscriptions, account-linked model catalogs, and inferred gateway auto-discovery. Replace prose/exec previews as execution authority with registry-bound calls. Preserve local agent selection, per-agent sessions, optional voice routing, and truthful tool cards.

## Open decisions and verification

- Approved (Ramiro, 2026-10-23): approve in-process runtime as the default replacement and keep OpenClaw compatibility optional and later.
- Approved (Ramiro, 2026-10-23): approve step/tool/deadline budgets, explicit enablement, and desktop-only first approval controls.
- Approved (Ramiro, 2026-10-23): choose the initial newly authored template catalog and tool allowlists with the owning action domains.

Use a deterministic mock model that emits fragmented tool calls, malformed arguments, repeated IDs, and multi-step results. Drive the real capability consumer to prove execution and refusal, not just Layer provision. Verify switch/reset isolation, late confirmation, timeout, non-cancellable operations, and restart ambiguity. Live gateway protocol, recovered template contents, hardware touch approvals, and Linux runtime integration are unverified.

## Migration and rollback

Keep agent enablement off until the runtime decision and action policies are approved. Import compatibility identifiers only into an explicit preview; do not import executable workspace skills automatically. Enable the local mock runtime, then verified read tools, then individually confirmed mutations. Rollback disables new runs and cancels owned work, preserving dispatched tool records and unresolved side-effect status. Never erase records to imply an interrupted operation did not happen.

## Risks and alternatives

- In-process tools share host privileges. Use narrow registered adapters and explicit allowlists; a generic shell runner is not the default agent capability.
- Cancellation cannot undo a non-cancellable mutation. Persist dispatch identity and display eventual or unknown completion rather than replaying it.
- OpenClaw protocol recovery may remain incomplete. Treat compatibility as optional and do not make first-release chat or local agents depend on it.

### Existing lifecycle recovery, 2026-10-26

The existing lifecycle conductor must return its ready snapshot for repeated Start and its stopped snapshot for repeated Stop without dispatching again. An active control still rejects conflicting controls as busy. Acquisition and release of control ownership are interruption-safe. On caller interruption or an adapter defect, an unconfirmed starting/stopping state becomes the existing `AGENT.RUNTIME.FAILED` state; a terminal state confirmed by adapter cleanup is retained. This does not assert that interruption reversed a host operation. An explicit control may reconcile an error state, with no automatic retries. The 10s start/restart and 5s stop deadlines and original typed adapter errors remain unchanged. Production HTTP adapters keep local process controls unavailable.

This hardens the existing control consumer under task 4.1. The in-process tool loop, health adapter, confirmations, tool cards, and remaining task 2.5 acceptance remain unfinished.

### Optional owned process administration, agents burn-down lane

An explicitly absolute `OPEN_QUAKE_OPENCLAW_COMMAND` selects an optional user-installed upstream OpenClaw executable for owned service and channel administration. Absence retains the existing HTTP runtime facade; mock-device mode disables executable dispatch. This is an opt-in compatibility path, not an installer or completion of the planned in-process tool loop. Normal chat continues through PR93's existing provider facade and agent conversation transports stay with agent-http-runtimes.

The owned process receives fixed argv, private `OPENCLAW_STATE_DIR`/`OPENCLAW_CONFIG_PATH`, loopback binding and a config-only token. Runtime and channels share one serialized atomic config owner. Settings keep root or named private child directories and preserve prior folders; clear is stopped-only. CLI shape is grounded in upstream OpenClaw source revision `3cd1240` for list/status/login/remove and pairing list/approve. Tests inject command/process drivers at that boundary and exercise production registration; no external pairing, paid inference or plugin installation ran.

Portable agent packs contain authored Markdown and skills. Workspace backup export contains all local agents, skills and panel assignments, bounded to 2 MiB; it excludes model/provider and process configuration and native credential-store values. It is a user-exported snapshot, not automatic retained backup or a full runtime restore. Diagnostics include only counts, runtime mode/status/code and at most 64 lifecycle entries. Managed environment update currently declares only persisted log level, applied on the next start, and cannot mutate arbitrary host variables. Authored workspace content does not change when UI locale changes; locale synchronization cannot overwrite user edits.

Key-specific Reset Context enters the existing voice request owner, cancels only that key and clears its remembered local HTTP conversation scopes. Local workspace IDs and the external runtime's selected agent remain separate; editing a profile does not retarget a live external connection implicitly.
