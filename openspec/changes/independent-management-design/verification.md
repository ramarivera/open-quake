# Verification: independent-management-design

Lane `open-quake-nyd.2` (Opus design lead), 2026-10-25. All renders are hidden mock-device
Electron runs of the actual app root, preload and React UI (`OPEN_QUAKE_MOCK_DEVICE=1`,
transparent non-focusable windows, activation policy prohibited). No device, DK-Suite,
microphone, audio or network provider was used. Artifacts stay in the lane scratch
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-finish/redesign/management/`
and are not committed.

## Why this exists

Ramiro rejected the DK-Suite imitation, and the previous pass changed only three
legibility details. This change replaces the palette, tokens, controls, navigation IA,
narrow layout and page structure. It keeps every route, deep link, persisted
preference and feature control.

## Evidence

| Check | Result |
|---|---|
| Desktop vitest (non-symlinked TMPDIR) | 1278 pass on the lane. Under the default `/var` symlink TMPDIR, 27 existing main-process backup symlink-guard tests fail, independent of this change. |
| Renderer vitest on integration branch | 493 pass, including ManagementShell, navigation IA, LanguageControl and theme contrast (all three palettes: text ≥7:1, muted ≥4.5:1, borders ≥3:1). |
| Typecheck / Biome / OpenSpec strict | pass / pass (warnings only) / valid |
| Before captures | `before/`: 13 pages × grey/light × 1180 + true 390 viewport (`report.json`) |
| After captures | `after/`: 13 pages × Graphite/Midnight/Paper × 1180 + 390 = 78 renders. Document never scrolls horizontally, exactly one `aria-current` row each, no unnamed controls. |
| Nav fit | 13/13 rows visible without sidebar scroll at 1180×860 in all three themes |
| Drawer interaction (390) | closed+inert → Menu opens and focuses the current row → Escape closes and returns focus → choosing Keys navigates, closes and returns focus (`drawer/`, `integration-shots/report.json`) |
| Locale (integration branch) | Display popover German → `html lang=de`, "Sprache" heading in popover and Appearance, both controls checked `de`. Back to English restores it. |
| Comparison sheets | `compare-grey-1180.png`, `compare-grey-390.png`, `after-light-dark-1180.png` |

Capture viewport: the host work area is 1280×627, so screenshots use 1180×620 and
390×620 emulated viewports. Before captures were emulated at 860 tall and clipped at 627.

## Known gaps (recorded, not hidden)

- Root smokes (parent-owned) still assert the DK 82 px rail, click the old labels
  (OpenClaw, Knob Profile, Meeting), and read the HA title as `h2`. These were not rerun
  on this lane; task 6.2.
- Agents at 390: one chat-lane button overflows the viewport (right edge 484 px) in
  the f7b8e37 workspace. It is owned by nyd.3 and reported to them.
- Strip previews (Overview, Keys, Screen) render the device lane's StripScreen. Glass
  and glow tiles disappear only once nyd.4 integrates.
- Some content copy is still recovered DK wording from shared string tables (for example
  "Detect QUAKE Device Connection", "Knob Profile" headings). Visual structure changed;
  a copy rewrite was not done.
- ClockSettings, MonitorSettings and WeatherMediaSettings forms are owned by nyd.4 and
  inherit the shared primitives.
- Windows title-bar overlay padding and Linux in-app header are implemented but not
  natively verified. Main's first-run fallback colour is still DK grey for one frame
  (parent seam).
- No physical QUAKE or packaged-app acceptance.
