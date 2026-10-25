# Design

## Context

See proposal.md for motivation. Existing `agents/agents-ports.ts` assumes an installed runtime with start/stop/restart, while HTTP instances are user-managed. Existing AI `Usage` and capability statuses provide compatible building blocks but normalized AI events lack actual tool/status progress. Ten tracked lanes implement this change under epic `open-quake-hwn`.

## Goals / Non-Goals

Expose a small schema-first HTTP runtime domain without depending on Electron or UI. Keep credentials redacted in transport and absent from public schemas. Preserve gateway base subpaths. No installer, lifecycle control, messaging channels, fabricated agents, or required server configuration changes.

## Decisions

- Add `packages/edge/src/agent-http/runtime-contracts.ts`, `runtime-ports.ts`, `runtime-errors.ts` and pure `runtime-invariants.ts`. Reuse AI Usage and CapabilityStatus, and retain the existing AgentRuntimeAdapter unchanged because its lifecycle contract is inappropriate here.
- A provider adapter receives a RuntimeConnection for health, capabilities, listAgents and streamConversation. Missing agent listing is a typed unsupported result. Optional session/resource/model listing methods exist only where evidence supports them. No generic CRUD or start/stop methods.
- RuntimeConversationEvent uses textDelta, status, tool, usage and completed tags. Failures use the typed stream channel. Interruption owns network cancellation; an optional caller AbortSignal supports desktop cancellation. Session identifiers travel on request and completion/status metadata where supported.
- RuntimeHttpTransport.execute returns a scoped response with a byte Stream. Its request carries Redacted credential plus configurable timeoutMs, maxResponseBytes, maxErrorBytes and maxEventBytes. Transport lane4 owns fetch, response/SSE decoding and physical abort. The shared invariant resolver owns URL syntax, traversal rejection and base-subpath preservation. Redirects always fail.
- Runtime capability values are supported, unsupported or unverified. Health status and externallyManaged lifecycle are separate from capabilities. Listing models does not establish agent enumeration or model configuration support.
- Hermes installed-source evidence identifies `/v1/capabilities`, `/v1/models`, `/v1/chat/completions` and `X-Hermes-Session-Id`. Dashboard/control API is distinct. Adapter lanes cite primary sources and negotiate protocol-specific details without inventing endpoints.
- Lane1 owns shared contracts and this change. Lanes2/3 own OpenClaw/Hermes adapters; lane4 HTTP transport; lanes5/6/7 persistence, management bridge and conversations; lane8 UI; lane9 production composition and QUAKE routing; lane10 live acceptance and user documentation. Parent reconciles shared package exports, IPC composition and final integration.

## Risks / Trade-offs

- Protocol version differences can invalidate assumed capabilities. Use primary installed/upstream source and mock fixtures, with lane10 live acceptance separately recorded.
- Plain HTTP on user-chosen LAN/tailnet URLs has the user's network confidentiality properties. Never log credentials or follow redirects.
- Cancelling a client request can stop delivery without proving backend work stopped. Adapters report only backend-supported cancellation semantics and do not invent completion events.
- Remote content can contain private prompt data. History retention and public event handling remain bounded and owner-scoped in desktop services.

## Migration Plan

Introduce additive contracts and connection storage. No existing workspace migration is required. With no connection selected, existing local behavior remains. Parent integrates lane commits, runs targeted and composition checks, and opens one reviewed PR. Rollback removes selected HTTP routing while preserving local workspaces and stored user data.

## Disposable acceptance extension

Ramiro authorized real Docker Compose runtime tests and merging reviewed PRs on 2026-10-25. The acceptance runner owns its project, temporary volumes and ports, never mounts user homes or the Docker socket, and always removes its containers, network and state. Runtime versions are pinned. Toolsets and messaging stay disabled. Provider base URL, optional API key and model come from environment variables, with no personal endpoint default. The runner uses actual production adapters and bounded HTTP transport, and distinguishes stream/session assertions from physical speech acceptance. Live calls in this effort use the authorized gpt-6.1-sol route only. Production microphone/STT/TTS binding remains separately tracked; this test extension does not manufacture speech evidence.

## Production desktop acceptance extension

The opt-in desktop entry imports the production composition root after setting an isolated scratch userData directory. It drives the real renderer controls and preload bridges, captures synthetic-conversation screenshots, and uses the same environment-configured disposable runtimes as adapter acceptance. Mock device access is mandatory; no application configuration or physical device is shared with the user's running instance. A bounded process deadline and production quit sequence own cleanup. This establishes the desktop path independently from adapter-only fixtures.
