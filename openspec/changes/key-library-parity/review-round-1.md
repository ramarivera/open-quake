# PR 35 review round 1

Implemented by Codex (gpt-6.1-sol) on `lane/key-library` in `/Volumes/ExtSSD/devplane/oq-key-library`.

Started at `f10f58425ff17b8d9986d1d9ed716bd3b2f9c8eb`. Normal merges `8593541` and `9774268` include main through `639924d7f6ca1e79f9b72dc14905502d9ae3f277`, including the shared voice and maintenance owners. Source fixes are `b7c8ee7c03fefd9e7f2c9675e1c3fb68c8a5d8aa`. The final handoff SHA is recorded in the external round report after the tracking commit.

Task `open-quake-lih.10.2.10` completes OpenSpec task 7.1. Physical acceptance `.8`, remaining icon presentation/resource fallback `.9`, their epic, and package acceptance remain open. This round preserves editing drafts, Save/revert, translated titles, icon packs, exact `@mdi/svg@7.4.47`, switches, countdowns, sequence feedback, gestures and awaitable owner disposal.

All thirteen original open threads were independently confirmed and fixed:

- `4JeY`: Real HID disconnect/error now resets key runtime. Bus teardown awaits reset. Reset serializes with activation and interrupts work before clearing state. Fake-HID composition, late-shortcut completion and sequence cancellation regressions cover ordering.
- `4Jeu`: Host keyboard is explicitly unavailable in this desktop build. Hardware settings disable it and reject forged host-mode requests before mutation. Device keyboard remains the supported route. No host input implementation is claimed.
- `4Je4`: Exact navigation schemas reject missing, zero, fractional and malformed previous/next actions before navigation. Valid targets retain clamping and wrapping.
- `4JfO`: Native font lookup supports installed macOS, Windows and Linux fonts plus an explicit CI override. Missing fonts fail clearly. Lookup tests cover all three; native Chromium decode ran on this host.
- `4Jfg`: Sequence changes merge into original config, retaining unknown step/config fields.
- `4Jfy`: Main supplies the owned panel identity. Initial and queued execution checks enforce window/document/frame authority. IPC and native third-window spoof regressions reject unauthorized activation/navigation.
- `4JgG`: Complete inert-SVG parsing validates every token, attribute and closing tag with bounded input/depth. Malformed, unknown and unsafe markup rejects. Native pack/font import remains covered.
- `4Kb2`: Complete tap pairs serialize through slow/failing requests. Cancellation discards queued taps while releasing an in-flight press.
- `4Kb5`: Committed selection updates refresh retained feedback. Production registration tests cover a countdown finishing while inactive and returning through an external commit.
- `4Kb7`: Unsupported retained records are excluded before every activation branch. Consumer tests cover otherwise executable shortcut, text, application, timer and navigation payloads.
- `4Kb-`: Overlay takeover cancels a slide before point/end processing, retaining ownership until lift. Native touch verifies no navigation from the cancelled contact and successful independent swiping afterward.
- `4Kb_`: Executable comparison ignores only editor row IDs. Real preview/save tests permit cosmetic legacy-sequence edits while rejecting changed executable payloads.
- `4KcA`: The editor grid receives the wallpaper snapshot. Native format changes assert AM/PM on the actual clock preview and retained auto-save.

Every suffix above belongs to the full thread prefix `PRRT_kwDOUADXpM6v`. All thirteen received evidence replies naming the full source SHA and Codex attribution before resolution. GitHub confirmed every resolution. The external disposition ledger records the full IDs, reply bodies, source SHA, GitHub reply IDs and resolution results.

All six fresh gates passed on this source, with no cache hits for typecheck/tests/build:

- `pnpm biome check packages apps`: 587 files.
- `pnpm typecheck --force --concurrency=1 --env-mode=loose`: passed.
- `pnpm test --force --concurrency=1 --env-mode=loose -- --maxWorkers=2 --no-cache`: 1,312 tests in 144 files. Protocol 60, device 420, edge 159, desktop 673.
- `pnpm build --force --concurrency=1 --env-mode=loose`: passed.
- Desktop `test:bundle`: default HID with hermetic I/O and explicit mock modes both passed, including awaited quit. No hardware opened.
- `openspec validate --all --strict`: 38 items passed.

Sequential real Electron mock smokes for key-library, media baseline and voice all passed. Each used `OPEN_QUAKE_MOCK_DEVICE=1`, unset `ELECTRON_RUN_AS_NODE`, and unique owned ExtSSD temporary/smoke paths. All three tracked process groups exited without remaining processes. The key-library run registered real profile/key, voice, media, clock, lifecycle and maintenance owners against synthetic data, and had zero renderer/handler errors.

Fresh captures include saved editing controls, MDI search/zoom, the narrow library, countdown, sequence progress, the 12-hour clock preview, the baseline clock and voice completion. These were visually inspected. All 63 captures have SHA-256 hashes in the native capture manifest.

Evidence root: `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/key-library/review-round-1/`.

- Planning and feedback: `planning-validation.log`, `bd-prime.txt`, `feedback-start.json`, `threads-start.json`, `feedback-finish.txt`, `threads-finish-before-replies.json`.
- Reproduction and regressions: `regression-red-device.log`, `regression-red-desktop.log`, `regression-green-device.log`, `regression-green-desktop.log`, `ipc-regressions-retry.log`, `sequence-save-regressions.log`, `disconnect-regressions.log`.
- Gates: `gate-results.json` and `gate-{biome,typecheck,tests,build,bundle,openspec}.log`. `run-gates.py` records exact commands and environment.
- Native: `native-attempt-1/native-results.json`, per-domain build/run logs, capture directories and `capture-sha256.json`. `run-native.py` records process ownership and cleanup.
- Source delivery: `source-commit.log`, `source-push.log`; final tracking/push and thread API receipts are recorded alongside them.

Retries and limits are explicit. The first Biome pass caught duplicate clipboard stubs introduced by merging; the final fixture retains the stricter no-access proxy. Initial type/test iterations exposed incomplete new fixture data/types and a missing reset method in the main test double; they were corrected without weakening assertions. The first full test attempt also failed unchanged maintenance backup suites because Turbo stripped `TMPDIR`, causing fixtures to use symlinked macOS `/tmp`. A focused owned-environment run passed; the final gates use `--env-mode=loose` to preserve the required scratch environment. No maintenance production code was changed to accommodate this.

The isolated media smoke logs 18 missing maintenance-handler warnings. The isolated voice smoke logs six missing maintenance-handler and eight missing key-handler warnings. Those fixtures intentionally register fewer owners than main; their feature assertions still passed. The fully composed key-library native run has no such warnings. No real input effects, physical QUAKE, firmware flashing or packaged acceptance is claimed. No paid review was requested; pushing can start the included automatic review, whose result belongs to the parent acceptance round.
