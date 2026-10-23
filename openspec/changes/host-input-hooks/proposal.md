# Proposal

## Why

Hotkey recording, selected-text actions, and PC-operation actions depend on host input hooks. These need one lifecycle and permission contract so a focused hotkey field cannot leave a global hook running.

## What Changes

- Define focused hotkey recording and normalized chords.
- Route registered global shortcuts and explicit selected-text requests through host adapters.
- Expose denied permissions and registration conflicts without leaving hooks behind.

This lane adds planning artifacts only. The requirements describe proposed future behavior; all implementation tasks remain open.

## Capabilities

### New Capabilities

- `host-input-hooks`: Define focused hotkey recording and normalized chords.

### Modified Capabilities

None. Existing in-flight SDK, profile, display, AI and theme contracts remain owned by their changes.

## Impact

`packages/edge` host-input contracts, chord invariants, capability registry and conductor; `packages/client` typed requests/events; `apps/desktop` main-process keyboard, clipboard and permission adapters plus recorder UI. `packages/cli` may consume explicit actions; protocol/device packages do not capture host keys.

Recommended phase: Supporting infrastructure for first-release cut item 2 hotkey keys and Later phases item 2 PC-operation and key-config bots. Advanced automation remains with its owning lane.

Research: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, sections 7–9 and Later phases. Evidence and unresolved decisions are recorded in design.md. No npm dependency is added in this spec-only change.
