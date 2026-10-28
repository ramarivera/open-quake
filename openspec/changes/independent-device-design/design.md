# Design

## Context

Design authority is with the Opus lanes. The management lane (`open-quake-nyd.2`)
is the design lead and owns `DESIGN-BRIEF.md` / `design-system.json` in the
shared scratch `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-finish/redesign/`.
This lane owns the device strip and records its accepted direction in
`redesign/device/DIRECTION.md`. The lead approved it on 2026-10-25, including
the true-black canvas, the raised/line additions and the type scale. The lead
also added one constraint: pressed and selected states change shape or
weight, not only fill.

## Decisions

1. **Fixed dark device palette, true-black canvas.** An LCD strip at true
   black emits the least light, its bezel edge disappears, and the wallpaper
   letterbox stays seamless. The palette lives in `strip/palette.ts` and is
   published as `--strip-*` custom properties. Status sheets use it as well
   instead of the app's `--quake-*` theme.
2. **Geometry is behavior.** `geometry.ts` themes, slots, spans, `tileAt`,
   sub-touch hosts and knob focus rectangles are not changed. Only paint
   changes. The DK corner radii in theme data stay for compatibility. The
   renderer maps a non-zero radius to the design radius (28 px per 220 px
   cell).
3. **Typography over containers.** Readouts are text: clock numerals, the
   temperature, the voice transcript and the gauge value. Surfaces are flat
   plates with one hairline and are never nested.
4. **Personalization stays, behind a scrim.** Clock theme art and user
   images/video keep working. One even `rgba(11,12,13,0.62)` scrim plus
   opaque information surfaces carry contrast, so the art reads as a
   backdrop.
5. **Motion only for feedback.** The minute flip, the vinyl spin, the neon
   wave loop and the orb pulse are removed. The press scale, the wheel
   nudge, the progress fill and the marquee for overflowing text remain, and
   all of them honour reduced motion.
6. **Stable hooks.** Class names that tests and smokes use to locate elements
   stay on their semantically equivalent new elements (for example
   `.oq-flip-clock` on the time readout, `.oq-player-error` and
   `.oq-player-source`, `.voice-subtitle`, `.voice-bar`, `.copilot-status`).

## Smoke contract request (parent-owned main smokes)

Hidden native smokes in `apps/desktop/src/main/**/smoke*.ts` encode DK
geometry. This lane cannot edit them. The exact assertions that need to
change, with proposed replacements, go to the parent in
`redesign/device/SMOKE-CONTRACT.md`. Examples are the clock rail/flip
pixel geometry, the flip phase trace and `.oq-flip-pill`/`.oq-flip-upper`, and
the player hint's 18 px size.

## Risks

- A physical hardware strip has not been looked at; mock captures only.
- The bar meter replaces the mountain drawing. Its property tests on the
  level smoothing (`stepBarMotion`) stay. The drawing tests are rewritten for
  the bar.

## Owner wheel correction, 2026-10-28

Ramiro's device photo rejects the opaque left edge and flashing direction bar. Extend the backdrop 160 logical pixels beyond the label sheet, blur the underlying tiles and mask that blur/background to transparency at the left edge. Keep selected-name typography and its local marker crisp. Remove the independent 300ms direction bar; the existing 200ms name nudge provides motion feedback. This supersedes the earlier opaque wheel-sheet clause.
