# Connect an existing agent runtime

Open-quake connects to an already running OpenClaw Gateway or Hermes agent HTTP API. The runtime stays under your control. Open-quake does not install, start, stop, restart, or update it, and this integration does not configure messaging channels.

## Choose the agent API address

Use the HTTP or HTTPS base address reachable from the machine running open-quake. A loopback address means that machine, not another device. LAN addresses and tailnet MagicDNS names work when the service already listens there and network access permits it. Prefer HTTPS when the network is not trusted. A tailnet address does not replace the runtime's authentication.

Use a base address such as `http://127.0.0.1:8642` for Hermes or `http://127.0.0.1:18789` for OpenClaw, replacing the port with your runtime's configured port. These are upstream defaults, not promises that a service is listening. Use the gateway root, without a `/v1` suffix or a `/v1/chat/completions` path. A gateway subpath such as `/gateway/` or a Hermes profile path such as `/p/profile/` stays in every request.

Do not include a browser login route, URL username/password, token query, or fragment. Supply credentials through the connection's credential field. Public connection details expose credential availability, never the credential or its storage reference. Redirects are rejected, so enter the final agent API address.

## Hermes

Hermes has distinct agent-server and dashboard interfaces. Use its `api_server` platform. `GET /v1/capabilities` identifies that server with `object: "hermes.api_server.capabilities"` and `platform: "hermes-agent"`. The API uses its configured bearer credential. A dashboard login password or dashboard health response does not establish API access.

The official dashboard and third-party Hermes WebUI/control are browser applications. Pointing open-quake at either may return HTML, a login redirect, or a healthy dashboard response while the agent API is absent. Configure the existing API server through Hermes's own administration workflow if necessary. Open-quake does not change that configuration.

Hermes `GET /v1/models` returns model route aliases for one endpoint/profile agent. Those aliases are not independent agents. Agent listing stays unavailable; chat uses the endpoint's default agent without inventing a catalog entry. When discovery advertises model routes, the Model route selector chooses the alias sent with a conversation. Changing that selection starts a new conversation and shows history for that route. Conversation continuity uses the real `X-Hermes-Session-Id` returned by the server. Text, usage and tool/status events appear only when the server reports them. This adapter does not expose session/resource catalogs, agent configuration changes, or speech endpoints. Desktop text routing is integrated. A normalized transcript helper is tested, but production capture does not call it yet. Microphone capture, speech recognition and spoken playback remain unfinished speech work.

## OpenClaw

Use the Gateway HTTP address. The OpenAI-compatible chat-completions and Responses routes are separate opt-in endpoints, disabled by default upstream. The relevant endpoint must already be enabled in the Gateway. A reachable Control UI or `GET /healthz` response alone does not prove that chat is enabled or the credential is valid.

Gateway token/password modes accept the configured secret as a bearer credential. Trusted-proxy deployments need their existing identity-aware ingress; open-quake does not impersonate proxy headers or alter authentication policy. `GET /v1/models` advertises `openclaw/default` and agent-target identifiers such as `openclaw/<agentId>`, not the agent's backend provider model inventory.

The adapter probes enabled HTTP routes with read-only GET requests and prefers Responses when both are available. It dispatches each conversation once, with no POST retry or fallback to the other protocol. OpenClaw sessions use application-owned session keys, not Responses object IDs. The adapter lists advertised agent targets but does not expose a backend model inventory or session/resource catalogs. It does not claim built-in tool progress; actual client function requests can appear as requested tool events.

Built-in agent tools execute on the runtime host according to its existing tool policy. `tool_choice: "none"` restricts client-defined function tools; it does not disable the agent's built-in tools.

## Check the connection

Open Agent sessions in the desktop management window and choose Add connection. Choose the runtime kind, enter its base address and optional bearer credential, and save. The selected runtime handles new conversations. The local agent library remains separate.

Save the connection with its runtime kind, base address and credential, then check the connection. A successful connection requires the expected protocol response and supported features, not only an HTTP 200 health page. Unsupported features remain unavailable. External runtime lifecycle controls, resource management, and agent configuration changes are not implied by chat support.

Cancelling a conversation closes its HTTP stream. That requests cancellation through the runtime's disconnect behavior; it does not roll back tools that already ran. Do not assume that a short prompt or an instruction saying not to use tools disables tool execution. For a harmless inference check, use a disposable conversation only after the runtime's actual tool policy guarantees no tool execution.

If a check fails, confirm the address from the open-quake host, confirm the actual agent API is listening, and confirm the required endpoint and credential. A redirect usually means a dashboard/login address or an ingress redirect. Authentication failure needs the agent API credential. An unavailable feature needs a runtime version/protocol that supports it; restarting open-quake cannot add it.

## Verification limits

Acceptance tests in `packages/edge/src/agent-http/acceptance.test.ts` compose the real adapters and fetch transport against local HTTP fixtures. They cover authenticated discovery, Hermes model/session continuity and real tool events, both OpenClaw chat protocols, and redirect rejection without forwarding credentials. They do not require installed runtimes, real credentials, a physical QUAKE, or external network access. Run them with `pnpm --filter @open-quake/edge exec vitest run src/agent-http/acceptance.test.ts --maxWorkers=1 --no-file-parallelism`.

Fixtures follow [Hermes 0.21.3 API-server source](https://github.com/NousResearch/hermes-agent/blob/e10934b03e115b036b3c38b9c6e6817039a5962d/gateway/platforms/api_server.py), its [streaming implementation](https://github.com/NousResearch/hermes-agent/blob/e10934b03e115b036b3c38b9c6e6817039a5962d/gateway/platforms/api_server_openai_routes.py), and [OpenClaw 2026.10.7 HTTP API source](https://github.com/openclaw/openclaw/tree/384100f491d78350c4754d5cf7b2482985ccbf76/src/gateway). Other runtime versions need their own connection check.

Checks on 2026-10-25 found a healthy local third-party Hermes WebUI and a healthy official Hermes dashboard on the tailnet. Both redirected the agent capability request. The local install reported 0.21.3 and the remote dashboard reported 0.21.7. No agent API was reachable on the discovered local default port. No local OpenClaw executable or default-port listener was found.

A task-owned temporary process of installed Hermes 0.21.3 then verified the actual agent API using isolated scratch state, an ephemeral bearer credential, and a loopback-only listener. Health returned the Hermes identity, unauthenticated capabilities returned 401, authenticated capabilities reported chat streaming, and the server advertised no enabled toolsets. Source-backed preflight also resolved zero tool definitions. The process stopped after the checks and its listener was gone. Saved application/service configuration stayed unchanged.

Live inference then succeeded through the actual open-quake Hermes adapter and fetch transport, using the same isolated process and an existing authorized OpenAI-compatible HTTPS inference gateway. Its live model catalog included `gpt-6.1-sol`, which was the exact backend model used. One disposable conversation produced the expected text, reported token usage, one completion and a real session ID, with zero tool events. The process stopped afterward, its listener disappeared, and saved application/service configuration and credentials stayed unchanged. This verifies the adapter-to-Hermes-to-model path; it does not verify the desktop connection/chat interface, live session continuation, tool execution, or a live OpenClaw conversation.

The local CLI's existing Codex OAuth credentials separately failed an ordinary refresh with `refresh_token_expired`. That finding applies to that credential store. It does not establish that a working desktop or remote dashboard needs another login. The authorized inference-gateway test succeeded without using those credentials or changing the desktop's provider. Identify the actual app's runtime, profile and provider before diagnosing its authentication.
# Testing real runtimes

The opt-in disposable Docker Compose runner is documented in
`packages/edge/e2e/README.md`. It takes the provider base URL, optional API key
and model from environment variables. It exercises both OpenClaw HTTP protocols
and Hermes through the production adapters, including streamed replies and
two-turn session continuity. It never uses an existing runtime's saved state.

Speech capture needs separate acceptance. The desktop's production capture
runtime currently returns unavailable; the transcript helper has no microphone
caller. The speech library also needs a desktop authenticated WebSocket driver,
PCM capture/resampling and owned audio playback. An OpenAI-compatible chat
endpoint alone doesn't configure STT or TTS.

After those bindings and supported speech profiles are available, the manual
check is one production app instance with mock voice disabled: select the
microphone and runtime, hold the QUAKE knob until listening, say "Reply with
exactly: speech capture works", then release. Check that one finalized
transcript produces one runtime request and that the answer appears. If TTS is
enabled, confirm audible playback and natural completion. Cancellation and
permission refusal need separate checks. Keep evidence to timing, format and
event counts; don't store raw microphone audio or credentials.
