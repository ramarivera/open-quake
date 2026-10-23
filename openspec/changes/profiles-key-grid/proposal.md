# Proposal

## Why

The first local-only release needs an editable profile that survives restart and drives the same grid in management and panel windows. Inventory section 3 names the fields but disagrees with recovered sources about coordinate order, so an implementation needs an explicit logical-grid contract and a separate physical mapping gate.

## What Changes

- Define the profile, page, and per-key contracts, including empty cells, title fields, artwork references, edit locks, and nested actions.
- Deliver one editable profile and page navigation first. Add multiple-profile CRUD, folders, and app-driven selection later.
- Preserve unsupported imported functions without executing them and synchronize saved revisions across both desktop windows.
- Use the approved logical 2-row by 8-column QUAKE grid while physical-map verification remains pending, answering inventory open question 2.

## Capabilities

### New Capabilities

- `profiles-key-grid`: local profile persistence, key schema, logical layout editing, page selection, and revision synchronization.

### Modified Capabilities

None.

## Impact

`packages/device` will own Schema contracts, profile invariants, repository interfaces, and the profile conductor. `apps/desktop` will supply local persistence, management editors, panel rendering, and typed IPC adapters. `packages/protocol` remains the pure L1 codec dependency, with no protocol implementation or changes to `two-layer-sdk` in this effort. `key-function-library`, `knob-configuration`, and `device-screen-wallpaper` consume these contracts. No dependency additions are proposed. Approved (Ramiro, 2026-10-23): all design recommendations are accepted as the decisions. Tasks 1.1–1.5 implement the contracts, invariants, local repository, and conductor; desktop window integration and physical verification remain separate tasks. The parent maintains Beads execution records.
