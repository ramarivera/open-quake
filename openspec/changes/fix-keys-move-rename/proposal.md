## Why

The Keys editor's Move / swap selector has no visible effect on the current build, and the Quick profile's locked Luminance title gives no explanation. Owner reports are tracked by open-quake-fb9 and open-quake-efm.

## What Changes

- Reproduce selector moves to empty and occupied cells, then fix draft, persistence and preview behavior.
- Inspect the recovered Luminance title policy. Enable normal title editing unless DK-Suite deliberately locks it, in which case explain the restriction beside the field.
- Add regression tests without launching Electron or accessing hardware.

## Capabilities

### New Capabilities
- `keys-move-rename`: reliable selector movement and explained title restrictions.

### Modified Capabilities

## Impact

Keys renderer, key-library IPC and profile editing paths as required. No new dependencies or native execution.
