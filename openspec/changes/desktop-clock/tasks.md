# Tasks

Each numbered task has one Beads issue under the `desktop-clock` epic `open-quake-lih.6.1` (child of `open-quake-lih.6`) that references this file.

## 1. Contract

- [x] 1.1 Clock style contract in `apps/desktop/src/shared/clock-style.ts`: theme ids and order, slot and extension rules, `normalizeClockStyle` with v0.3 migration, `resolveBackground`, `cycleTheme`, `buildClockThemePatch` with DK failure reasons; unit tests (WIDGETS-031/033/034/038/062). Evidence: `clock-style.test.ts` (12 tests, including property tests that normalisation is total and idempotent and that the patch never touches other keys).
- [x] 1.2 Time and label derivation: two-digit hours, 12h/AM-PM, weekday and date per locale from DK's 8 locale tables, next-boundary delay with seconds option; unit tests for midnight, noon, locales and boundaries (WIDGETS-022/024/025/029/030/063). Evidence: `clockTime.test.ts`.

## 2. Tile

- [x] 2.1 Flip digits and the two-phase flip sequencer with reduced motion; fake-timer tests for 380 + 380 ms, restart and disposal (WIDGETS-026/027/028). Evidence: `clockTiming.test.ts`; the native smoke measured 381 + 381 ms in the compositor.
- [x] 2.2 `ClockTile` stage, glass tokens, theme tints, scrim, scaling and the typed weather/now-playing slot; static render tests at 1920×480 and scaled (WIDGETS-023/032/036/061, §3.1). Evidence: `ClockTile.test.ts`. The native smoke measured rail x 80–320 and flip block x 726–1434. Over DK's own art, the render differs from DK's recovered CSS by 1–2/255 on average outside the minute digits.
- [x] 2.3 Background layer with open-quake's own built-in art for the five themes and custom image/video with the 5 s fallback, generation guard and hidden-pause; tests for the fallback controller (WIDGETS-031/035). Evidence: `clockTiming.test.ts`, plus native smoke steps for custom image, recorded video, broken video and missing file.
- [x] 2.4 On-device theme nav with press feedback, sub-touch contract, optimistic preview and rollback; tests for rollback on failure and rejection and for stale results (WIDGETS-037/038/039). Evidence: `themePreview.test.ts`; the native smoke forced a read-only store and saw the preview roll back.

## 3. Persistence and hosts

- [x] 3.1 Main-process clock store (`clock-v1/clock.json`), catalog error leaves, IPC read/set-theme/configure with panel and management permissions, and the `oq-clock-media` protocol; tests for patching, revisions, write failure and media resolution (WIDGETS-034/038/059). Evidence: `clock-store.test.ts`, `clock-ipc.test.ts`, and the bundle smoke asserting the scheme registration.
- [x] 3.2 Management Desktop clock settings on the Screen page (hour format stays in its Clock group): Theme/None, theme cards with badges and missing-file marker, change/restore background with video duration check, seconds switch, live preview (WIDGETS-056/058/059/060). Evidence: the native smoke management captures and its short-video refusal step.
- [x] 3.3 Strip integration: `dkDesktopClock` renders `ClockTile` through the strip tile registry, replacing strip-grid's `ClockPlaceholder`, with defaults when the clock store is unreachable (WIDGETS-020/021). Evidence: `strip.test.ts` clock cases. The clock smoke serves the DK-Desktop-Clock fixture profile to the real panel surface. The media smoke's `panel-clock` capture runs through the same registry.

## 4. Acceptance

- [x] 4.1 Gates (biome, typecheck, tests, build, bundle smoke, `openspec validate --all --strict`) and a native Electron smoke with `OPEN_QUAKE_MOCK_DEVICE=1`. It captures 1920×480 screenshots of all five themes, None, 12h with seconds, a forced save rollback and the 5 s fallback. Hardware stays unverified.
- [ ] 4.2 On the QUAKE (lead-owned hardware): the panel shows the clock full-strip on the strip, all five themes render, and ◀/▶ by touch switch and persist the theme once the touch lane dispatches `quake-sub-touch-*`. Capture with `screencapture -D 2` and get Ramiro's confirmation for the touch steps.

## 5. Review fixes

- [x] 5.1 Merge main strip-touch integration, exercise theme buttons through the sub-touch registry, verify the ten PR #25 review threads, preserve unknown key metadata and legacy media, recover unreadable settings, keep post-commit cleanup failures from reverting saved themes, secure custom-media access, validate video duration independently of management, avoid DST timer loops, reuse the management wallpaper snapshot and expose one accessible time label. Run all six lane gates and both mock native smokes before pushing. Covers WIDGETS-019/029/034/037/038/059/060/062. Bead: `open-quake-lih.6.1.12`.

Review round 1 evidence: fixes `9ea0bf3`, current-main integration `e3ab3f4` through `4f736cf`. Nine threads fixed, one declined against recovered DK cycle semantics; all ten replied to and resolved via GraphQL. All six lane gates passed: 749 tests across four packages and 31 strict OpenSpec changes. Both mock native smokes passed, including effective theme-button sub-touch through the registry, trusted short-video rejection and media denial after navigation. A clock animation-trace timeout did not recur in the diagnostic rerun at 383 + 382 ms; timeout diagnostics are retained. Logs and screenshots: `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/strip-clock/review-round-1/`. Physical QUAKE verification stays open as task 4.2.

## 6. Device visual review

- [x] 6.1 Visual review against hidden 1920×480 mock-device captures (`open-quake-hbe.6`): on the anime theme the thin white hour digits disappear into the cumulus behind the cards. Add an anime-only digit shadow and leave DK's glass tokens and the art composition unchanged. Recapture before and after. Evidence: hidden mock-device smokes (`OPEN_QUAKE_MOCK_DEVICE=1`, no HID) before/after under `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-finish/visual-opus/{before,after}/`; Biome, desktop typecheck, 296 focused renderer tests and strict OpenSpec pass. Physical strip legibility remains hardware-unverified.
