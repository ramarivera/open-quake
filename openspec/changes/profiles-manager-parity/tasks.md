## 1. Profiles manager parity
- [x] 1.1 Recover and verify built-in catalog, platform variants and eight-language labels with source evidence.
- [x] 1.2 Extend the atomic repository and add profile management rules, visibility, startup selection and linked apps with tests.
- [x] 1.3 Add scoped foreground polling, matching, debounce and first-connect selection delivery with deterministic tests.
- [x] 1.4 Add protected IPC, command confirmation, thumbnails and a functional management page with consumer tests and native smoke screenshots.
- [x] 1.5 Run all lane gates, update Beads and OpenSpec evidence, and publish the PR. PR: https://github.com/ramarivera/open-quake/pull/26. Evidence: `verification.md`.
- [ ] 1.6 Integrate real serial lifecycle/profile delivery and verify the hardware path with the lead. Exclude the Quake-HID twin (MAIN-085), verify startup/per-app delivery (MAIN-079/084; MGMT-333/334), and check platform-native adapters and shell confirmation. Bead `open-quake-lih.9.1.6` remains open; this lane cannot open hardware. Integration contract and verification evidence: `apps/desktop/src/main/profiles/README.md`.
- [x] 1.7 Merge main's clock/hardware/touch, knob-model and device-lifecycle features, verify and fix all PR #26 round-one review threads with behavioural regressions, run the six gates and native mock profiles/media/strip smokes, push and reply to/resolve each thread. Bead `open-quake-lih.9.1.7`.
- [ ] 1.8 Replace per-probe Windows PowerShell compilation with a scoped persistent user32 helper, test deadlines/restart/disposal and measure native Windows probe latency. Deferred review thread `PRRT_kwDOUADXpM6v3G00`, bead `open-quake-lih.9.1.8`.
