# Tasks

Agents remain later-phase. The first group protects the first-release chat loop. Implementation does not begin until the pending runtime decision is recorded. The parent creates one Beads issue per task.

## 1. First-release independence

- [ ] 1.1 Record the runtime replacement, budget, template, and approval-control decisions; verify `openspec validate agent-runtime --strict` and document accepted/deferred choices without claiming gateway compatibility.
- [ ] 1.2 Implement an explicit unavailable agent capability in first-release dispatch; verify chat/direct voice start with no installer/gateway/agent-network calls and agent routes fail visibly through real clients, and document feature availability.

## 2. Later local agent runtime, macOS first

- [ ] 2.1 Implement versioned local catalog/agent/session contracts and newly authored templates; verify revision/model/tool capability validation, locale fallback, offline CRUD/switch/reset isolation, and no recovered template text redistribution, and document template provenance.
- [ ] 2.2 Implement the Vercel-facade tool loop and ordered run events; verify fragmented/invalid tool arguments, repeated IDs, exact dispatch/result identity, per-agent context, 8-step/16-call/300s limits, and one terminal outcome with mock models and real consumers, and document run semantics.
- [ ] 2.3 Bind capability registry policy and desktop confirmation; verify allowlist/gates, never-policy refusal, changed arguments, stale/duplicate approvals, 120s approval expiry, and one simultaneous host mutation through actual domain executors, and document action permission defaults.
- [ ] 2.4 Implement cancellation, 30s tool deadlines, and restart ambiguity records; verify late non-cancellable results, no automatic write replay, private original causes, scrubbed serialized errors, and truthful UI outcomes through the runtime consumer, and document recovery.
- [ ] 2.5 Implement runtime enable/health/stop and typed tool cards; verify 10s start/check and 5s stop, owned-process cleanup, snapshot recovery, inert command previews, and desktop approval with panel status, and document lifecycle controls.
- [ ] 2.6 Integrate later dkclaw knob routing with the same AgentService; verify pinned agent/model, final-transcript submission, reset/cancel isolation, and response/TTS stream identity, and document the relationship to the legacy route name.

## 3. Day 2 and optional compatibility

- [ ] 3.1 Implement/exercise Linux runtime and action adapters; verify identical tool policy/lifecycle suites and actual platform permissions, and document unsupported host capabilities.
- [ ] 3.2 Research an optional user-managed OpenClaw gateway only if selected; deliver versioned handshake/auth/capability/stream/cancel fixtures and clarify the printer gateway's role, then verify a real compatible backend or keep the adapter unavailable with evidence.
- [ ] 3.3 Add panel approval only after the device/panel lane validates deliberate touch identity; verify matching nonce/target, stale touches, and no action from markdown/card parsing, and document the additional approval control.

## 4. Existing lifecycle hardening

- [x] 4.1 Make ready Start and stopped Stop idempotent, settle interrupted or defective transitions without inventing a confirmed backend state, preserve adapter-confirmed terminal states, and release ownership before an explicit retry. Verify conflict exclusion, exact timeout boundaries and typed failure identity through the real lifecycle and management request consumers. Tracked in `open-quake-9h3.7.1`. This does not complete task 2.5 or enable the local tool loop.

### Lifecycle hardening verification, 2026-10-26

Six assertions failed against the prior implementation, reproducing ready Start
rejection and interrupted Start/Stop/Restart remaining transitional. The actual
lifecycle consumer now passes fourteen tests covering idempotence, conflict
exclusion, all three interruption/retry paths, adapter-confirmed cleanup,
external transitions, defects, typed original-cause retention, and the exact
10s/5s deadlines. The actual management request handler also recovers after an
interrupted service request and returns the ready view twice with one retry
dispatch. HTTP management adapters still reject local process control.

The complete edge suite passes 645 tests with three existing external skips.
Focused desktop agents and HTTP management tests, both typechecks, scoped
Biome, the production build, bundle smoke, and strict OpenSpec validation pass.
No real runtime process, provider, device, UI interaction, or host action ran.
Task 2.5 remains open, including the local tool loop and its UI/approval work.
Reviewed delivery is tracked separately in `open-quake-9h3.7.1`.

## Agents burn-down lane, 2026-10-26

- [x] A.1 Add optional owned OpenClaw service administration with private state, loopback token auth, bounded lifecycle, consented restart, stopped-only clear, validated settings and opt-in autostart. Sources CENTER-047/048, MAIN-144. Bead `open-quake-lih.17.10`; production `apps/desktop/src/main/agents/{owned-runtime,local-state}.ts`, verified by `owned-runtime.test.ts` and `administration.test.ts` with fake process drivers only.
- [x] A.2 Add revision-checked rename/template reset, portable pack round-trip, bounded authored-workspace backup export, redacted diagnostics and managed log-level environment updates. Sources CENTER-050/104, MAIN-144. Same bead; service and real controller/storage tests in `administration.test.ts`, mounted settings/wizard tests in `administration-interactions.test.tsx`.
- [x] A.3 Add local agent/model/voice/task editing and key-scoped HTTP context reset using existing credentials and conversation owners. Source MGMT-302. Bead `open-quake-lih.17.12`; mounted `key-editor-interactions.test.tsx` and `agent-http/voice-adapter.test.ts` verify persistence and cross-key isolation.
- [ ] A.4 Lead acceptance: launch a selected installed OpenClaw executable and verify its supported plugin versions, readiness/restart, real messaging authentication and physical key behavior. No live external service was used. This lane does not complete the in-process tool-loop tasks above.

## PR108 post-round follow-ups

- [x] F.1 Stop Windows shim gateway trees with bounded injectable termination and fake Windows/POSIX regressions. CENTER-047, MAIN-144, finding 4380901915. Bead `open-quake-lih.17.24`.
- [x] F.2 Decode pinned recorded WhatsApp terminal QR output into the existing PNG drawer path, with consumer regression coverage and UTF-8-safe stdout chunk framing. CENTER-078, finding 4380901925. Same bead; owning channel spec is management-center-parity/specs/integration-channels.
- [x] F.3 Match runtime voiceInput defaults in mounted key editing and persistence. MGMT-302, finding 4380901936. Same bead.

## PR122 review fix round
- [x] R.1 Separate cleanup ownership from live readiness and retain early-exited Windows trees. CENTER-047, MAIN-144, 4381279137; bead `open-quake-lih.17.24.1`.
- [x] R.2 Prove late processor exit cannot erase failed tree-cleanup ownership. CENTER-047, MAIN-144, 4381279385; same bead.
- [x] R.3 Prove TestClock startup timeout plus failed tree cleanup retains an explicit Stop retry. CENTER-047, MAIN-144, 4381279552; same bead.
- [x] R.4 Prove retained cleanup cannot report ready or admit a new process before successful cleanup. CENTER-047, MAIN-144, 4381290893; same bead.
- [x] R.5 Verify pinned QR renderer and raw-payload availability; test all 40 versions with ANSI/plain, LF/CRLF and refresh framing. CENTER-078, 4381279720; same bead, owning integration-channels spec.
- [x] R.6 Release cleanup on confirmed Windows creation failure with no PID, and prove recovery with fake spawning. CENTER-047, MAIN-144, mid-round finding 4381510116; same bead.
- [x] R.7 Confirm an already-absent Windows tree without confusing absent shim with surviving descendants; keep failed probes retryable. CENTER-047, MAIN-144, mid-round finding 4381535855; same bead.
- [x] R.8 Verify Windows creation identity before every tree kill, hold the verified native handle through termination, and reject reused/unknown/late identities without killing. CENTER-047, MAIN-144, safety finding 4381625938; same bead.
