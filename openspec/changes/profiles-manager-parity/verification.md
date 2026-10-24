# Profiles manager lane evidence

PR: https://github.com/ramarivera/open-quake/pull/26, against `main`.
Implementation integrates the management redesign and strip-grid and strip-touch changes at
`969d165`. The manager, strip snapshots and switching share one repository;
previews and thumbnails consume the existing strip components. No geometry
rules or dependencies were added.

All six required gates passed on the combined code:

| Gate | Result |
| --- | --- |
| `pnpm biome check packages apps` | 263 files, no fixes |
| `pnpm typecheck` | Six package checks passed |
| `pnpm test` | 635 tests passed: device 340, desktop 243, protocol 25, edge 27 |
| `pnpm build` | Passed |
| `pnpm --filter @open-quake/desktop test:bundle` | Default native path isolated through the hermetic test transport; explicit built-app mock loads no native transport |
| `openspec validate --all --strict` | 31 changes passed |

The native profiles proof passed real UI create/rename, management/panel
authorization, outbound delivery callback, the shared strip's 16 Quick tiles,
panel reload, native captures/batch, persisted startup override and narrow
overflow checks. Native macOS foreground identity and installed-app discovery
also passed. Captures wait for viewport sizing, fonts and two paint frames.
The required native media smoke passed its existing checks plus the five
strip fixture profiles and awaited disposal.

A local comparator checked every raw catalog record and committed locale
string against the recovered sources. Result: 117 records across 11 arrays,
648 exact strings across eight locales. Approved differences are six project
URLs, three project labels and clock weather disabled. Full source citations,
timings, resource IDs, missing Linux locale findings and composition are in
`apps/desktop/src/main/profiles/README.md`.

Evidence directory:
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/profiles-manager/`.
Gate output is in `biome.log`, `typecheck.log`, `test.log`, `build.log`,
`bundle.log` and `openspec.log`. Native/source output is in
`profiles-smoke.log`, `media-smoke.log` and `source-verification.log`.
Screenshots: `manager.png`, `manager-narrow.png`, `profile-settings.png`,
`selected-profile.png` and `media/*.png`.

Beads `open-quake-lih.9.1.1` through `.1.5` cover the delivered work.
`open-quake-lih.9.1.6` remains open for lifecycle serial/profile transport,
Quake-HID twin filtering, physical delivery/acknowledgments/key execution,
Windows/Linux adapter checks and native shell-dialog acceptance. The cluster
and epic remain open. Linux monitoring currently requires X11; Wayland is
unsupported. App icons and vendor dialog styling await the design lane.

All Electron runs used explicit mock mode. This lane opened no device,
started no DK-Suite process and flashed no firmware. Physical delivery is
unverified.

## PR #26 review round 1, 2026-10-24

Merged `origin/main` at `33f13ef600b0be744748474a018511b598ab5484` with all profile-manager, strip/touch, hardware-control and clock features retained. GitHub GraphQL returned 21 unresolved threads, not the expected 20. Twenty findings are fixed; the Windows PowerShell compilation finding is deferred to OpenSpec task 1.8 and bead `open-quake-lih.9.1.8` with a scoped persistent-helper plan.

Behavioural regressions cover failed switch and manager delivery without persistence/publication, retry after failure, mock close/reopen, hidden startup/saved selections, per-device eligible matching, unrelated custom deletion, hidden deletion anchors, IPC read/write initialization failures and recovery, same-origin document/query/hash navigation, Linux symlink identity and extensionless picker, command launch acceptance/failure, stale locale replies, hidden UI selection, edited regular/agent titles and smoke diagnostic failure exit.

All six lane gates pass: Biome checks 337 files; typecheck succeeds in all six packages; 799 tests pass across protocol 47, edge 27, device 370 and desktop 355; production build and both bundle-smoke modes pass; strict OpenSpec validation passes 32 changes. Native profiles and combined media/strip/touch smokes pass with `OPEN_QUAKE_MOCK_DEVICE=1` and `ELECTRON_RUN_AS_NODE` removed.

The profiles smoke exercises actual row controls to duplicate built-in and custom profiles, rejects mutations/commands after same-origin navigation, selects every built-in containing a clock key and asserts the merged `.oq-clock`, then verifies batch thumbnails, restart/default persistence and narrow layout. The clock screenshot and thumbnails were visually inspected. The media smoke verifies raw synthetic touch through the real main/preload/renderer path, grid hits, press feedback, gaps, dynamic clickable discovery, native image decode, fill modes and synchronized clocks. Hardware remains unverified.

Evidence lives under `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/profiles-manager/review-round-1/`: `biome.log`, `typecheck.log`, `test.log`, `build.log`, `bundle.log`, `openspec.log`, `profiles-smoke.log`, `media-smoke.log`, `profiles/built-in-clock-1-7.png`, manager/settings screenshots and `media/*.png`. Source tests are in `packages/device/src/profiles/profile-manager.test.ts`, `profile-catalog.test.ts`, desktop `main/index.test.ts`, `main/profiles/*test.ts` and `renderer/src/profiles/manager-view.test.ts`.
