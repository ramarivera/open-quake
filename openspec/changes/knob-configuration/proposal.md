# Proposal

## Why

The QUAKE knob is a reserved profile entry, not another grid cell. Recovered source defines three slots and route-specific voice actions, but its compacting save behavior can shift slot positions and its brightness names do not prove the hardware target.

## What Changes

- Define stable center, left, and right slots at key code `0,1`, profile-scoped saves, and snapshot-based event routing.
- Deliver knob panel brightness and page navigation first, subject to L1 target verification.
- Define direct-route push-to-talk configuration and its handoff to the voice lane without implementing STT, TTS, or chat here.
- Specify legacy route migration, cross-profile isolation, and later DKClaw/legacy compatibility gates.

## Capabilities

### New Capabilities

- `knob-configuration`: knob slot persistence, rotation dispatch, profile synchronization, and voice route configuration.

### Modified Capabilities

None.

## Impact

`packages/device` will own knob Schema contracts, migration invariants, and the knob conductor. `apps/desktop` will own the three-slot editor, local repository adapter, platform brightness adapter where needed, and voice-service composition. `packages/protocol` remains L1-owned; this change consumes normalized rotate, press, release, and disconnect events without fixing wire values. Dependencies are `profiles-key-grid`, `key-function-library`, `two-layer-sdk`, and the voice lane for direct push-to-talk. No new dependencies are proposed. Artifacts only are delivered here; Beads creation belongs to the parent.
