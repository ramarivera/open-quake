# Proposal

## Why

Plugin management source and local server names suggest Stream Deck interoperability, but no complete plugin wire protocol has been established. Compatibility needs an explicit evidence gate before real plugins can execute host actions.

## What Changes

- Define local plugin inventory, visibility and lifecycle behavior.
- Specify a loopback-only compatibility server and negotiated action routing.
- Keep VIA and remote hardware socket protocols outside the claimed compatibility subset.

This lane adds planning artifacts only. The requirements describe proposed future behavior; all implementation tasks remain open.

## Capabilities

### New Capabilities

- `stream-deck-compat`: Define local plugin inventory, visibility and lifecycle behavior.

### Modified Capabilities

None. Existing in-flight SDK, profile, display, AI and theme contracts remain owned by their changes.

## Impact

`packages/edge` plugin contracts, repository, compatibility conductor and third-party WS/page adapters; `packages/client` typed management API; `apps/desktop` archive selection, plugin UI and explicit process-launch adapter. Protocol/device packages receive only existing normalized actions. No native plugin dependency is chosen by this proposal.

Recommended phase: Later phases item 6, Stream Deck compatibility server. Requires profile action routing and a documented fixture plugin/protocol transcript.

Research: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, sections 7–9 and Later phases. Evidence and unresolved decisions are recorded in design.md. No npm dependency is added in this spec-only change.
