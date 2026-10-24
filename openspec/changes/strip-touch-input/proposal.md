# Proposal

## Why

The strip receives no real touch input through the current checksummed control decoder. DK-Suite uses a separate vendor collection and reconstructed contact lifetimes, documented in MAIN-002 and MAIN-035–041.

## What Changes

- Decode and track vendor touch frames inside the device abstraction, with scoped binding, recovery and a 100 ms idle lift.
- Normalize bottom-left coordinates and arbitrate ordinary tile presses, overlay capture and reusable in-tile gestures.
- Export a small tile resolver contract for strip-grid, without owning grid geometry.
- Supply deterministic synthetic frames in mock mode and an opt-in, process-guarded capture script for the lead.

## Capabilities

### New Capabilities

- `strip-touch-input`: Vendor touch collection, contact lifetime, strip key routing and reusable gesture physics.

### Modified Capabilities

None. Existing planning-only device-sdk and desktop-panel-window changes remain unarchived; this capability adds the separately recovered input path.

## Impact

`packages/device`, desktop event delivery, preload types and renderer input adapters. No new dependencies. Hardware remains unverified. Voice capture policy and profile/widget behavior belong to their lanes; this lane exposes capture suppression and gesture/key events for them.
