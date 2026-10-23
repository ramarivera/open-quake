# Proposal

## Why

An editable grid needs a function catalog that distinguishes supported local actions from the wider DK-Suite library. Inventory section 3 also contains commented-out functions and inconsistent type names that must not become accidental runtime behavior.

## What Changes

- Define one capability registry for editors, validation, and action dispatch, with exact first-release action records for hotkeys, text, websites, open-app, and media keys.
- Specify non-executing previews, invalid-action behavior, and platform capability handling.
- Inventory all recovered submenu families as first-release, later, or unresolved, with later runtimes owned by their corresponding domains.
- Approved (Ramiro, 2026-10-23): retain `hotkeySwitch` as an inactive compatibility entry until its dispatch semantics are verified, answering inventory open question 10.

## Capabilities

### New Capabilities

- `key-function-library`: function metadata, typed action payloads, editing, artwork selection, and supported-action dispatch.

### Modified Capabilities

None.

## Impact

`packages/device` will own the registry, action schemas, pure validation, and action conductor. `apps/desktop` will own OS automation adapters, artwork imports, the library and operation editors, and typed IPC. `packages/protocol` supplies decoded input only through L1; host keyboard actions are not new firmware opcodes. The change depends on `profiles-key-grid`; knob slots reuse its registry. Later AI, monitor, audio, camera, and integration runtimes are dependencies, not implementations in this change. No new dependencies are proposed. Tasks 1.1–1.4 implement the device-owned contracts and conductor. Desktop OS adapters and UI remain in tasks 2.x, with parent-owned Beads follow-up.

## Approval

Approved (Ramiro, 2026-10-23): all design recommendations, including first-release payloads, no implicit text-enter, adapter-declared supported hotkey tokens, narrow import normalization, and keeping hotkeySwitch unresolved and inactive. Approval does not establish host or hardware execution evidence.
