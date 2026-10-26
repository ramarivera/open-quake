# Tasks

Execution epic: open-quake-zh8, child of open-quake-lih.16. Existing task beads open-quake-zh8.1 through .7 map in order to these tasks. Close only with source and verification evidence.

## 1. Capture and storage contracts

- [x] 1.1 Confirm source/retention/retry contracts and the shipped live translation route (`AI-136/292/327`), and trace `.md`/`.txt` export evidence (`AI-315`); verify stage/capture/export contracts and bounded translation display history. Include AI-263-275, AI-288-341, SETTINGS-105-107 and WIDGETS-097-100.
- [x] 1.2 Add meeting/chunk/stage schemas, lifecycle invariants and repository documentation; verify duplicate-stop idempotence, correlated meeting UUIDs and monotonic snapshots and interrupted-stage recovery, marks, side records and four summary templates.

## 2. Capture and processing

- [x] 2.1 Implement desktop microphone/system-audio adapters and capture conductor with catalog errors; verify permission failure, optional-source choice, source loss and track cleanup through fake media streams.
- [x] 2.2 Implement ordered finalization, transcript persistence, generation and stage-only retry through existing speech/AI facades; verify generation failure retains transcript, cancellation calls no provider and diagnostics omit content; prove async ASR polling/timeouts/diarization, output language and saved regeneration.
- [x] 2.3 Implement local history read/delete and UTF-8 Markdown summary/plain-text transcript export adapters (`AI-315`) with user documentation; verify filename sanitation, partial deletion failures and independently compare exported text with saved content.

## 3. Recorder and history acceptance

- [x] 3.1 Wire recording state/animations, history, transcript/minutes, retry/delete/export and the live translation toggle through the typed client (`AI-136/292/327`); verify actual controls produce the expected stage/provider/file operations. Register all MeetAI tiles, cooldowns, four animations, task health, templates and bounded live transcript/toolbar.
- [x] 3.2 Run all meeting-minutes scenarios, including restart/cancel/source loss; document native audio/provider/device-trigger evidence separately and leave missing hardware/OS validation open.


## Evidence and remaining acceptance

Source and scenario evidence: `apps/desktop/src/main/meetings/README.md`, domain
`meeting-service.test.ts` / `meeting-invariants.test.ts`, desktop `storage.test.ts`
/ `capture.test.ts`, and the reproducible `main/meetings/smoke.ts`.
All six required gates pass; 915 tests; strict OpenSpec 34/34. Native meetings and
existing media smokes use only mock device/capture/provider paths. Screenshots
and logs are in `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/meetings/`.

`open-quake-lih.16.1` remains open for live provider adapter integration and
lead-owned OS/audio/device acceptance. No physical or paid-provider check is
closed by these implementation tasks. The profile catalog remains owned by
merged PR #26. AI-341 tone calls were disabled in the recovered release; current
hardware ToneName lacks MM_FIREWORK/MM_SUCCESS, so no substitute code is added.

## 4. PR #31 review round 1

- [x] 4.1 Drain every main/side recorder before conversion, preserve final shutdown chunks, recover finite durations, and make cascading deletion reversible before history commit. Evidence: AI-263-264, AI-288-294, AI-299-317; `meeting-service.test.ts`, `storage.test.ts`, `registration.test.ts` and native duration checks.
- [x] 4.2 Bind capture IPC and media permissions to the trusted document/frame, report standalone translation source loss, release hidden capture windows, and enforce private audio/export files. Evidence: AI-280-294, AI-315, AI-338; `capture-port.test.ts`, `private-files.test.ts`, `registration.test.ts` and native output-mode checks.
- [x] 4.3 Route all shipped MeetAI keys through native touch and expose saved manual-recording processing. Evidence: AI-263-265, AI-297, AI-318-328, WIDGETS-097-098; `touch-controller.test.ts` and native five-key/manual-processing smoke.
- [x] 4.4 Run behavioral regressions, six repository gates, meetings and baseline media native mock smokes; record review dispositions and remaining live acceptance. Evidence: `apps/desktop/src/main/meetings/README.md` and lane scratch `REPORT.md`, `round1-*.log`; all 12 original findings accepted with behavioral regressions. Epic `open-quake-zh8` and acceptance parents stay open until merge/acceptance.

## 5. PR #31 integration review

- [x] 5.1 Merge current main preserving delivered MeetAI, provider and voice integration; normalize recovered duration to integer milliseconds and serialize source-loss finalization with capture transitions. Verify fractional recovery through durable history and deterministic main/side races, six fresh gates, meetings and baseline/combined native mock smokes. Reply to all open review threads with evidence and fix SHA. Round bead `open-quake-zh8.12`; physical/package acceptance remains open. Evidence: `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/meetings/review-round-1/`.

Section 5 verification: main `639924d7f6ca1e79f9b72dc14905502d9ae3f277`; six fresh gates, 1291 tests and 37/37 strict OpenSpec items. Both native mock smokes pass with zero missing IPC handlers; fractional FFmpeg recovery persists integer history through retry IPC. Shared writer shutdown awaits meeting disposal. Native captures inspected; hashes and process census retained in the round evidence directory. Physical/package acceptance remains open.

- [x] 5.2 Serialize cancellation/deletion with capture transitions and delayed source loss; preserve intentional terminal state, avoid duplicate finalization, and cover both race orders, stale callbacks and shutdown progress. Assess fresh PR31 feedback on translation isolation, cancelled touch releases and capture-ready timestamps with regressions. Run six fresh gates with loose turbo environment, sequential meetings and combined native mocks including fractional FFmpeg recovery, and record attributed thread dispositions. Round bead `open-quake-zh8.14`; evidence `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/meetings/review-round-2/`. Leave parent/physical/package acceptance open.

Task 5.2 proof: 1310 uncached tests, six forced/fresh gates with loose Turbo environment, 37 strict OpenSpec items, both bundle modes, and sequential meetings/combined native mocks. Deterministic races preserve cancel/delete in both orders and recovery; ASR/summary stay outside the capture lock. Fractional FFmpeg recovery remains 250.125 ms measured / 250 ms submitted once. All 33 capture hashes, four inspected captures, IPC proof, logs and process census are in `meetings/review-round-2/` under the scratch evidence root above. Parent, physical and packaged acceptance remain open.

## 6. Meeting history test burn-down

Lane test-meeting-history, pinned origin/main 95f6a69 includes #79-#84. Task beads
open-quake-lih.16.2, .3 and .4 remain open until lead merge.

- [x] 6.1 Pin exact MeetAI defaults, theme, protected edit ownership and saved Mark/Translate consumers. AI-265, AI-318, MGMT-360, MGMT-365.
- [x] 6.2 Exercise mounted history navigation, content, copy, request races, independent retry, responsive actions and durable templates/title. AI-275, AI-296, AI-299, AI-300, AI-303, AI-304, AI-305, AI-306, AI-307, AI-309, AI-316.
- [ ] 6.3 Exercise mounted strip timer/cooldown, main-tab animation, bounded celebration, reduced motion, scaled Clear and live translation. AI-321, AI-322, AI-329, AI-332, AI-333, AI-334, MGMT-152.

Initial pinned-main evidence: 18 mounted renderer tests, 20 device catalog/editor tests and
47 meeting-service tests pass. Repository verification totals 3153 passing tests
and 4 skipped, using the authorized direct desktop fallback with external-SSD
TMPDIR after root Turbo stripped it. Typecheck passes for all 6 packages, Biome
checks 1229 files with 14 existing warnings, build and both bundle modes pass,
and strict OpenSpec passes 47 items. Hidden native mock smoke checks both motion
owners, real Clear touch routing and 1440/980/520px inspector/header reachability;
EN/DE screenshots and logs are in the lane scratch directory.

Integration with main 5ca133a retains PR85 capture settings and PR90 media smoke
fixes. Biome checks 1231 files, all 6 typechecks, build, both sequential bundle
modes, 47 strict OpenSpec items and hidden native meetings assertions/cleanup
pass. Integrated tests total 3204 passing and 4 skipped. The root loose-environment
run had two profile-registration timeouts under host load; both cases passed
unchanged in isolation and the full direct desktop single-worker rerun passed
all 245 files with 1920 tests and 1 skipped. No deadline or assertion changed.

Task 6.3 remains partially blocked for AI-334's requested saved alternate span:
`profile-footprint.ts` forces this viewer to 5x2 and `key-geometry.ts` rejects
resizing it. Native regression pins that rejection and Clear at the supported
size; mounted consumer tests also exercise alternate box dimensions. Changing the
approved fixed-span contract needs a separate decision. All other task 6.3 rows
are implemented and tested. Physical device, microphone/system audio and paid
providers remain unverified. No hardware or real capture was opened.

## speech-capture burn-down lane

- [x] Implement platform capture, deliberate microphone-only/cancel fallback and setup help with production consumer fixtures. Evidence: renderer capture platform/partial-acquisition tests, trusted host permission/fallback tests, and mounted setup missing/installed/refresh-error/cancel checks. Bead open-quake-c5w.16 stays open for lead merge.
- [ ] Complete AI-283 driver installation and macOS multi-output configuration after separate host approval, then verify physical system audio on Windows/macOS/Linux. The lane only detects installed virtual inputs and provides manual setup help.
- [ ] Reconcile the required media native smoke failure tracked by open-quake-c5w.16.1. Two hidden mock runs timed out on the OBS panel screenshot after configuration save. Capture-specific EN/DE UI and native typed-start-error checks passed. Logs and screenshots remain external under open-quake-parity/burndown/speech-capture.
