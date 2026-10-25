# Tasks

## 1. Shared contract and planning

- [x] 1.1 Lane1, open-quake-hwn.1: validate proposal, design and delta specs using openspec validate agent-http-runtimes --strict before production implementation.
- [x] 1.2 Lane1, open-quake-hwn.1: freeze schemas, provider and transport ports, catalog errors and URL invariants; verify edge typecheck and focused schema/URL tests, publish committed interface to all lanes.

## 2. Provider and transport implementation

- [ ] 2.1 Lane2, open-quake-hwn.2: implement OpenClaw adapter from primary-source protocol evidence; verify local HTTP fixture tests for health, unsupported operations, streaming and failures, and document protocol assumptions.
- [ ] 2.2 Lane3, open-quake-hwn.3: implement Hermes agent HTTP adapter, session continuity and actual progress normalization; verify local fixture tests and document distinction from dashboard/control API.
- [ ] 2.3 Lane4, open-quake-hwn.4: implement bounded redacted HTTP transport and stream parsing; verify redirect, timeout, cancellation, size limits and malformed-event fixtures.

## 3. Desktop services and interface

- [ ] 3.1 Lane5, open-quake-hwn.5: persist/select connections and authorize IPC with secure credential handling; verify persistence, rejected unauthorized callers and secret-free public replies.
- [ ] 3.2 Lane6, open-quake-hwn.6: bridge management to verified runtime capabilities while preserving local workspace management; verify unsupported operations never call fictional remote endpoints.
- [ ] 3.3 Lane7, open-quake-hwn.7: implement owner-scoped cancellable conversations and bounded history/session handling; verify cancellation, continuity, ownership and terminal-event behavior.
- [ ] 3.4 Lane8, open-quake-hwn.8: implement connection and conversation UI with unavailable/error/streaming states; verify focused UI checks and document supported controls.

## 4. Composition and acceptance

- [ ] 4.1 Lane9, open-quake-hwn.9: compose production adapters and QUAKE voice/agent routing; verify mock-device consumer tests demonstrate selected connection use without real hardware.
- [ ] 4.2 Lane10, open-quake-hwn.10: inspect existing endpoints and perform authorized live runtime acceptance without service changes; document exact tested endpoints, capabilities and remaining live gaps without secrets.
- [ ] 4.3 Parent: reconcile lane commits, exports and task/bead evidence; run focused integration checks, deliver reviewed PR and keep any pending checks under host monitoring.
