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

## Strip burn-down 2026-10-26

- [x] Shared logical viewport, runtime placeholders, accepted theme/span rendering, overlay ordering and complete repaint. Bead open-quake-lih.10.10.
- [x] Live empty borders and bounded management feedback, exclusions and clock hover. Bead open-quake-lih.10.11.
- [ ] Complete WIDGETS-001 specialized dispatch and provider coverage. Bead open-quake-lih.10.12.

### Strip burn-down evidence

Verified on 2026-10-26 after merging main 31c400cc, including monitor panels #100
and locale #105. Root test command used `--env-mode=loose -- --maxWorkers=2`:
protocol 63, device 515, edge 877 and desktop 2627 passed, with four existing
skips. Biome checked 1401 files with zero errors, 14 warnings and one info.
Typecheck passed all six tasks; build, bundle smoke and strict OpenSpec
validation passed, with 47 spec items. The production hidden Electron smoke
passed using mock devices, muted windows and the canonical locale bridge.
The focused native render exercised 346 assertions and 96 theme/span/host
renders, real picker/wheel/voice composition, portrait fitting and reduced motion.
Evidence and English/German captures live under the strip lane scratch root,
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/burndown/strip/`.

WIDGETS-001 remains partial. Main's individual monitor renderers are retained and
covered by mounted decoded-bridge tests. Camera/printer sessions, AudioBot and
reversible game mode still need their software providers and decoded bridges;
local audio remains truthfully unavailable. This is not a hardware-only gap.
No real QUAKE, camera, microphone or audio playback was used. Physical display
colour, USB delivery, touch and frame timing remain unverified. All three lane
beads remain open for lead integration.

## PR #110 review round one

- [x] Merge main grid-editor while preserving both branches' interactions and all tests. Bead open-quake-lih.10.11.1.
- [x] Include saved empty borders in manager and knob thumbnail identity, pin captures to that preference, and regenerate existing manager thumbnails. Failing-first controller/storage regressions, knob handoff and mounted capture tests cover Devin 4380317254.

- [x] Remove unused config/eventInfo from runtime placeholders. SCREEN-022 now specifies the renderer's coordinate-only record. Existing hidden-slot, profile replacement and independent editor-default coverage remains; the added no-unused-payload regression fails before the fix. Devin 4380317447.

- [x] Isolate style-regeneration capture failures and retain same-value retries for failed profiles. Failing-first two-profile regression covers Codex 4380623860.

- [x] Preserve retained thumbnail capture style through pending and failed regeneration. Main snapshots carry the captured border preference; a failing-first mounted controller regression also accepts identical replacement pixels. Codex 4380698050.

## 8. key-runtime burn-down

- [ ] 8.1 Render scoped countdown/alert/progress/artwork and page indicator; test EN/DE mock native views. Beads open-quake-lih.10.23/.24.
- [ ] 8.2 Connect authorized management opening and specify/test multi-screen no-op. Bead open-quake-lih.10.22/.24.
