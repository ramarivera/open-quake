# Tasks

Beads: epic `open-quake-lih.2.1` under cluster `open-quake-lih.2`; one task bead
per numbered item below (`open-quake-lih.2.1.1` … `open-quake-lih.2.1.7`).

## 1. Spec

- [x] 1.1 Write this change with recovered geometry and audit row ids; update `profiles-key-grid` (inward edge spans, forced spans) and `theming-animation-contract` (DK strip motion and palette); `openspec validate --all --strict` passes. (`open-quake-lih.2.1.1`)

## 2. Domain

- [x] 2.1 Add `packages/device/src/profiles/profile-footprint.ts` (forced spans, inward clamp) and make `occupiedCells`/`layoutIssues` use it; property tests prove inward growth, in-bounds footprints and overlap rejection. (`open-quake-lih.2.1.2`)

## 3. Strip renderer

- [x] 3.1 Add `strip/geometry.ts`: four themes, profile and cell theme resolution, slot and tile rectangles, covered cells, vivid page, `tileAt`; property tests prove no overlaps, inward growth and hidden covered cells. (`open-quake-lih.2.1.3`)
- [x] 3.2 Add the tile registry, the generic icon-and-title tile with accent sampling and title truncation, and the `dkDesktopClock` placeholder with the strip-clock props. (`open-quake-lih.2.1.4`)
- [x] 3.3 Add `StripScreen` (wallpaper layer, black grid, slots, empty dashed border, DK press motion with reduced motion) and the "Empty Slot Dashed Border" setting synchronized across windows. (`open-quake-lih.2.1.5`)

## 4. Wiring

- [x] 4.1 Add the read-only profile snapshot channel in main and preload; render `StripScreen` in `?surface=panel` and `DeviceScreen`. (`open-quake-lih.2.1.6`)

## 5. Verification

- [ ] 5.1 Update the native smoke and capture panel screenshots for at least two built-in-like profiles; run biome, typecheck, test, build, bundle smoke and strict OpenSpec validation; open the PR. (`open-quake-lih.2.1.7`)

## Verification evidence

Run in `/Volumes/ExtSSD/devplane/oq-strip-grid` on 2026-10-24:

- `pnpm biome check packages apps`: clean.
- `pnpm typecheck`: 6 tasks successful.
- `pnpm test`: protocol 25, edge 27, device 301, desktop 212 tests pass.
  Property tests: `packages/device/src/profiles/profile-invariants.test.ts`
  (inward growth, forced spans, DK edge cases) and
  `apps/desktop/src/renderer/src/strip/geometry.test.ts` (no shared cell or
  pixel, inward growth, covered cells hidden, valid layouts fully rendered,
  `tileAt` agreement). Render tests: `strip/strip.test.ts`. IPC:
  `main/profiles/profile-ipc.test.ts`.
- `pnpm build` and `pnpm --filter @open-quake/desktop test:bundle`: pass.
- Native smoke (`main/media/smoke.ts`, hidden windows, no HID): PASS. Captures
  in `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/strip-grid/smoke/`:
  `panel-quick.png`, `panel-meetai.png`, `panel-spans.png`, `panel-clock.png`,
  `panel-vivid.png`, `management-overview.png`, `management.png`.
- `openspec validate --all --strict`: pass.

Not verified: rendering on the real QUAKE strip, its colours, and frame timing.


## Device widget coverage lane

- [x] test-device-widgets: mounted panel/device/manager/editor host resize, artwork and frame coverage for MGMT-051/056/060, WIDGETS-011; real timer/rendered runtime feedback for WIDGETS-107.

- [x] Retained catalog geometry/action and nested-touch burn-down regressions for AI-145/146 and MGMT-351/353/357. Bead open-quake-lih.9.3 remains open for lead integration.
