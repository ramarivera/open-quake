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
- [ ] 6.4 Run all six lane gates and media/lifecycle/hardware native mock smokes, inspect screenshots, sync evidence and beads, commit/push and reply to/resolve the three authorized connector threads naming the fix commit. Do not merge PR #21 or redirect hooks. Bead: open-quake-lih.11.1.14.
