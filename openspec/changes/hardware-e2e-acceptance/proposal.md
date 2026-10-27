## Why

Hardware acceptance currently mixes fake-HID evidence with manual checks. Ramiro requests an automated real-device E2E suite and an explicit percentage of named scenarios, so automation can cover the device before asking for physical gestures.

## What Changes

- Add an explicitly opted-in real-device suite through native HID, production device/hardware services and retained diagnostics.
- Exercise queries, protocol/readback, keepalive, cleanup/reopen and reversible mutations with restoration.
- Report passed, failed, skipped and physical-only scenarios separately; fake runs never count as physical coverage.
- Prepare a fresh build and run existing hidden native UI smoke checks.

## Capabilities

### New Capabilities

- `hardware-acceptance`: bounded real-device automation, ownership, restoration and honest scenario coverage.

### Modified Capabilities

None.

## Impact

Desktop test helpers, dedicated opt-in Vitest config, existing diagnostic names and documentation. No dependencies, CI, firmware flashing or automatic OS input/audio. Epic `open-quake-fdc`.
