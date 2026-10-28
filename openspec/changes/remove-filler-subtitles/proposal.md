# Remove filler subtitles

## Why

Management pages repeat headings and control labels in subtitles and helper lines. Remove that filler while preserving information users need to operate QUAKE.

## What changes

- Remove repetitive descriptions and helper lines across the management renderer and panel overlays where present.
- Keep constraints, consequences, next steps, setup instructions, units, current status, warnings and functional accessibility text. Shorten mixed lines to their useful part.
- Remove corresponding keys from every bundled locale that contains them, unused props and empty spacing.
- Record page-grouped keep/remove decisions in the PR description and update affected text assertions.

## Impact

Renderer copy and locale dictionaries only. No dependencies, transport, device behavior or native tests change. Bead: open-quake-2xb.
