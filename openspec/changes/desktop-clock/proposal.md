# Proposal

## Why

The recovered DK-Desktop-Clock profile supports a configurable 12/24-hour widget. Its time and lifecycle rules can be specified independently of reverse-engineering new device commands.

## What Changes

- Add a local-time clock widget and default profile entry.
- Persist hour format and keep management preview and panel time consistent.
- Release timers when the clock is no longer displayed.

This lane adds planning artifacts only. The requirements describe proposed future behavior; all implementation tasks remain open.

## Capabilities

### New Capabilities

- `desktop-clock`: Add a local-time clock widget and default profile entry.

### Modified Capabilities

None. Existing in-flight SDK, profile, display, AI and theme contracts remain owned by their changes.

## Impact

`packages/edge` clock configuration and formatting invariants; `packages/client` clock settings contract; `apps/desktop` clock rendering and scheduling. Existing profile/display services own layout and delivery; `packages/protocol` and `packages/device` need no new command.

Recommended phase: Basic display clock is first-release cut item 3. The configurable DK-Desktop-Clock profile can ship alongside Later phases item 1, after display and profile foundations.

Research: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, sections 7–9 and Later phases. Evidence and unresolved decisions are recorded in design.md. No npm dependency is added in this spec-only change.
