# Proposal

## Why

On 2026-10-25 Ramiro rejected the device strip as an "ugly DK-Suite imitation".
It still drew glass flip-clock cards over cloud art, a vinyl turntable with a
tonearm, a neon swirling waveform, metal knob dials, a cyan arc wheel and glowing
gradient key tiles. An earlier pass changed only three legibility details and
was rejected too. The user explicitly asked Opus agents to substantially
redesign the product. That request supersedes the recovered DK-Suite visual
constraints but not their behavior. The complaint stays recorded on bead
`open-quake-nyd` so later work does not drift back to DK visuals.

## What Changes

- Add a fixed dark device palette (true-black canvas, flat surfaces,
  one hairline, jade accent for selection/active, success/warning/danger only
  for state) and a strip type scale. It derives from the design lead's
  `DESIGN-BRIEF.md` device block (management lane `open-quake-nyd.2`).
- Key grid: flat tiles with the user's artwork and a bottom label. Pressing
  changes the fill, a 2px ring and the scale. Key runtime states (countdown,
  progress, alarm, invalid) render as legible chips.
- Clock: a typographic tabular readout replaces the glass flip digits.
  Built-in theme art and user media stay behind an even contrast scrim. The
  weather and now-playing information column is opaque.
- Player key: a flat now-playing panel replaces the turntable.
- Voice: a state chip and a transcript sheet replace the neon waveform. A
  bar meter driven by the real RMS replaces the mountain orb. The grid-hold
  bar and the toasts become opaque.
- AI tiles, knob overlays (focus ring, wheel list, picker, volume pill) and the
  panel feedback gauge/offline sheet are flattened.
- Device-owned settings forms use the shared management primitives.

## Capabilities

### New Capabilities

- `device-visual-design`: the visual contract for every surface drawn on the
  1920×480 device strip (and its 480×1920 rotation) by renderer `strip/**`,
  `panel/**` and `weather-media/**`.

### Modified Capabilities

This change supersedes only the visual clauses of in-flight deltas that have
no published main specs: `strip-key-grid`, `desktop-clock`, `weather-media`,
`strip-voice-ui` and `knob-model`. Each superseded requirement is listed in
`specs/device-visual-design/spec.md`, and the affected delta files carry a
pointer note. Their behavior clauses (geometry, hit-testing, timing, state
machines, IPC, strings, capability truth) remain authoritative.

## Impact

Renderer only: `apps/desktop/src/renderer/src/{strip,panel,weather-media}/**`
and the renderer tests beside them. There are no main, preload, shared, edge
or backend edits and no new dependencies. Hidden native smokes owned by the
integrating parent assert some DK geometry, such as the clock flip cards and
the 18px player hint. The proposed assertion updates go to the parent as a
smoke contract request (see `design.md`).

Execution: epic `open-quake-nyd.5` (child of `open-quake-nyd`), tasks
`open-quake-nyd.5.1` … `open-quake-nyd.5.8`; assigned task `open-quake-nyd.4`.
