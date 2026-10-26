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
- [ ] 10.4 Use live bound-display position and rotation during concurrent pairing. Codex4378546838.
- [ ] 10.5 Refresh secondary HID paths by serial after re-enumeration. Codex4378546848.
- [ ] 10.6 Run full gates and native media smoke, push and reply per fix, remove build output. Leave threads unresolved and PR unmerged.
