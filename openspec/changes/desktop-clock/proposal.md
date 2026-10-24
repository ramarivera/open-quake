# Proposal

## Why

The panel clock open-quake ships today is a large SVG text clock with seconds. Ramiro called it ugly, and it is not what DK-Suite 0.4.95 puts on the strip. DK-Suite 0.4.95 replaced its 0.4.52 roll clock with a full-strip "Liquid Glass" desktop clock: glass flip digits where only the minute-ones column flips, five themed backgrounds with per-theme glass tints, optional custom image or video per theme with a 5 s fallback, and on-device ◀/▶ theme buttons that save the choice and roll back if the save fails. The 0.4.95 audit ranks this the top widget gap (AUDIT_WIDGETS §5 gap 1; GAP-MAP cluster 5; bead `open-quake-lih.6`).

## What Changes

- Replace the planning-only `desktop-clock` change with a contract taken from the recovered 0.4.95 sources (`dkDesktopClock.vue`, `DkFlipClock.vue`, `DkClockBackground.vue`, `shared/clockContract.js`, `shared/clockThemePatch.js`). It uses their geometry, timings, tokens and strings verbatim, and every requirement cites its audit rows.
- Add a standalone `ClockTile` renderer component at `apps/desktop/src/renderer/src/strip/tiles/clock/`. Its props are `{ widthPx, heightPx, now, theme }` plus optional extensions. The strip-grid lane (`open-quake-lih.2`) registers it in the tile registry.
- Persist the clock style (theme, background mode, per-theme custom media, seconds option) in a main-process store. That store accepts DK-Suite's `clockStyle` action shape and applies DK's narrow theme patch, so profile wiring can later move it into the profile key unchanged.
- Serve custom media through an opaque per-theme protocol URL. The renderer never sees file paths. DK-Suite instead put the encoded absolute path in the URL and kept an allow-list.
- Add a "Desktop clock" settings section to management (theme cards, Theme/None, seconds, change/restore background) and a live preview that ticks. DK-Suite freezes its PC preview at mount (WIDGETS-029).
- Temporary mount: until strip-grid renders profiles, the panel surface shows the clock full-strip as the DK-Desktop-Clock profile.
- Seconds become an optional setting, off by default, so the default matches DK-Suite's minutes-only look (approved decision 6, 2026-10-23).
- Weather and now-playing cards are owned by `open-quake-lih.7`. This change defines only their typed slot props and renders nothing when they are absent.

## Capabilities

### New Capabilities

- `desktop-clock`: DK-Suite 0.4.95 desktop clock tile, its theme/background contract, theme persistence with rollback, and the clock settings section.

### Modified Capabilities

None. `device-screen-wallpaper` "First-release clock" still says seconds update every second. With this change the DK clock replaces that clock on the panel, and the conflict (WIDGETS-030) is handed to the spec-corrections bead `open-quake-lih.20` rather than edited here.

## Impact

- `apps/desktop/src/renderer/src/strip/tiles/clock/` (new): tile, flip sequencer, background layer, theme nav, settings section, built-in theme art, strings.
- `apps/desktop/src/shared/clock-*.ts` (new): pure clock-style contract, IPC schemas, error catalog leaves.
- `apps/desktop/src/main/clock/` (new): store, IPC, media protocol.
- `apps/desktop/src/preload/index.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/renderer/src/App.tsx`: one-line registrations and the temporary mount.
- No new npm dependencies. No device commands: the clock is rendered on the strip as an extended display, exactly as DK-Suite does (AUDIT_WIDGETS §1).

Research: `~/dev/dark-encyclopedia/dk-suite-introspeccion/v0.4.95/audit/AUDIT_WIDGETS.md` §2.2 (WIDGETS-020…063), §3.1, §4 F1/F4, §5 gap 1; recovered sources under `.../v0.4.95/recovered_sources/src/`.
