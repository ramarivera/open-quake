# Tasks

## 1. Vendor device input

- [x] 1.1 Implement bounded raw parsing, identity and contact tracking; verify vectors, malformed input, nearest matching and 100 ms/capture scenarios with properties and TestClock. Document recovered layout.
- [x] 1.2 Bind the scoped touch reader behind QuakeDevice with retries, read recovery, lock/wake controls and safe health; verify fake transport lifecycle and cancellation.

## 2. Strip input

- [x] 2.1 Implement coordinate normalization, injected tile resolver, single-key and overlay arbitration; verify actual event-consumer routing and delayed releases.
- [x] 2.2 Implement reusable sub-target registry, tap/scroll recognition and monitor/chat physics; verify threshold scenarios and bounded-motion properties, and document cross-lane interfaces.

## 3. Integration and delivery

- [x] 3.1 Feed synthetic raw frames in mock mode and add the opt-in guarded capture script; verify mock delivery and script guards without opening hardware.
- [x] 3.2 Run all lane gates and native mock smoke, record evidence and unverified hardware findings, synchronize beads, commit, push and open the PR.

## 4. PR #20 review-fix round 1

- [x] 4.1 Merge origin/main and connect the mounted panel to strip-grid's real `geometry.tileAt` and current layout; preserve profile IPC and both native smoke suites. Sources: SCREEN-005, SCREEN-056.
- [x] 4.2 Acquire touch handles with interruption-safe release and regress a non-cancellable open completing after teardown, lock or wake. Sources: MAIN-035, MAIN-041.
- [x] 4.3 Invalidate registry membership on child mutations and discover new clickables inside existing scrollers without losing local rescan throttling. Sources: SCREEN-061–063.
- [x] 4.4 Preserve the original velocity sample timestamp and regress a 30 px move over 100 ms released at 100/101 ms. Source: SCREEN-066.
- [x] 4.5 Run all six gates and native mock smoke, record evidence, close the review beads, commit/push and reply to/resolve the three fixed threads. No hardware or merge.

## 5. Touch burn-down lane, 2026-10-26

- [x] 5.1 Deliver held input edges and scoped scrubbed diagnostics. MAIN-036, MAIN-065, SCREEN-057. Bead open-quake-lih.28.
- [ ] 5.2 Deliver mounted physical/DOM routing, focus/restore, volume, registration and window/mirror lifetime. KNOB-014, KNOB-015, KNOB-075, KNOB-080, KNOB-089, SCREEN-010, SCREEN-060, SCREEN-065, SCREEN-066, SCREEN-069, SCREEN-070, SCREEN-141. Bead open-quake-lih.29. Implemented except SCREEN-060 camera stream toggle, which awaits the verified camera gateway/renderer consumer in camera-and-printer-views. Shared camera-shaped input routing is tested but does not close that clause.
- [x] 5.3 Deliver chat/disk fling, elastic return and moved child bounds. AI-163, SCREEN-067, WIDGETS-078. Bead open-quake-lih.30.
- [ ] 5.4 Run the six gates and hidden mock smoke, capture EN/DE screenshots, push parity/touch and open a PR. Leave beads open for lead reconciliation after merge.

## 6. PR #88 bot-review fixes, 2026-10-26

Tracked by open-quake-lih.29.1. Leave the parent burn-down tasks open for the lead.

- [x] 6.1 Reconcile current main and fix the disconnected QuakeEvent fixture reported by CI run 40332468892. Current origin/main 95f6a69 is already an ancestor of f60a85b; the requested merge is a no-op.
- [x] 6.2 Release held keys when committed page content changes through StripScreen's layout cleanup/replacement, preserving runtime-only repaint ownership. Devin 4377896158, SCREEN-010 and SCREEN-057.
- [x] 6.3 Preserve failed held-key releases for reset retry and expose the catalog error. Devin 4377896467, MAIN-065 and SCREEN-057.
- [x] 6.4 Verify local-player body fallback and exclusive child buttons. Devin 4377895969, KNOB-089. The mounted consumer test passes before any routing change: unmatched hits retain supportTouchEffect and already emit tile down/up. Retain regression coverage; decline the reported behavior bug with source/test evidence.
- [x] 6.5 Reply to the known SCREEN-060 camera-gateway blocker, run all six gates, audit unanswered review threads including new Codex findings, and remove generated build output. Do not resolve threads or merge.

- [x] 6.6 Preserve text-entry Space/Enter on textarea touch targets. Codex 4378002610.
- [x] 6.7 Bind conditional copy buttons when they mount. Codex 4378002633.
- [x] 6.8 Run release cleanup after failed synchronous press activation. Codex 4378002639.
- [x] 6.9 Start disk gestures from native scroll position. Codex 4378002645.
- [x] 6.10 Preserve running knob focus capture through busy rejection. Codex 4378002652.
- [x] 6.11 Keep the hardware fail-safe keyboard release after a lost acknowledgement. Codex 4378002655.

Review verification: protocol 63, edge 729 with 3 existing skips, device 491, desktop 1889 with 1 existing skip. Unbounded concurrent runs hit wall-clock timeouts; the complete desktop rerun with two workers passed. The subsequent diagnostics allowlist regression and all 16 diagnostics tests pass. All 6 package typechecks, Biome 1227 files with 14 existing warnings, build, bundle smoke in default-HID and explicit-mock modes, and 47 strict OpenSpec items pass. Native hidden mock media smoke reaches the known OBS screenshot selector timeout owned by PR #90; do not treat that smoke as passed. Current main was already an ancestor, the player body finding was disproven by mounted tests, and SCREEN-060 remains blocked. All 10 review threads have replies and remain unresolved. No real QUAKE or DK-Suite was opened. Logs and screenshots: /Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/burndown/touch/fix1/.
