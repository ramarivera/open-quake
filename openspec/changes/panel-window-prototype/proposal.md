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
- Harden the prototype with display hot-plug relocation/recreation, a stable
  panel title enforced by main, shared main/preload event types, and unit tests
  for display selection, event forwarding, mock lifecycle, and window wiring.
- Close the ticket once the slice is exercised against real hardware or the
  remaining gaps are filed.

## Capabilities

### New Capabilities
- `desktop-panel-window`: panel display selection, window surfaces, device event delivery to renderers.

### Modified Capabilities

## Impact

`apps/desktop/src/main/**`, `apps/desktop/src/preload/**`, desktop test config,
`apps/desktop/package.json`, and its workspace lockfile entry. Vitest uses the
existing catalog pin, 4.1.11. The renderer is unchanged in this close-out lane;
it can adopt the exported event and bridge types separately. Beads: epic for
this change, `open-quake-2qs.5`; live-run and hardware evidence remain pending.
