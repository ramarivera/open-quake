## Why

open-quake supports Hermes and OpenClaw runtimes on the host or over HTTP. Vendor DK-Claw labels and generic OpenClaw copy confuse the agent profile with a specific runtime and suggest execution on QUAKE.

## What Changes

- Use localized Agent display names for the built-in profile, key type, knob route and agent panel.
- Make shared runtime messages neutral while retaining program-specific OpenClaw setup and lifecycle controls.
- Resolve persisted default built-in names to the localized catalog name and preserve custom names, without rewriting stored identifiers or migrating profiles.
- Cover all eight locales with regressions and run offline desktop/device checks.

## Capabilities

### New Capabilities

- `agent-display-names`: Localized agent profile, key and runtime display copy.

### Modified Capabilities

- None. There are no published specs in this checkout.

## Impact

Renderer dictionaries and copy consumers, device profile display catalog and tests. No dependencies, IPC, routes, error codes, profile IDs or hardware behavior change. Execution bead open-quake-ekc; epic open-quake-4rw.
