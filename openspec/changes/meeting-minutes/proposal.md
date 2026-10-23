# Proposal

## Why

Meeting capture and browsable history are recovered, but capture, processing, and export failure behavior needs an explicit contract. Users must retain their transcript when minutes generation fails.

## What Changes

- Define explicit microphone/system-audio capture sessions and terminal states.
- Persist local history, transcript and generated minutes separately.
- Support retry, deletion and DOCX export through provider and file adapters.

This lane adds planning artifacts only. The requirements describe proposed future behavior; all implementation tasks remain open.

## Capabilities

### New Capabilities

- `meeting-minutes`: Define explicit microphone/system-audio capture sessions and terminal states.

### Modified Capabilities

None. Existing in-flight SDK, profile, display, AI and theme contracts remain owned by their changes.

## Impact

`packages/edge` meeting contracts, repository, lifecycle invariants and conductor; `packages/client` typed meeting API; `apps/desktop` capture/permission, local files, export adapters and history/capture UI. AI/speech lanes own provider facades; panel animation consumes meeting state through existing display delivery.

Recommended phase: Later phases item 3, soundboard/DK-Player and meeting minutes, after speech and chat provider interfaces. Physical trigger parity still requires device verification.

Research: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, sections 7–9 and Later phases. Evidence and unresolved decisions are recorded in design.md. No npm dependency is added in this spec-only change.
