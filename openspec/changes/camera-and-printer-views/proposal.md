# Proposal

## Why

Camera and printer status views share gateway state in recovered source. Their visible behavior can be designed now, while the unknown printer_3d_gateway protocol remains a separate implementation blocker.

## What Changes

- Define read-only camera frame and printer status adapter contracts.
- Render missing configuration, starting, live, stale and failed states.
- Gate actual gateway control and camera pan/tilt behind verified adapter capabilities.

This lane adds planning artifacts only. The requirements describe proposed future behavior; all implementation tasks remain open.

## Capabilities

### New Capabilities

- `camera-and-printer-views`: Define read-only camera frame and printer status adapter contracts.

### Modified Capabilities

None. Existing in-flight SDK, profile, display, AI and theme contracts remain owned by their changes.

## Impact

`packages/edge` camera/printer contracts, gateway repository interface and feed conductors; `packages/client` typed status/frame APIs; `apps/desktop` local gateway process adapter and panel renderers. Existing display services deliver composed output; protocol/device packages gain no guessed opcodes.

Recommended phase: Later phases item 7, camera RTSP and printer status views, after gateway binary analysis. Mock-driven UI work can precede protocol recovery but cannot satisfy hardware parity.

Research: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, sections 7–9 and Later phases. Evidence and unresolved decisions are recorded in design.md. No npm dependency is added in this spec-only change.
