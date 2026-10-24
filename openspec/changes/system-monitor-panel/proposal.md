## Why

The strip already reserves a full-screen `systemMonitorPanel` tile, but renders a generic key. DK-Suite 0.4.95 supplies five complete designs. This change implements GAP-MAP cluster 7 under open-quake-lih.8, using WIDGETS-064–083 as evidence and approved decisions 4 and 5.

## What Changes

- Render seven modules in Liquid Glass, Cyberpunk, Anime, Game Dark and Wasteland at 1920×480.
- Add per-style backgrounds, temperature unit, a labelled PC fixture and draft/Save settings.
- Connect a single scoped metrics stream with configurable 0.2–10 Hz sampling, default 1 Hz, and explicit unavailable/stale states.
- Register the disk list with the existing merged touch recognizer.

## Capabilities

### New Capabilities

- `system-monitor-panel`: Full-screen monitor rendering, settings, native collection subset and gesture scrolling.

### Modified Capabilities

None. Reuse system-monitor-tiles availability and rate semantics. App/window monitoring, Bluetooth tiles and monitoring override remain with that change.

## Impact

`packages/edge/src/monitor` owns metrics contracts and scheduling. Desktop main owns platform collection, local settings and media selection. The renderer consumes a typed preload. No dependency or device opcode is added. Physical QUAKE verification belongs to the lead.
