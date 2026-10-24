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
