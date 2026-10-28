## Why

Hardware acceptance currently mixes fake-HID evidence with manual checks. Ramiro requests an automated real-device E2E suite and an explicit percentage of named scenarios, so automation can cover the device before asking for physical gestures.

## What Changes

- Add an explicitly opted-in real-device suite through native HID, production device/hardware services and retained diagnostics.
- Exercise queries, protocol/readback, keepalive, cleanup/reopen and reversible mutations with restoration.
- Report passed, failed, skipped and physical-only scenarios separately; fake runs never count as physical coverage.
- Prepare a fresh build and run existing hidden native UI smoke checks.

## Approved extension after PR135

Ramiro explicitly requested more autonomous automated testing and granted local Mac mini test approval. Extend the native checks to the three existing qualified lighting fields, concurrent queries, repeated software reconnects and real USB microphone capture through production drivers. Retain the original twenty-scenario denominator; supplemental checks do not claim physical gestures, USB cable unplug, visible light or a live provider loop. Do not save device lighting to flash or alter product preferences.

## Capabilities

### New Capabilities

- `hardware-acceptance`: bounded real-device automation, ownership, restoration and honest scenario coverage.

### Modified Capabilities

None.

## Impact

Desktop test helpers, dedicated opt-in Vitest config, existing diagnostic names and documentation. No dependencies, CI, firmware flashing or automatic OS input/audio. Epic `open-quake-fdc`.
