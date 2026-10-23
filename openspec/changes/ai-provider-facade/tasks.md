# Tasks

No implementation is completed by this spec-only change. Resolve pending decisions before their dependent work. Each checkbox becomes one child issue under this change's Beads epic; the parent owns that synchronization.

## 1. First-release provider foundation, macOS

- [ ] 1.1 Record Ramiro's decisions on ownership, credential storage, endpoint policy, and SDK version; verify design/spec coherence with `openspec validate ai-provider-facade --strict` and document approved/deferred choices.
- [ ] 1.2 Define profile/capability/normalized-event Schemas and pure validation; verify round trips, credential-free summaries, unsupported modality rejection, and endpoint/redirect invariants with unit/property tests, and document the contract.
- [ ] 1.3 Add only approved essential Vercel SDK/provider dependencies with exact shared catalog pins; verify `pnpm install`, lockfile consistency, and dependency documentation.
- [ ] 1.4 Implement the mock-default Effect facade and compatible BYO-key adapter; verify the real ChatService consumer selects its configured adapter, streams, aborts, and never takes an account/proxy path, and document configuration.
- [ ] 1.5 Implement macOS credential references and catalog error translation; verify missing/revoked/broken storage, private original causes, scrubbed serialization, and no plaintext fallback through the real settings consumer, and document recovery.

## 2. First-release Codex route decision and integration

- [ ] 2.1 Run a focused supported-integration spike for Codex device auth and a Vercel inference bridge; deliver a versioned protocol/usage decision covering grant namespace, cancellation, text-only operation, and SDK compatibility, or an explicit unavailable disposition for Ramiro to accept.
- [ ] 2.2 After approval of 2.1, implement device-login state/cancel/logout behind an injected helper; verify matching and stale completion, expiry/watchdog, helper absence, no token exposure, and auth generation revocation with a fake helper/clock, and document the settings flow.
- [ ] 2.3 After bridge verification, wire the Codex-backed Vercel provider to real chat; verify a user-authorized device login, text stream, cancellation, and no autonomous host tools, or keep inference unavailable and document the unresolved blocker without claiming parity.

## 3. Day 2 and later provider expansion

- [ ] 3.1 Add Linux secure credential/helper adapters; verify isolated storage, missing Secret Service, explicit in-memory fallback, and the same provider/auth conformance suite, and document Linux setup.
- [ ] 3.2 Add optional provider presets/dedicated adapters only from verified capability evidence; verify each accepted sampling/modality request and every unsupported branch with fixtures, and document the twelve-engine import/disposition map.
