# Tasks

## 1. Device and desktop lifecycle

- [x] 1.1 Extend QuakeDevice with screen power and EIO recovery; implement bounded reconnect supervision. Verify with fake transport and TestClock, including typed failures and teardown.
- [x] 1.2 Implement physical display matching, serialized discovery, window grace, lock/wake recovery, single-instance startup and release fallback policy. Verify real main entrypoint with Electron mocked and TestClock lifecycle scenarios.

## 2. Diagnostics and host remediation

- [x] 2.1 Implement schema-checked authorized diagnostic IPC, connection page, Re-detect and consent/snooze prompts; document native calls. Verify mock consumer flows, permission rejection, prompt timings, renderer states and native smoke screenshots.

## 3. Integration and delivery

- [x] 3.1 Run all lane gates, native smoke, inspect screenshots, sync beads with evidence, commit/push and open a PR against main with hardware limits. Verify clean git state and linked PR head. Delivered in PR #21; evidence in verification.md.

## 4. PR #21 review-fix round 1

- [x] 4.1 Merge origin/main and preserve StripPanel, profile snapshot IPC, lifecycle behavior and both native smoke flows.
- [x] 4.2 Preserve failed-attempt presence across the last reconnect delay; prove arrival between 16 s and 25 s connects on the first passive scan with TestClock.
- [x] 4.3 Share activate and second-instance reopening recovery; prove closing all windows releases the owner and a second launch restarts it and unlocks recovery.
- [x] 4.4 Apply the ten-minute Later cooldown after failed layout repair, publish safe diagnostic text and test automatic polling plus explicit retry.
- [x] 4.5 Run all lane gates and native mock smoke, inspect screenshots, sync beads, commit/push, reply to and resolve the three threads with fix evidence. Do not merge PR #21.

## 5. PR #21 hardware-controls merge round

- [x] 5.1 Merge origin/main at 4f736cf, preserving hardware sessions and controls, typed screen-power discovery, lifecycle recovery and diagnostics, touch binding and StripPanel. Run all six lane gates plus media, hardware and lifecycle native mock smoke coverage, then commit and push without merging PR #21. Bead: open-quake-lih.11.1.10.

## 6. PR #21 review-fix round 2

- [x] 6.1 Require a confirmed binding before real-device HDMI passes, including initial USB notifications; return Screen to Connection on readiness loss while preserving deliberate offline preview. Verify notifications through timeout/retry and mounted native navigation. Bead: open-quake-lih.11.1.11.
- [x] 6.2 Recreate/show/focus management on activate independently of a surviving hidden fallback panel; preserve close-before-reopen lifecycle recovery. Verify destroyed, hidden and minimized management. Bead: open-quake-lih.11.1.12.
- [x] 6.3 Skip screen blanking without display candidates; retain changed candidate topology during discovery and retry after completion without self-triggered blanking loops. Verify USB-before-HDMI and late HDMI during an active transaction with TestClock. Bead: open-quake-lih.11.1.13.
- [x] 6.4 Run all six lane gates and media/lifecycle/hardware native mock smokes, inspect screenshots, sync evidence and beads, commit/push and reply to/resolve the three authorized connector threads naming the fix commit. Do not merge PR #21 or redirect hooks. Bead: open-quake-lih.11.1.14.

## 7. PR #21 clock and knob merge round

- [x] 7.1 Merge origin/main at 129ceb5 into head 0ae18bd, preserving lifecycle startup/recovery and hidden release fallback plus clock scheme/registration, knob bus/profile binding, both test mocks and all preload/smoke APIs. Run all six lane gates and media, hardware, knob, clock and lifecycle native mock smokes; commit through existing hooks and push without merging PR #21. Bead: open-quake-lih.11.1.15.

## Live acceptance follow-up

- [x] Bind an exact-label, exact-size sole DK-QUAKE display while preserving blanking identification for ambiguous candidates. Release discovery reservations when disconnect cancels a never-started fiber. Prove live EDID-retaining startup, settled resume/reopen and strict ambiguity regressions. Shared bead `open-quake-lih.10.2.21`; key-library-parity task8.2 tracks profile enrollment in the same fix. Evidence: `../key-library-parity/verification-quiet-startup.md`; source `451f108`.

- [x] Repair the CoreGraphics JXA binding crash exposed by consented live arrangement, and verify the actual helper on macOS plus the single-owner panel after movement. Shared bead `open-quake-lih.10.2.20.1`; key-library-parity task8.7. Evidence: `../key-library-parity/verification-quiet-keyboard-display.md`.

## 8. Lifecycle burn-down lane

- [x] 8.1 Implement scoped native strip windows, 3s/5s disposal and app suspension lease. Bead open-quake-lih.11.3. Rows MAIN-012,048,049,050,061; SCREEN-146; SETTINGS-079,084.
- [x] 8.2 Implement serial-safe recovery, ambiguity, scaled layout, debounced orientation and wake generations. Bead open-quake-lih.11.4. Rows MAIN-046,047,053,054,060; SCREEN-147; SETTINGS-085.
- [x] 8.3 Implement consented Windows probe/extend, arrangement persistence and wizard orientation ownership. Bead open-quake-lih.11.5. Rows MAIN-043,044,057,058,059; SETTINGS-058,087.

## 9. PR #86 single bot-review fix round

- [x] 9.1 Fix Linux panel type regression and assert each platform. Bead `open-quake-lih.11.6`. Hosted run 40332287050.
- [x] 9.2 Forward secondary strip input to its serial panel. Bead `open-quake-lih.11.7`. Devin 4377860557.
- [x] 9.3 Attach secondary hardware sessions and enroll serial profiles. Bead `open-quake-lih.11.8`. Devin 4377860703.
- [x] 9.4 Select a surviving strip when the selected panel closes. Bead `open-quake-lih.11.9`. Devin 4377860894.
- [x] 9.5 Reject recycled display identities on grace reconnect. Bead `open-quake-lih.11.10`. Devin 4377861513.
- [x] 9.6 Drain connections pending after the pairing loop. Bead `open-quake-lih.11.11`. Devin 4377861167.
- [x] 9.7 Allowlist new lifecycle diagnostics spans. Bead `open-quake-lih.11.12`. Copilot 4377915651/4377915718/4377915765/4377915820.
- [x] 9.8 Move orientation confirmation copy into settings translations. Bead `open-quake-lih.11.13`. Copilot 4377915877.
- [x] 9.9 Run full gates and reconcile all unanswered review threads. Bead `open-quake-lih.11.14`. Devin info 4377861742; final Codex scan; no resolving or merging. Evidence: verification.md, PR #86 single bot-review fix round.

- [x] 9.10 Preserve another serial discovery when one device disconnects. Bead `open-quake-lih.11.15`. Codex4378016504.
- [x] 9.11 Dispose preview ownership when real hardware connects. Bead `open-quake-lih.11.16`. Codex4378016521.
- [x] 9.12 Clear recovered Windows probe failures on redetect. Bead `open-quake-lih.11.17`. Codex4378016538.

## 10. PR #86 final implementation round

Bead `open-quake-lih.11.18` owns this final-round scope.

- [x] 10.1 Merge current main, preserving touch, meeting, icon and clock changes. Merge `abedad5`.
- [x] 10.2 Fix the suspected shutdown deadlock without weakening the smoke. Cancel knob registration work before the bus joins its input queue. The deterministic main-entrypoint test failed before this ordering change.
- [x] 10.3 Bind each renderer's state, profile and activation to its owning serial. Codex4378546825. Two-panel media regression failed before; mounted serial A/B and IPC ownership tests pass.
- [x] 10.4 Use live bound-display position and rotation during concurrent pairing. Codex4378546838. The concurrent-pairing regression failed before and passes with live lookup; 28 lifecycle tests pass.
- [x] 10.5 Refresh secondary HID paths by serial after re-enumeration. Codex4378546848. Two-strip regression fails on the old path selection and passes after serial lookup, including repeated path changes, recovery and input isolation. 14 HID tests pass.
- [x] 10.6 Run full gates and native media smoke, push and reply per fix, remove build output. Leave threads unresolved and PR unmerged.

## Device burn-down lane 2026-10-26

- [x] Implement device lane requirements with fixture/TestClock/native mock coverage. Beads open-quake-lih.11.20-.22.
- [x] Run full gates after merging latest origin/main; hand PR to lead with hardware unverified.

Device lane validation: current main `4aa4a9f1` merged. Root test command with SSD TMPDIR passed 4,137 tests with four existing skips. Lint, six-package typecheck, build, bundle smoke, 47 strict OpenSpec items and hidden muted native media smoke passed. EN/DE screenshots and per-row evidence are in the lane scratch directory; hardware stays unverified. Beads remain open for the lead.

## 11. PR #112 post-merge device follow-ups

Bead `open-quake-lih.11.24` stays in progress until the lead accepts the PR.

- [x] 11.1 Derive successful matrix release edges on empty frames and key changes, retain held contacts on repeated frames, and route emoji through the full handler. Prove ordinary execution, held hotkeys, A-to-B and emoji with mounted production components and KeyRuntime. Finding 4380831182; MAIN-008/028, SCREEN-144.
- [x] 11.2 Migrate legacy colon-serial hardware preferences on normalized reads without replacing a canonical save or losing the legacy record. Prove fake-store migration, concurrent saves and failure retention. Finding 4380831192; MAIN-018, SETTINGS-075.
- [ ] 11.3 Run typecheck, zero-error Biome, root two-worker tests, strict OpenSpec, build, both bundle modes, hidden mock and media smokes. Open a PR to main, record its link in the bead, remove generated build output and retain the worktree.

Follow-up verification: 35 focused tests passed, including mounted matrix/runtime contacts, legacy preference migration, concurrent-save protection, corruption retention and write ordering. Typecheck 6/6, Biome 1419 files with zero errors, strict OpenSpec 47/47, build, both mocked bundle modes, hidden conversation smoke 126 scenarios and media smoke with 26 screenshots passed. Full root two-worker testing remains incomplete because unchanged main/profile tests hit hook/test deadlines under host load; isolated selection-lifecycle passes 7/7. The final exact root attempt passed 4,154 tests with three timeouts in the unchanged selection-lifecycle file and four existing skips. Exact attempts and PR handoff are recorded in bead open-quake-lih.11.24 and SSD scratch burndown/fix-device-followups. No hardware, microphone, paid provider or audible playback was used.


## 12. PR #120 review fixes

Bead `open-quake-lih.11.24` remains in progress for lead acceptance.

- [x] 12.1 Serialize matrix replacement edges per device across delayed down acknowledgements. Mounted StripPanel plus production KeyRuntime/TestClock regression fails before the fix. Finding 4381194049; MAIN-008/028, SCREEN-144; owning contract in two-layer-sdk.
- [x] 12.2 Isolate unrelated unreadable legacy preference candidates while preserving canonical-file failures. Finding 4381207876; MAIN-018, SETTINGS-075.
- [x] 12.3 Emit matrix tile taps through the native knob-focus path and prove mounted knob focus follows matrix contacts. Finding 4381208066; MAIN-008/028, SCREEN-144.
- [x] 12.4 Run full review gates, commit/push/reply per finding, inspect unanswered threads, and remove this round's output/worktree without touching the original lane.


PR #120 review-round verification: all three findings have before-failing regressions, separate commits/pushes and attributed replies; all threads remain unresolved. The preference regression now injects EACCES through the existing filesystem mock so Windows receives the same failure as macOS. Final focused results are 29 strip tests and 9 preference/order tests. Six-package typecheck and the final desktop typecheck pass. Biome checks 1,442 files with zero errors, 15 inherited warnings and one info; strict OpenSpec passes 47 items; build passes. The exact root loose-env two-worker run passed 4,224 tests with seven unchanged timing failures and four existing skips. Registration initially timed out alone, then passed 2/2; selection-lifecycle passed 7/7 alone and live-locale passed 2/2 alone. No deadlines or assertions changed; open-quake-lih.9.10 owns the timing class. Default/mock bundle modes pass on the final rerun after two default shutdown timeouts. Hidden mock smoke passes 126 scenarios with two EN/DE screenshots, and media smoke passes with 26 screenshots and successful disposal/exit. GraphQL finds three answered unresolved threads and zero unanswered. Evidence and exact attempts remain under SSD scratch burndown/fix-device-followups/fix1, with the cleanup result in bead open-quake-lih.11.24. The original lane is untouched. No real HID, DK-Suite, microphone, provider or audible playback was used. Hosted CI and current-head review remain parent-owned; the exact full root run itself remains a recorded gate deviation.
