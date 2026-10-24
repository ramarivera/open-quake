# Proposal

## Why

The recovered channels hub renders a dynamic catalog and setup drawer backed by six known entries in background.js, already present in 0.4.52 (`CENTER-072`, `CENTER-073`). The replacement must represent available adapters without claiming unverified channel support.

## What Changes

- Define an adapter-provided channels catalog and connection status.
- Support declared credential and QR setup flows with cancellation and expiry.
- Gate runtime-dependent adapters until their owning runtime is ready.

This lane adds planning artifacts only. The requirements describe proposed future behavior; all implementation tasks remain open.

## Capabilities

### New Capabilities

- `integration-channels`: Define an adapter-provided channels catalog and connection status.

### Modified Capabilities

None. Existing in-flight SDK, profile, display, AI and theme contracts remain owned by their changes.

## Impact

`packages/edge` channel contracts, setup state machine, adapter registry and conductor; `packages/client` typed catalog/setup events; `apps/desktop` setup drawer, QR display and secret-store adapter. The OpenClaw lane owns runtime installation and channel providers. No new device/protocol behavior.

Recommended phase: Later phases item 4 for the hub and fake adapter. Runtime-backed channels depend on Later phases item 5, DKClaw/OpenClaw, even though the inventory lists the hub earlier.

Research: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, sections 7–9 and Later phases. Evidence and unresolved decisions are recorded in design.md. No npm dependency is added in this spec-only change.
