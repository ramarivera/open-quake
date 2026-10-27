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

- [x] 4.2 Clear superseded/cancelled knob pins and match capture/answer ownership before profile removal. Bead open-quake-e2r.10, review 4376513056. Three new regressions reproduced an old knob profile stopping a newer same-device grid recording, voice answer and typed answer. Runtime now drops the pin when a grid capture or unrelated turn replaces it, removes cancelled pins, and compares the actual pinned capture for stop/answer cancellation. All 28 focused speech tests and desktop typecheck pass.

## 5. Assistant-routing burn-down

- [x] 5.1 Complete saved agent/HA routes and short speech terminal. Bead open-quake-lih.15.15.


Task 5.1 software evidence: `knob/voice-route.test.ts`,
`agent-http/knob-route.test.ts`, `agent-http/voice-adapter.test.ts` and
`speech/runtime.test.ts` exercise committed agent/model pinning, phase refusals
before microphone permission, ready fake-socket recognition and outbound saved
identity. Short recognition applies only to knob captures; existing grid
transcript-policy tests retain meaningful one-character speech. The mounted
knob editor and `knob/assigned-ha.test.ts` prove save/import/configData retention,
configured HA execution, stale identity and cancellation. Auto HA returns its
action result without redundant response inference.

Root tests passed 4,983 with four skips; six typecheck tasks, build, both bundle
modes and hidden persona mock smoke passed. Strict OpenSpec retains the shared
9 pass / 38 fail length-warning issue open-quake-lih.23.2; the new requirements
are not flagged. Bead open-quake-lih.15.15 stays open for lead review and merge.
Physical gestures, Linux audio, actual runtime/provider connectivity, real HA,
microphone and playback remain unverified. Earlier physical and route tasks
remain untouched.


## PR128 batched review fixes

- [x] Reconcile selected-session ownership, draft identity, model admission, capture cleanup and HA assignment validation with real-consumer regressions. Bead open-quake-lih.15.16. Implementation beads .15.13/.15.14/.15.15 remain open for parent review.


PR128 fix1 implements all nine distinct findings from eleven threads. Direct
knob session identity now includes its pinned profile; explicit persona rows use
the editor catalog; capture resolves empty overrides and reconciles followed
provider models before pinning. Mounted persona drafts refresh on selection
generation, discard late reads/Update results, and send a generation-bound
Update. Selected edits never write the global persona. They remain in memory
until key reselection or session eviction; saved key settings remain the
reselection/restart source. Assistant RPCs claim unowned selected sessions and
reject foreign read/update/selection/ack operations using existing ownership.
Gateway refusal terminates the original reservation before localized busy
feedback. Canonical HaKey validation is shared below edge; invalid imports stay
inert, Save rejects malformed actions, and valid configData remains verbatim.

Focused production-consumer regressions cover loopback inference/history,
selected/global persona isolation, two real encoded RPC connections, mounted
async destination races, refused capture followed by a grid capture, imported HA
presses and profile Save rejection. Fail-before logs reproduce the original
routing, isolation, ownership, capture and malformed-assignment defects. Tests
use fake microphone permission/providers/equipment only. Six package typechecks,
Biome, desktop build, both bundle modes and hidden muted native persona smoke
passed; four EN/DE captures were visually inspected. Strict OpenSpec 1.15.0
retains the inherited 9 pass / 38 fail requirement-length baseline in
open-quake-lih.23.2. None of this round's new requirements are flagged.

Bead open-quake-lih.15.16 remains in progress for parent diff/reply review.
Implementation beads .15.13/.15.14/.15.15 stay open. No review threads were
posted to, resolved or retriggered by this lane. Hardware, real microphone,
playback, real HA, live providers and Linux remain unverified.


## PR128 final review fixes

- [x] Share canonical selection/submission routes and prove select, typed turn, dictation and reselection preserve one history while direct model revisions stay isolated. Bead open-quake-lih.15.17.
- [x] Synchronize New chat and history navigation with the host persona destination, retain session-local settings on reopening, and reject stale or foreign navigation. Use an additive desktop RPC only because close cancels a session and cannot select a destination. Prove mounted UI/controller/encoded bridge/host behavior, then run focused tests, typecheck, lint and build and push once. Parent owns review replies and gates. Bead open-quake-lih.15.17.


PR128 fix2 shares the five-field session route for key selection and submission.
The loopback regression drives key select, typed turn, dictation and reselection
through one session and verifies outbound prior user messages. Existing direct
profile A/A/B coverage still proves same-model reuse and changed-model isolation.

Desktop navigation uses the additive `assistant.navigate` RPC with the observed
selection generation. Both source and destination retain window-owner checks;
stale navigation cannot replace a newer key selection. New chat and ordinary
history clear the device destination; reopening a cached key session restores
its local settings without rewriting the global persona. Key-origin selection
consumption skips desktop navigation, and renderer epochs discard late reads.

Mounted New chat and history buttons drive the actual controller, encoded
preload bridge and host. Persona reads, Update and later fake-provider requests
use the opened destination. Coverage also proves same-session local edits,
reopened-key continuity, stale draft rejection and foreign-window refusal.
Three behavioral regressions fail against a790d481. Final focused coverage
passes 125 tests in eight files; six package typecheck tasks, Biome with zero
errors plus 16 existing warnings and two infos, desktop build and both bundle
modes pass. Strict OpenSpec 1.15.0 repeats 9 pass / 38 fail under the inherited
requirement-length baseline open-quake-lih.23.2; this round's requirement isn't
flagged. Hidden, muted native persona smoke also passes with four EN/DE captures;
the Update captures were visually inspected. Those screenshots show the
persona controls, while mounted UI regressions prove navigation. Full root
tests weren't rerun. Initial fixture errors, corrected in the
final tests, and the interrupted overbroad test invocation remain in scratch.

Bead open-quake-lih.15.17 stays in progress for parent acceptance. This lane
doesn't reply, resolve, retrigger review, watch or merge. Real device input,
microphone, audio playback, providers and Linux remain unverified.
