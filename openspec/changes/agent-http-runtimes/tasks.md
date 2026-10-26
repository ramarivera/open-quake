# Tasks

## 1. Shared contract and planning

- [x] 1.1 Lane1, open-quake-hwn.1: validate proposal, design and delta specs using openspec validate agent-http-runtimes --strict before production implementation.
- [x] 1.2 Lane1, open-quake-hwn.1: freeze schemas, provider and transport ports, catalog errors and URL invariants; verify edge typecheck and focused schema/URL tests, publish committed interface to all lanes.

## 2. Provider and transport implementation

- [x] 2.1 Lane2, open-quake-hwn.2: implement OpenClaw adapter from primary-source protocol evidence; verify local HTTP fixture tests for health, unsupported operations, streaming and failures, and document protocol assumptions.
- [x] 2.2 Lane3, open-quake-hwn.3: implement Hermes agent HTTP adapter, session continuity and actual progress normalization; verify local fixture tests and document distinction from dashboard/control API.
- [x] 2.3 Lane4, open-quake-hwn.4: implement bounded redacted HTTP transport and stream parsing; verify redirect, timeout, cancellation, size limits and malformed-event fixtures.

## 3. Desktop services and interface

- [x] 3.1 Lane5, open-quake-hwn.5: persist/select connections and authorize IPC with secure credential handling; verify persistence, rejected unauthorized callers and secret-free public replies.
- [x] 3.2 Lane6, open-quake-hwn.6: bridge management to verified runtime capabilities while preserving local workspace management; verify unsupported operations never call fictional remote endpoints.
- [x] 3.3 Lane7, open-quake-hwn.7: implement owner-scoped cancellable conversations and bounded history/session handling; verify cancellation, continuity, ownership and terminal-event behavior.
- [x] 3.4 Lane8, open-quake-hwn.8: implement connection and conversation UI with unavailable/error/streaming states; verify focused UI checks and document supported controls.

## 4. Composition and acceptance

- [x] 4.1 Lane9, open-quake-hwn.9: compose production adapters and QUAKE text/agent routing plus the transcript helper; verify mock-device consumer tests demonstrate selected connection use without real hardware. Production capture/STT/TTS binding remains open in open-quake-lih.15.1.15 and c5w.6/c5w.7.
- [x] 4.2 Lane10, open-quake-hwn.10: inspect existing endpoints and perform authorized live runtime acceptance without service changes; document exact tested endpoints, capabilities and remaining live gaps without secrets.
- [x] 4.3 Parent: reconcile lane commits, exports and task/bead evidence; run focused integration checks, deliver reviewed PR and keep any pending checks under host monitoring.

## 5. Disposable runtime acceptance, open-quake-hwn.11

- [x] 5.1 Add opt-in Docker Compose E2E against pinned real Hermes and OpenClaw runtimes with isolated disposable state, loopback API ports and no user configuration mounts. Supply OpenAI-compatible base URL, optional API key and model through environment variables only; never commit a personal inference endpoint.
- [x] 5.2 Exercise real adapters and transport for authentication, capabilities, streaming replies and session continuation. Disable agent tools and messaging integrations, bound inference/deadlines, and verify Compose teardown after success and failure. Live runs in this effort use only the user-authorized gpt-6.1-sol route.
- [x] 5.3 Inspect production speech capture readiness, document exact missing bindings and human microphone acceptance steps, and keep unexercised speech/audio claims open in the existing speech tasks.
- [x] 5.4 Reconcile and merge the reviewed existing PR stack, deliver the E2E extension through one bot-review round and passing checks, and merge it after handling findings. No release tag is requested.

## 6. Production desktop acceptance, open-quake-hbe.4 / open-quake-hwn.12

- [x] 6.1 Add an opt-in isolated Electron acceptance entry that imports the production root and drives the actual management renderer/preload connection and conversation controls against both disposable runtimes. Verify selection, model alias, streamed completion, remote continuity, local history and shutdown, with no user configuration or hardware access.
- [ ] 6.2 Run the desktop acceptance using an explicitly selected persisted production model and its native credential owner, with the authorized model checked before inference. Reject generic provider URL/key/model environment configuration. Inspect screenshots and resource cleanup, then deliver reviewed merged changes. Preserve physical speech acceptance separately.

- [x] 6.3 Replace the historical task 5.1 environment provider input with production-profile selection and a temporary private snapshot mounted only in the disposable containers. Verify exact model selection, credential failures, secret-free diagnostics, rejected legacy inputs and snapshot cleanup on success, failure and interruption. Tracked in `open-quake-hwn.12`; reviewed merge remains under 6.2.
