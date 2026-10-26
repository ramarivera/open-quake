## Why

Cluster 17 has no executable OBS integration. Saved OBS keys, knob volume and visible tiles need an obs-websocket v5 runtime independent of hardware.

## What changes

- Add the recovered 21 OBS key functions and their typed configuration to the existing registry.
- Add a scoped Effect service for connection, protected credentials, local detection, authenticated v5 requests, reconnect and visible tile polling.
- Wire saved keys, focused knob volume, management configuration and strip status/stats/screenshot rendering into the existing desktop paths.
- Verify with an in-process websocket server, Effect TestClock and the lane gates. Never start OBS, DK-Suite or real hardware.

## Capabilities

### New capabilities
- `obs-studio`: OBS connection management, actions, knob volume and visible live tiles.

### Modified capabilities

None.

## Impact

Covers GAP-MAP cluster 17, WIDGETS-122 through WIDGETS-127, MGMT-072, MGMT-173 through MGMT-193, MGMT-219 and MGMT-282. Minimal shared changes extend registry metadata, focused-knob kinds and desktop wiring. No firmware or device protocol changes.
