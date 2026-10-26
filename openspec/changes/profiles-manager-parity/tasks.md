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
