# Proposal

## Why

Wayfinder ticket `open-quake-2qs.5` asks how `apps/desktop` should own the
DK-QUAKE panel (1920x480). A rough vertical slice exists (fba379a, 2d56683,
2e71f66) but nothing records what it is supposed to prove, so it cannot be
closed with evidence.

## What Changes

- Record the prototype's contract: a management window plus a frameless panel
  window placed on the DK-QUAKE display, and one device event stream forwarded
  over IPC (`quake:event`) to both renderers through the preload bridge
  `window.openQuake.onQuakeEvent`.
- The event source stays a clearly labelled mock (`source: "mock"`) until the
  node-hid transport lands under `two-layer-sdk`.
- Close the ticket once the slice is exercised against real hardware or the
  remaining gaps are filed.

## Capabilities

### New Capabilities
- `desktop-panel-window`: panel display selection, window surfaces, device event delivery to renderers.

### Modified Capabilities

## Impact

`apps/desktop/src/main/{index,display,deviceBus}.ts`, `apps/desktop/src/preload/index.ts`,
`apps/desktop/src/renderer/src/*`. Beads: epic for this change, `open-quake-2qs.5`.
