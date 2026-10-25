# Tasks

Beads: epic `open-quake-nyd.5` (child of `open-quake-nyd`), one task bead per
item; assigned lane task `open-quake-nyd.4`.

## 1. Spec

- [x] 1.1 Write this change, point superseded deltas at it, `openspec validate --strict`. (`open-quake-nyd.5.1`)

## 2. Strip

- [x] 2.1 Device palette, flat key tiles, press feedback, runtime state chips, profiles-unavailable sheet. (`open-quake-nyd.5.2`)
- [x] 2.2 Typographic clock, scrimmed theme/custom media, flat weather and now-playing column, theme chip. (`open-quake-nyd.5.3`)
- [x] 2.3 Flat now-playing player key with guide, capability and error truth. (`open-quake-nyd.5.4`)
- [x] 2.4 Voice sheet, bar meter, opaque grid-hold sheet and toasts; flat Copilot/ClawBot/ClawBotInput. (`open-quake-nyd.5.5`)
- [x] 2.5 Knob focus ring, wheel list sheet, flat picker and volume pill; panel gauge, touch marks and offline sheet. (`open-quake-nyd.5.6`)
- [x] 2.6 Clock, monitor and weather/media settings forms on shared primitives. (`open-quake-nyd.5.7`)

## 3. Verification

- [x] 3.1 Renderer tests, typecheck, biome; hidden mock before/after captures at 1920×480 and 480×1920 for clock/theme, voice idle/listening/answer/error, grid, knob, media unavailable/playing and translations; contrast/overlap probes; parent smoke contract handoff. (`open-quake-nyd.5.8`) Parent integrated the smoke contract and verified combined native mock acceptance.

## Verification evidence

Lane worktree `t3/5166179a`, 2026-10-25. Scratch:
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-finish/redesign/device/`.

- `vitest run src/renderer/src/{strip,weather-media,panel}`: 289 tests pass;
  `tsc --noEmit` and scoped Biome are clean.
- Hidden mock native smokes (`OPEN_QUAKE_MOCK_DEVICE=1`, hidden 1920×480
  window, no HID/mic/audio). Clock, weather-media, voice (rounds 1-3) and
  media pass. Clock, weather-media and voice need the uncommitted smoke
  contract in `SMOKE-CONTRACT.md` / `smoke-contract.patch`, which the parent
  owns. The knob smoke produces every capture, then fails its final error
  check on a `management:theme` IPC. The baseline fails the same way.
- Weather error chip contrast is 6.88:1 on all five clock themes
  (`after/weather-media/weather-contrast.json`). Localized player hints
  (fr/it) fit within two lines above the source label. Copilot idle hints in
  eight locales pass glyph advance/ink/fit.
- Before captures: `before/`. After captures: `after/`. Side-by-side sheets:
  `compare-*.png`.
- Not verified: the physical QUAKE strip, real microphone/audio, and the
  monitor smoke (its artifact path is outside this lane's scratch).

## Parent integration acceptance, 2026-10-25

The combined app applies the smoke contracts. Clock, weather/media, voice
rounds 1-3, knob, monitor and key-library smokes pass against the redesigned
renderer with mock HID. The monitor and key-library harnesses now register
and dispose real appearance IPC. Explicit title bold uses the renderer's
700 weight. The 480 by 1920 profile-picker rotation capture was inspected.

Artifacts live outside the repository under
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-finish/redesign/integrated/`.
The key-library result is in `keys-review-run.log`; monitor artifacts are in
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/monitor-panel/redesign-final/`.
Isolated harnesses still report missing unrelated IPC handlers; these captures
do not establish physical strip appearance or microphone/audio acceptance.
The reviewed PR merge is pending.
