# Proposal

## Why

The QUAKE strip shows a lone clock over the wallpaper. DK-Suite 0.4.95 draws the
active profile's 2×8 key grid there: tile glass, accent glows, titles, spans,
dashed empty slots, and a different geometry per profile theme. No open-quake
spec says how to draw that grid. `profiles-key-grid` defines logical cells only,
and it rejects the edge spans DK-Suite grows inward. The audit ranks this
cluster P0: SCREEN top gap 3, MGMT top gaps 3 and 10, and WIDGETS top gap 5 in
`dark-encyclopedia/dk-suite-introspeccion/v0.4.95/audit/` (bead
`open-quake-lih.2`, GAP-MAP cluster 1).

## What Changes

- Add a strip renderer for the logical 1920×480 canvas. It takes the recovered
  geometry for the four DK themes, profile and per-cell theme resolution,
  slot backgrounds, the dashed empty slot and its setting, full-bleed tiles,
  and the layer stack (wallpaper under an opaque grid, shown only for the vivid
  screen page).
- Add one footprint function: forced spans per tile type and inward growth at
  the right and bottom edges (approved decision 2). Covered cells are hidden and
  inert.
- Add a tile registry. Each key type renders through a registered tile. The
  generic icon-and-title tile reproduces DK's `UnitControl`. The `dkDesktopClock`
  entry is a placeholder that the strip-clock lane replaces with `ClockTile`.
- Use DK's strip motion: 0.3 s press scale to 0.8 with a white glow (approved
  decision 3). The 160 ms / 4 px limits stay for the management window.
- Export a pure `tileAt(point, layout)` for the strip-touch lane.
- Deliver the committed profile envelope read-only from main to both windows.
  The panel and the management preview (`DeviceScreen`) render the same strip.

## Capabilities

### New Capabilities

- `strip-key-grid`: strip composition, grid themes, footprints, covered cells,
  slot and tile visuals, tile registry, strip press motion, hit-testing, and
  profile snapshot delivery to both windows.

### Modified Capabilities

- `profiles-key-grid` (in-flight change, edited in place): edge spans grow
  inward and type-forced spans define occupancy, replacing the out-of-bounds
  rejection.
- `ui-theming` (in-flight change `theming-animation-contract`, edited in place):
  the strip follows DK motion and DK's fixed strip palette; management keeps the
  160 ms / 4 px budget and theme tokens.

## Impact

`packages/device/src/profiles` gains `profile-footprint.ts`; `occupiedCells` and
`layoutIssues` use it. `apps/desktop/src/renderer/src/strip/` is new and owned by
this change. `apps/desktop/src/main/profiles/` gains a read-only snapshot
channel, the preload exposes it, and `App.tsx`/`DeviceScreen.tsx` render the
strip. The native smoke (`apps/desktop/src/main/media/smoke.ts`) checks the
strip and captures panel screenshots. No dependencies are added; property tests
use the `FastCheck` module re-exported by `effect`. No DK-Suite artwork is
copied: fixtures draw their own SVG glyphs. Hardware rendering on the real
strip is not verified by this change.
