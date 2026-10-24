# Strip renderer

Implements `openspec/changes/strip-key-grid`. The QUAKE strip and the
management preview (`ui/DeviceScreen.tsx`) both render `StripScreen` on a fixed
1920×480 canvas; `StripViewport` scales it to its container.

- `geometry.ts` is pure. It holds the four DK themes, profile and cell theme
  resolution, `stripLayout(profile, page)` (slots, tiles, covered cells, vivid
  page), and `tileAt(point, layout)`. Footprints come from
  `packages/device/src/profiles/profile-footprint.ts`, shared with
  `profiles-key-grid` occupancy.
- `tileRegistry.tsx` maps a key type to its tile component. Tiles receive
  `{ tile, context }`; `context` carries the host clock and saved hour format.
  Unregistered types draw `tiles/GenericTile.tsx`, DK's icon-and-title tile.
- `palette.ts` is DK's fixed strip palette. The strip does not follow the app
  theme; status overlays do.
- `useStripProfiles.ts` decodes the read-only `profiles:snapshot` channel from
  `main/profiles/profile-ipc.ts`. `selection.ts` picks the device's page.
- `stripSettings.ts` stores "Empty Slot Dashed Border" in localStorage and
  syncs it between windows.

## Seams for other lanes

- **strip-clock:** replace `ClockPlaceholder` in `tileRegistry.tsx` with
  `ClockTile` from `tiles/clock/`. It receives `{ widthPx, heightPx, now, theme }`
  (1920×480 on the strip). `theme` is `"season"` until the clock reads it from
  the key.
- **strip-touch:** call `tileAt(normalizedPoint, layout)`. It returns the visible
  tile whose rendered slot contains the point, with `keyCode`,
  `supportTouchEffect`, `hasTouchableSubElements` and `pressFeedback`, or
  nothing. Pass the held key to `StripScreen`'s `pressedKeyCode` to show DK's
  press.
- **knob / profile switching:** `selectStripPage(envelope, serial)` picks the
  page. A switcher can pass its own selection instead.

## Verification

`geometry.test.ts` holds the property tests (no shared cells or pixels, inward
growth, covered cells hidden, valid layouts fully rendered, `tileAt`
agreement). `strip.test.ts` renders the fixtures in
`main/test/strip-fixtures.ts`. The native smoke in `main/media/smoke.ts`
captures `panel-<profile>.png` for each fixture. Hardware rendering on the real
strip is unverified.
