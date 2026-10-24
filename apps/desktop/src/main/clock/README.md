# Desktop clock

Implements `openspec/changes/desktop-clock` (DK-Suite 0.4.95 desktop clock,
GAP-MAP cluster 5). The tile is `src/renderer/src/strip/tiles/clock/ClockTile`;
this folder is its main-process half: settings, IPC and custom media.

## Stored schema

`<userData>/clock-v1/clock.json` keeps DK-Suite's cell shape for the
DK-Desktop-Clock profile: `{ version: 1, revision, keys }`, where the key at
`1,1` (`dkDesktopClock`) holds the `clockStyle` action exactly as DK-Suite
stores it (`background.mode/themeId/themes`, `musicEnabled`) plus the
open-quake `showSeconds` action. Profile wiring can move these actions into the
profile key verbatim. Writes go to a temp file and are renamed into place;
`revision` only changes when content does. An unreadable file reads as
defaults with `recovered: true` until the next save.

A device theme switch (`setTheme {keyCode, themeId}`, DK-Suite's
`clock-style:set-theme`) applies `buildClockThemePatch`: only `themeId`
changes and `mode` becomes `theme`. Failures answer DK-Suite's reasons
(`invalid-keycode`, `invalid-theme`, `cell-missing`, `cell-not-clock`,
`write-failed`, …), and the tile rolls its preview back. Hour format stays in
the wallpaper store.

## Bridge and permissions

`window.quakeClock` exposes `request(command)` and `onSnapshot`. Only the
app's renderer document may call it. The strip may `read` and `setTheme`;
`setMode`, `setSeconds`, `chooseMedia`, `commitMedia` and `restoreMedia`
need the management window. Every successful change is broadcast to all
windows.

## Custom media

Slots store `{ kind, path }` like DK-Suite, but only main reads `path`.
Renderers get `{ kind, name, url, available }` with
`url = oq-clock-media://theme/<id>?r=<revision>`. The privileged scheme is
registered before `app.whenReady()`, resolves the theme's saved slot, answers
404 for anything else and streams through `net.fetch` with the request's
`Range` header. Images save at once. Videos are staged as
`oq-clock-media://candidate/<token>` until management has probed their
duration (6 s timeout); shorter than 2 s is refused with DK-Suite's message.
The tile falls back to the theme's built-in art if custom media errors or has
not loaded or started playing within 5 s.

## Verification

Unit tests: `clock-store.test.ts`, `clock-ipc.test.ts`, and the renderer
tests next to the tile. The native smoke uses hidden windows, the real
preload, IPC and media scheme, and never opens HID:

```sh
pnpm --filter @open-quake/desktop build
pnpm --filter @open-quake/desktop exec electron-vite build --config src/main/clock/smoke.config.ts
env -u ELECTRON_RUN_AS_NODE pnpm --filter @open-quake/desktop exec electron out/clock-smoke/smoke.js <screenshot dir>
```

It checks DK geometry, the 2×380 ms minute flip in the compositor, reduced
motion, all five themes and None, ◀/▶ save and a forced save failure rolling
back, 12h with seconds, custom image and recorded video, broken-media
fallback, the short-video refusal and the missing-file marker. Set
`OPEN_QUAKE_SCRATCH` to keep its throwaway profile off the system temp
directory. The strip itself and touch on the ◀/▶ buttons need the hardware.
