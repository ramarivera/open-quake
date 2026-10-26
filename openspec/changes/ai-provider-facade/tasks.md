# Tasks

W7 implements the approved foundation described in verification.md. Integration acceptance remains open where noted. Each checkbox becomes one child issue under this change's Beads epic; the parent owns that synchronization.

## 1. First-release provider foundation, macOS

- [x] 1.1 Record Ramiro's decisions on ownership, credential storage, endpoint policy, and SDK version; verify design/spec coherence with `openspec validate ai-provider-facade --strict` and document approved/deferred choices.
- [x] 1.2 Define profile/capability/normalized-event Schemas and pure validation; verify round trips, credential-free summaries, unsupported modality rejection, and endpoint/redirect invariants with unit/property tests, and document the contract.
- [ ] 1.3 Add only approved essential Vercel SDK/provider dependencies with exact shared catalog pins; verify `pnpm install`, lockfile consistency, and dependency documentation.
- [ ] 1.4 Implement the mock-default Effect facade and compatible BYO-key adapter; verify the real ChatService consumer selects its configured adapter, streams, aborts, and never takes an account/proxy path, and document configuration.
  - W7: mock facade, cancellation/revocation, and SDK adapter interface implemented and tested. Real SDK adapter and real ChatService acceptance remain open, pending task 1.3. No SDK dependencies installed.
- [ ] 1.5 Implement macOS credential references and catalog error translation; verify missing/revoked/broken storage, private original causes, scrubbed serialization, and no plaintext fallback through the real settings consumer, and document recovery.
  - W7: typed Keychain interface, opaque references, host credential service, and catalog translation implemented and tested through the facade. Native Keychain binding and real settings consumer acceptance remain open; W7 does not edit desktop root wiring.

## 2. First-release Codex route decision and integration

- [ ] 2.1 Run a focused supported-integration spike for Codex device auth and a Vercel inference bridge; deliver a versioned protocol/usage decision covering grant namespace, cancellation, text-only operation, and SDK compatibility, or an explicit unavailable disposition for Ramiro to accept.
- [ ] 2.2 After approval of 2.1, implement device-login state/cancel/logout behind an injected helper; verify matching and stale completion, expiry/watchdog, helper absence, no token exposure, and auth generation revocation with a fake helper/clock, and document the settings flow.
- [ ] 2.3 After bridge verification, wire the Codex-backed Vercel provider to real chat; verify a user-authorized device login, text stream, cancellation, and no autonomous host tools, or keep inference unavailable and document the unresolved blocker without claiming parity.

## 3. Day 2 and later provider expansion

- [ ] 3.1 Add Linux secure credential/helper adapters; verify isolated storage, missing Secret Service, explicit in-memory fallback, and the same provider/auth conformance suite, and document Linux setup.
- [ ] 3.2 Add optional provider presets/dedicated adapters only from verified capability evidence; verify each accepted sampling/modality request and every unsupported branch with fixtures, and document the twelve-engine import/disposition map.

## Conversation burn-down lane test-conversation

- [x] AI-010 chat and speech consumers retain an accepted request's generation and read edited settings on the next request; removed chat credentials terminate the active request. Evidence: desktop `main/chat/transport.test.ts` and `main/speech/factory.test.ts`. Bead open-quake-cby.10 remains open for lead delivery.
- [ ] AI-010 live media and meeting refresh remains blocked. Main has no live AI media generator adapter, and `main/meetings/index.ts` selects an injected adapter or the mock only. Implementing live provider adapters exceeds this test lane's minimal fixes. Chat/speech coverage does not close this row.
