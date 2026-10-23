# Proposal

## Why

DK-Suite has a Home Assistant URL/token editor and entity/service configuration. A local integration needs a testable connection and execution contract that works with a user-controlled HA instance.

## What Changes

- Configure an HA endpoint and protected token reference.
- Browse entities by room/domain and validate service data.
- Execute configured key actions and accept validated intents from the AI lane.

This lane adds planning artifacts only. The requirements describe proposed future behavior; all implementation tasks remain open.

## Capabilities

### New Capabilities

- `home-assistant-integration`: Configure an HA endpoint and protected token reference.

### Modified Capabilities

None. Existing in-flight SDK, profile, display, AI and theme contracts remain owned by their changes.

## Impact

`packages/edge` HA contracts, repository interface, connection and execution conductor; `packages/client` typed HA API; `apps/desktop` secret-store adapter and HA configuration/status UI. Profile and AI services call the same action capability. Protocol/device packages retain their existing event/display role.

Recommended phase: Later phases item 4, Home Assistant integration and channels hub. Requires an HA test instance, profile actions and, for natural-language control, the AI intent contract.

Research: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, sections 7–9 and Later phases. Evidence and unresolved decisions are recorded in design.md. No npm dependency is added in this spec-only change.
