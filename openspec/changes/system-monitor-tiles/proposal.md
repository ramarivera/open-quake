# Proposal

## Why

DK-Suite exposes CPU, GPU, memory, disk, network, process, Bluetooth, and power tiles alongside app monitoring. Open-quake also defines a reversible monitoring override below. A replacement needs explicit availability and sampling behavior before native collectors are chosen.

## What Changes

- Add normalized metric snapshots and app/window monitoring controls.
- Define a reversible monitoring override with bounded sampling (`MAIN-096` distinguishes device hotkey mode).
- Expose stale, permission-denied, and unsupported states on management and panel views.

The original change added planning artifacts only. The system-monitor-panel change now implements a seven-module collection and panel subset. The broader app/window monitoring, Bluetooth tiles and monitoring override implementation tasks remain open; see design.md for the boundary.

## Capabilities

### New Capabilities

- `system-monitor-tiles`: Add normalized metric snapshots and app/window monitoring controls.

### Modified Capabilities

None. Existing in-flight SDK, profile, display, AI and theme contracts remain owned by their changes.

## Impact

`packages/edge` monitoring contracts, invariants, collector interfaces and conductor; `packages/client` typed subscription API; `apps/desktop` native collectors and tile/settings views. `packages/device` consumes existing display delivery; `packages/protocol` gains no monitoring opcodes.

Recommended phase: Later phases item 1, system monitor tiles, app monitor, and monitoring override. Implementation follows the profile/grid and display contracts.

Research: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, sections 7–9 and Later phases. Evidence and unresolved decisions are recorded in design.md. No npm dependency is added in this spec-only change.
