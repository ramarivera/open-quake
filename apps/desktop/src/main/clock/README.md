# Desktop clock

Implements `openspec/changes/desktop-clock` (DK-Suite 0.4.95 desktop clock,
GAP-MAP cluster 5). The tile is `src/renderer/src/strip/tiles/clock/ClockTile`;
this folder is its main-process half: settings, IPC and custom media.

## Stored schema

Production clock settings live in `<userData>/profiles-v1.json`. Each
`dkDesktopClock` key owns `hourFormat`, `clockStyle` and `showSeconds` actions.
The profile owner commits updates to the explicitly named profile, page and key,
increments that profile's revision, and preserves unrelated fields. Both the key
editor and strip read this configuration. Two profiles can keep different formats,
seconds options, themes and custom media after restart. Screen settings use the same serial-scoped profile and page as the strip preview.
They remain absent when that page has no clock. The editor saves a dirty key draft
before changing clock configuration, skips that write for an unchanged draft, and
refreshes its editing revision after a clock save. Wallpaper settings no longer own clock rendering.

Before the first profile snapshot, the owner migrates the legacy
`clock-v1/clock.json` and `wallpaper-v1/settings/<sha256(serial)>.json` stores.
Existing non-default profile actions win. Missing actions and actions equal to the
built-in defaults inherit legacy settings, then defaults. Styles match by key code.
For hour format, serials selecting the profile win in lexical order, followed by
`desktop-preview`, then all remaining saved serials in lexical order. Validated wallpaper backups supply missing or invalid primaries. A fresh installation persists built-in
profiles before migration, so an interrupted migration can't leave an empty seed.

The profile file's atomic rename commits both migrated values and
`clockConfigVersion: 1`. Failure keeps migration retryable. A completed migration
doesn't read or overwrite legacy data again. Both legacy stores remain untouched,
including on failure. Unusable legacy data supplies defaults and a scrubbed `QUAKE.CLOCK.CONFIG_INVALID`
diagnostic on stderr, so it cannot block profile publication. The standalone `ClockLive` without a profile port retains the legacy file
adapter for isolated compatibility tests; the application always supplies its
profile owner. After migration, backups collect custom media only from canonical clock keys,
skipping the abandoned legacy clock record and unreferenced legacy clock assets.
Legacy archive imports migrate only imported profiles before deduplication, so
repeat imports are idempotent and destination clocks remain unchanged. Paths
restore through the existing portable archive owner.

A theme switch applies `buildClockThemePatch` to that clock key. Only `themeId`
changes and `mode` becomes `theme`. Failures retain DK-Suite's reasons and the
tile rolls its preview back. Defaults remain 24h, minute-only, season theme.
DK-Suite 0.4.95 itself has no seconds. Evidence is
`~/dev/dark-encyclopedia/dk-suite-introspeccion/v0.4.95/audit/AUDIT_WIDGETS.md`,
WIDGETS-030, backed by `recovered_sources/src/views/Components/dkDesktopClock.vue:140-153`.
GAP-MAP decision 6 retains optional seconds, off by default. Both desktop-clock
and device-screen-wallpaper specs now agree on this behavior, resolving b1b.

## Bridge and permissions

`window.quakeClock` exposes `request(command)` and `onSnapshot`. Only the
app's renderer document may call it. The strip may `read` and `setTheme`;
`setMode`, `setHourFormat`, `setSeconds`, `chooseMedia`, `commitMedia` and `restoreMedia`
need the management window. Every successful change is broadcast to all
windows. Listeners accept only their explicit or initially resolved target.

## Custom media

Slots store `{ kind, path }` like DK-Suite, but only main reads `path`.
Renderer profile responses and broadcasts replace clock media paths with opaque
`clock-media:` references, including compatibility copies. Main restores references
only against the original saved key when the editor previews or saves a draft.
Renderers get `{ kind, name, url, available }` with
`url = oq-clock-media://theme/<id>?r=<revision>&t=<encoded profile/page/key>`. The privileged scheme is
registered before `app.whenReady()`, resolves the theme's saved slot, answers
404 for anything else and streams through `net.fetch` with the request's
`Range` header. Electron webRequest checks the browser-owned requesting frame before serving media. Only subresources of the exact app document and the isolated main-owned video probe may load it. Navigating an app window away revokes that document's access. Images save at once. Videos are staged as
`oq-clock-media://candidate/<token>`. Management probes for feedback, and main independently decodes the candidate in a hidden sandboxed window without a preload or app bridge before committing. Both probes have a 6 s timeout; management's supplied duration is only a hint. Shorter than 2 s is refused with DK-Suite's message.
The tile falls back to the theme's built-in art if custom media errors or has
not loaded or started playing within 5 s.

## Verification

Unit tests: `clock-store.test.ts`, `clock-ipc.test.ts`, and the renderer
tests next to the tile. The native smoke uses hidden windows, the real
preload, IPC and media scheme, and never opens HID:

```sh
pnpm --filter @open-quake/desktop build
pnpm --filter @open-quake/desktop exec electron-vite build --config src/main/clock/smoke.config.ts
env -u ELECTRON_RUN_AS_NODE OPEN_QUAKE_MOCK_DEVICE=1 pnpm --filter @open-quake/desktop exec electron out/clock-smoke/smoke.js <screenshot dir>
```

It checks DK geometry, the 2×380 ms minute flip in the compositor, reduced
motion, all five themes and None, ◀/▶ save and a forced save failure rolling
back, 12h with seconds, custom image and recorded video, broken-media
fallback, short-video refusal despite a forged management duration, media denial after navigation, shared wallpaper subscriptions, raw synthetic touch frames through the merged sub-target registry, and the missing-file marker. Each effective theme-button tap saves exactly once. Set
`OPEN_QUAKE_SCRATCH` to keep its throwaway profile off the system temp
directory. The strip itself and touch on the ◀/▶ buttons need the hardware.

## Profile configuration acceptance, 2026-10-26

`profiles/clock-migration.test.ts` covers fresh, legacy-only, partial, failed-write,
repeat, serial conflicts, a physical-serial-only legacy store, corrupt legacy and
interrupted first-start migration. `profiles/clock-profile-binding.test.ts` covers
profile independence, restart, failed saves, invalid targets and scoped media URLs.
`maintenance/clock-backup.test.ts` proves both profile formats and media survive an
archive restore after the external source disappears. Existing clock timing,
midnight/noon, locale and DST tests remain part of the full gate.

The hidden native profile smoke uses the production profile owner, clock IPC,
preload, editor and panel. It saves 12h plus seconds in A, proves B and unrelated
fields stay unchanged, switches to 24h without seconds in B, and restarts the
owners before checking both again. It never starts a native device bus.

```sh
pnpm --filter @open-quake/desktop exec electron-vite build --config src/main/clock/profile-smoke.config.ts
env -u ELECTRON_RUN_AS_NODE OPEN_QUAKE_MOCK_DEVICE=1 pnpm --filter @open-quake/desktop exec electron out/clock-profile-smoke/profile-smoke.js <screenshot dir>
```

Native evidence is under
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/clock-profile/`.
`screenshots/profile-smoke-result.json` records 11 passing assertions. Screenshots are
`screenshots/profile-a-12h-seconds.png`, `screenshots/profile-b-24h-minutes.png`
and `screenshots/profile-a-after-restart.png`. Physical QUAKE acceptance remains
open in task 4.2 and bead open-quake-t10.6.

Final gates passed: Biome 1,155 files, 14 existing warnings; six-package typecheck;
2,881 passing tests and four existing skips; build; two-mode bundle smoke;
46/46 strict OpenSpec changes. Run the full suite with scratch variables passed
through Turbo and package concurrency 1 to avoid parallel host contention.
The required wallpaper native smoke passed too. Full logs are named in the
OpenSpec tasks file. The three assigned beads remain open for lead acceptance.
