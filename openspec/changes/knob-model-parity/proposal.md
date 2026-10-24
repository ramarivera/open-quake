# Proposal

## Why

Idle rotation currently dispatches stored knob slots, contrary to approved GAP-MAP decision 1. The strip needs the recovered profile selectors, gesture arbitration, tile focus and player volume control.

## What Changes

- Replace idle slot dispatch with focused tile, player volume, thumbnail picker, then FunctionWheel precedence.
- Decode firmware classifications 1/2/5/255 without host gesture timers. Share correlated voice events with knob-push-to-talk.
- Own selector deadlines in the domain, render overlays inside the strip panel, and expose typed preload commands.
- Preserve legacy slot data without executing it from physical idle rotation.

## Capabilities

### New Capabilities

- `knob-model`: physical gesture arbitration, profile selection, focus and volume mode.

### Modified Capabilities

No archived capabilities exist. Reconcile the in-flight knob-configuration and knob-push-to-talk changes in place.

## Impact

Device knob domain, a minimal serialized profile-selection command, Electron composition and preload, strip overlays under strip/overlays/knob, mock-only native smoke. No new dependencies. No hardware access. Beads epic open-quake-lih.4.1 under cluster open-quake-lih.4.
