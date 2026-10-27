## 1. Profiles manager parity
- [x] 1.1 Recover and verify built-in catalog, platform variants and eight-language labels with source evidence.
- [x] 1.2 Extend the atomic repository and add profile management rules, visibility, startup selection and linked apps with tests.
- [x] 1.3 Add scoped foreground polling, matching, debounce and first-connect selection delivery with deterministic tests.
- [x] 1.4 Add protected IPC, command confirmation, thumbnails and a functional management page with consumer tests and native smoke screenshots.
- [x] 1.5 Run all lane gates, update Beads and OpenSpec evidence, and publish the PR. PR: https://github.com/ramarivera/open-quake/pull/26. Evidence: `verification.md`.
- [ ] 1.6 Integrate real serial lifecycle/profile delivery and verify the hardware path with the lead. Exclude the Quake-HID twin (MAIN-085), verify startup/per-app delivery (MAIN-079/084; MGMT-333/334), and check platform-native adapters and shell confirmation. Bead `open-quake-lih.9.1.6` remains open; this lane cannot open hardware. Integration contract and verification evidence: `apps/desktop/src/main/profiles/README.md`.
- [x] 1.7 Merge main's clock/hardware/touch, knob-model and device-lifecycle features, verify and fix all PR #26 round-one review threads with behavioural regressions, run the six gates and native mock profiles/media/strip smokes, push and reply to/resolve each thread. Bead `open-quake-lih.9.1.7`.
- [ ] 1.8 Replace per-probe Windows PowerShell compilation with a scoped persistent user32 helper, test deadlines/restart/disposal and measure native Windows probe latency. Deferred review thread `PRRT_kwDOUADXpM6v3G00`, bead `open-quake-lih.9.1.8`.

- [x] 1.9 Bound canonical thumbnail cache retention. Keep current content hashes for every saved profile in all eight locales; remove obsolete owned PNGs and regular pending files older than 24 hours, preserve unrelated files/directories/symlinks, serialize cleanup with captures, and prove production registration and cleanup failures. Verified by 192 focused profile/knob/diagnostic tests, the full desktop suite, typecheck/build, and windowless native Electron cache-to-knob decoding. Bead `open-quake-57m` remains open through reviewed delivery.

- [ ] 1.10 Avoid repeated thumbnail translation/encoding for content-identical committed catalogs. Preserve all eight locale hashes, same-revision content invalidation, per-sweep orphan inspection, bounded current-catalog retention, cleanup error identity and capture/repository serialization. Verify through the actual store and production registration without increasing test timeouts. Bead `open-quake-tqb`.


## Device widget coverage lane

- [x] test-device-widgets: platform template resets/project URLs and exact SysView preset for MGMT-340/384.
- [ ] test-device-widgets remainder MGMT-384: migrate already-installed legacy SysView grids without altering custom profiles.

- [x] Mounted profile/grid burn-down regressions for MGMT-313/315/317/319/337/370/371/381/382; track remaining MGMT-079/092/120/330/336/427 and AI-147 gaps without claiming them covered. Beads open-quake-lih.9.2 and open-quake-lih.9.3 remain open for lead integration.

## Agents burn-down lane, 2026-10-26

- [x] A.1 Verify the exact ClawBotView payload, geometry, title and lock round-trip and all four DK-Claw agent IDs/positions/voice/task fields through saved preset activation. Sources MGMT-348/349; bead `open-quake-lih.17.12`; production catalog/profile binding, `apps/desktop/src/main/agents/profile-binding.test.ts`. This verifies mock activation and persistence, not physical QUAKE output or a paid provider.

## Deterministic profile recovery tests

- [x] 1.11 Drive registration initialization retries with TestClock and controlled storage failure/recovery, isolate monitor/thumbnail IO, separate locale and document authority checks, and remove unrelated catalog installation/live clocks from selection-lifecycle fixtures. Preserve typed errors, retry boundaries, IPC authority, selection commits and reset deadlines. Reproduce under load, run the fixed file 50 times concurrently with the desktop suite, and run all lane gates without raising timeouts or adding retries. Bead `open-quake-lih.9.10` remains in progress for lead merge.

Task 1.11 verification: the baseline read/write cases timed out on the first shuffled run under 12 CPU burners and a concurrent desktop suite. The final two files passed 50 shuffled serial-worker runs, 500 tests with zero failures. The slowest recovery case took 343 ms. The exact root command `pnpm exec turbo run test --env-mode=loose -- --maxWorkers=2` passed 4,220 tests with four existing skips. Six typecheck tasks, Biome with zero errors, production build, both bundle modes and all 47 strict OpenSpec items passed. Evidence is outside git in `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/burndown/fix-registration-flake/`. The deliberately saturated load-generator suite hit three unchanged test deadlines; its results remain recorded separately from the passing root gate. No production clock changes, test retries or timeout increases were needed. The lead retains review and merge; the bead stays in progress.

## Remaining desktop timing regressions

- [x] 1.12 Remove repeated full-catalog work and wall-clock waits from registration write recovery, thumbnail registration, backup compatibility, localized geometry, device profile selection and slow agent/desktop tests. Preserve real thumbnail filesystem operations, authenticated AES-256 ZIP interoperability, all eight locale geometries, and agent failure/cancellation semantics. Sweep the desktop suite under CPU stress, run each changed test file 50 shuffled times under stress without failures, and run the root gates without timeout increases or retries. Bead `open-quake-lih.9.13` stays in progress through lead review and merge.

Task 1.12 follow-up evidence: the lead's supplied registration failures used the old two-case file at line 62 on `fix/agents-windows-tree-qr`; that branch does not contain PR #123 commit 4270c95. Current `registration.test.ts` is byte-identical to PR #123 and passed 50 shuffled stressed runs, 150 tests with zero failures and a 121 ms slowest case, including typed write recovery. The device profile-manager follow-up passed 21/21 before its fixture change but took 2325 ms on the reported selection case. It now keeps every real catalog row with minimal pages and passed 50 shuffled stressed runs, 1050 tests with zero failures. All 13 files completed 50 shuffled runs under 12 CPU burners and concurrent desktop-suite load, 9950 tests passed with zero failures. File-level reports and before/after maxima are in SSD scratch `fix-timing-tests/final-evidence.json`. The exact root Turbo command passed all 4 tasks: 2953 desktop tests, 547 device tests, 936 edge tests and 63 protocol tests, totaling 4499 passed with four existing skips. Six typecheck tasks, Biome with zero errors, production build, both bundle smoke modes and 47/47 strict OpenSpec items passed. The bead stays in progress for parent review/merge; generated desktop build output was removed and the worktree retained.

## profiles burn-down lane

- [x] 2.1 Page/folder lifecycle, canonical templates and legacy action imports. Bead open-quake-lih.9.15.
- [x] 2.2 Manager properties, searchable linked apps, catalog/resource compatibility and wizard visibility. Bead open-quake-lih.9.16.
- [x] 2.3 Foreground permission, logical serial normalization and throttled reporting. Bead open-quake-lih.9.17.
- [x] 2.4 Stable media-ready thumbnails, incremental decoding, fan-out and cancellation. Bead open-quake-lih.9.18.
- [x] 2.5 Capacity-atomic imports, bounded exports, metadata and OBS restore. Bead open-quake-lih.9.19.
- [ ] 2.6 Merge current main, rerun gates and native mock EN/DE smoke, deliver PR without merge or thread resolution.

Profiles delivery, 2026-10-27: all 28 assigned rows now have requirements, production behavior and passing software regressions. The resumed wizard holds busy through both saves and retries a failed draft without rolling back committed visibility. Picker decodes survive progress revisions; changed source/session/unmount cancels old pixels. Export cancellation ends at rename submission. Backup restores retain all seven resource kinds, metadata aliases and references, merge app-library groups and reconstruct OBS. Hidden captures freeze decoded video/CSS animations and require stable frames.

Verification by GPT-6.1 Sol: root tests passed 4,989 with four existing skips, including 601 device and 3,355 desktop tests. Typecheck passed all six tasks, production build and default/mock bundle modes passed. Biome passed with 16 existing warnings and two infos. Hidden native profiles and media smokes passed; the profiles smoke now registers the real locale service and asserts the document language before EN/DE desktop/narrow screenshots. Evidence: `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/burndown/profiles/`, especially `test-final3.log`, `last-features.log`, `typecheck-final2.log`, `profiles-smoke-final7.log` and `media-smoke-final3.log`.

Task 2.6 remains incomplete because OpenSpec CLI 1.15.0 strict validation reports the shared warning-only baseline, 9 pass / 38 fail, tracked by `open-quake-lih.23.2`. Owning-change validation has nine long-requirement warnings and no ERROR entries; newly changed scenarios and export/wizard rules add no structural validation errors. No unrelated requirements or validator policy changed. Physical QUAKE delivery and native Linux/Windows acceptance remain unverified and belong to the lead. Beads `.9.15` through `.9.19` remain open for lead merge. No bot round, watch, thread resolution or merge was performed by this lane.


## PR130 review fix round

- [x] 2.7 Reconcile all eight original-head review threads in one normal push. Fix alias owner disconnects, empty visible Next Profile traversal, wizard partial-save feedback and idempotent retry, imported Switch Profile destinations, duplicate archived DeviceConfig exports, preserved device pages, and localized foreground permission guidance. Bead `open-quake-lih.9.20`. The alleged second-restore resource catalog loss was not reproduced: native JSON staging already rewrites those paths; strengthened integration assertions check the target catalog excludes the source root and preserves named kinds/custom fields. Review evidence and responses live in SSD scratch `burndown/profiles/fix1/`. Parent owns review replies, resolutions and current-head checks. Existing delivery beads `.9.15` through `.9.19`, shared strict validation failure `.23.2`, and physical/native acceptance stay open.

Review-round verification: 113 device and 85 desktop tests passed across 15 focused files, plus the existing eight-locale title preservation test. Six typecheck tasks, Biome with zero errors and unchanged 16 warnings/two infos, production desktop build, both bundle modes and hidden profiles Electron smoke passed. Four new EN/DE guidance captures at 1280px/390px verify wrapping, localization and recovery. The owning strict OpenSpec check still reports exactly nine existing requirement-length warnings with no ERROR entries. No full-root rerun or physical/native acceptance is claimed. Model: Codex GPT-6.1 Sol, high.


## PR130 final review fix round

- [x] 2.8 Freeze decoded image pixels only inside thumbnail previews, retaining the same image presentation and rejecting unreadable snapshots before the existing six-frame stability check. Reconcile the final Codex GIF finding and 15 CodeRabbit threads in one normal push. Correct deleted style-capture cleanup, duplicate Switch Profile editors, eight-locale selector/manager labels, stale wizard alerts, bounded smoke alert synchronization, independent restore-message expectations and legacy sentinel assertions. Bead `open-quake-lih.9.21` remains open for parent gates. Seven refactor/performance suggestions were declined after source inspection; full dispositions are in SSD scratch `burndown/profiles/fix2/thread-plan.json`.

Hosted validate run `40483573623` reported two thumbnail-registration failures. The permission-guidance fixture now explicitly selects macOS instead of inheriting Linux. Cleanup retains actual profile commits, startup orphan deletion and German cache retention, with explicit macOS/Linux fixtures using the real installed Quick profile instead of eight unrelated built-ins. Deadlines, assertions, retries and CI configuration are unchanged. On actual Linux `arch-cachy`, the original permission test reproduced the zero-call failure; the original cleanup timeout did not reproduce in isolation. Both corrected focused files passed 20 tests there. This is test execution on Linux, not native Linux thumbnail acceptance.

Final-round evidence: the eight changed desktop test files passed their behavior checks, with the Japanese accessible-name regression corrected in a final focused translation/capture run, 14 tests passed. The device runtime file passed 37 tests. Six typecheck tasks passed across the initial run and final desktop recheck; production build, Biome and default/mock bundle checks passed. The scratch adaptation of the existing hidden profiles Electron smoke saved a real three-frame looping GIF through production profile/emoji services and refreshed a thumbnail containing EmojiTile and GenericTile artwork. Production capture used two equal frames, the pixels still matched after 160 ms, the regular preview still animated, and the hidden capture owner was destroyed. `native-gif-final.log` and `screenshots/animated-thumbnail.png` record the passing scoped run. An earlier broader scratch smoke passed the GIF assertions and later timed out on a locale-selection condition; it is not claimed as a full smoke pass. No full-root suite or physical acceptance was rerun.

Owning strict validation still has the nine existing requirement-length warnings. The shared strict baseline remains 9 pass / 38 fail under `open-quake-lih.23.2`. MAIN-084/085 and SETTINGS-109 physical acceptance and actual Linux/Windows SCREEN-098 capture remain unverified. Parent owns current-head hosted checks, review replies/resolutions and merge; existing delivery beads remain open.

## Reviewed main integration

- [x] 2.9 Preserve key/assistant/hardware changes while integrating profile imports, thumbnail guidance, folder navigation and saved profile selection. Keep a single Switch Profile schema and registry entry with positive page destinations beyond ten. Bead `open-quake-i3j.5`.

Integration verification, 2026-10-27: the resolved source matches candidate stage `0f58a59f`, with all five later PR129 follow-up paths retained verbatim and the tested positive-page destination patch applied. Actual branch checks pass 119 desktop profile/editor/thumbnail tests, 77 device runtime tests including page eleven, and desktop typecheck. Full combined candidate verification already passed 5,353 tests, six typechecks, production build and both bundle checks. Hosted checks and bot review of this synchronized head remain pending; physical/native acceptance stays separate.

## Integrated review follow-up

- [x] 2.10 Retain hidden/deleted saved Switch Profile destinations in the editor, use one ordered visible list for saved Next/Previous, and distinguish backup cancellation before and after rename submission. Address review 5669703079; bead `open-quake-i3j.5`.

The four editor/runtime regressions fail against `340ec2ac` and pass after the fixes. All 79 device runtime tests and 75 desktop editor/export tests pass, including existing gesture filtering and committed-export checks. Saved actions retain persisted order and empty visible profiles; device slides retain numeric-name order and skip empty groups. Both owner specs now describe that distinction. Export scenarios match the existing 120-second preparation deadline and uncancellable committed rename. Heading spacing and follow-up spelling are corrected. No export runtime or gesture behavior changed. Hosted checks and review of the new head remain pending.
