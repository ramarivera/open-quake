# Proposal

## Why

Inventory section 2 lists LED/RGB settings, but recovered code separates a serial-scoped knob LED preference from QMK lighting values. A separate contract prevents unsupported firmware controls and unverified per-key RGB claims from entering the screen or brightness work.

## What Changes

- Record lighting as later-phase parity, after the first-release grid, wallpaper, clock, and knob brightness work.
- Define target-scoped lighting capabilities, validated brightness/effect/speed/color edits, explicit persistence, and missing-device behavior.
- Keep the knob always-on preference distinct from hardware-applied state and from panel brightness.
- Gate QMK v3 bindings and per-key RGB on verified L1/device capability evidence.

## Capabilities

### New Capabilities

- `device-lighting-config`: lighting settings state, target selection, supported controls, save behavior, and knob LED preference.

### Modified Capabilities

None.

## Impact

`packages/device` owns lighting schemas, capability validation, and the lighting conductor; `apps/desktop` will own settings UI, serial-scoped local preferences, and IPC adapters. `packages/protocol` and `two-layer-sdk` remain the owners of QMK codecs and transport. No per-key LED protocol or probing algorithm is invented here, and no new dependencies are proposed. W5 implements tasks 1.1–1.3, 2.1, and 2.4 against hid-fake; the parent manages Beads entries and remaining integration work.
