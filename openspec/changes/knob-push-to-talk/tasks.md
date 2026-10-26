# Tasks

Depends on voice-stt-tts, ai-chat-core, provider profiles, and the device/profile lane's gesture contract. The route lane records verified implementation below; the lead closes its Beads after merge.

## 1. First-release route contract

- [ ] 1.1 Record decisions on route migration, profile snapshots, re-press behavior, and device input generations; verify `openspec validate knob-push-to-talk --strict` and document the agreed logical gesture API without inventing HID thresholds.
- [x] 1.2 Implement route Schemas and deterministic legacy migration/preview; verify idempotence, first-slash model parsing, explicit-field precedence, route field separation, ambiguous imports, and no credential persistence with property tests, and document migration outcomes.

## 2. First-release direct route, macOS

- [x] 2.1 Wire the real device logical-event adapter to KnobVoiceService and direct chat; verify pinned profile/provider/model, preparing/listening feedback, final-only single submission, duplicate reports, and distinct empty/cancelled/failed outcomes with synthetic device/provider Layers, and document the flow.
- [x] 2.2 Implement capture ownership, release-before-ready latches, same-device re-press, and cleanup bounds; verify other-device busy, stale releases/STT callbacks, profile edits/removal, disconnect, 60s automatic stop, and no late request through the actual chat consumer, and document race handling.
- [ ] 2.3 Exercise the physical macOS knob hold/release/direct-answer/audio loop when hardware and credentials are available; record press/release generation and timing evidence, and leave hardware acceptance open until actual observations exist.

## 3. Day 2 and later routes

- [ ] 3.1 Exercise Linux direct-route capture/disconnect and speech output with the same fixture suite and physical device when available; document permission/gesture gaps explicitly.
- [ ] 3.2 After agent-runtime is enabled, connect dkclaw to its pinned agent/model session; verify agent switching, reset/cancel, unsupported model, and no silent direct fallback through the real runtime consumer, and document that the name does not promise OpenClaw protocol parity.
- [ ] 3.3 Add an explicit legacyAssistant-to-direct/agent migration UI after approval; verify review/save, preserved import backup, repeat import, and no legacy execution, and document the chosen replacement.

## Knob route lane evidence, 2026-10-26

Tasks 1.2, 2.1 and 2.2 use the production hold consumer, committed profile
lookup, pinned direct chat configuration and speech capture ownership.
`knob-profile.test.ts` covers unique saved provider resolution, ambiguous
imports and no implicit main agent. `voice-route.test.ts` and
`voice-ipc.test.ts` cover committed revisions and cancellation while storage
is loading. `runtime-knob.test.ts` uses fakes and TestClock for one final
submission, busy ownership, two-second cleanup, early release, stalled
resolution and pinned profile removal. `chat/transport.test.ts` drives a
loopback provider after model edits; `agent-http/voice-adapter.test.ts` proves
external UI selection cannot hijack a committed direct knob route. Existing
speech deadline fixtures retain the 60-second automatic stop. Audit
KNOB-036/037/038/040/042/043/045/052.

Beads open-quake-e2r.2, open-quake-e2r.3 and open-quake-e2r.4 stay in progress
for lead closure after merge. No real microphone, QUAKE or DK-Suite is used.
Physical timing, real provider connectivity, Linux audio, dkclaw agent
pinning and legacyAssistant replacement UI remain unverified or outside
this lane.

Full delivery gates and screenshots are recorded in
`openspec/changes/knob-configuration/tasks.md`. The final focused race rerun
passed 24 tests across `voice-ipc.test.ts` and `runtime-knob.test.ts`.

## PR84 fix1

- [x] 4.1 Scope profile-removal cancellation to the affected device answer turn. Bead open-quake-e2r.9, review 4376058796. Both new `runtime-knob.test.ts` regressions failed before the fix, proving another device answer and unrelated read-aloud were cancelled. They pass after the fix; the removed device capture/text/answer still cancel. Read-aloud has no device/profile owner and survives reconciliation. No real microphone or hardware used.
