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
