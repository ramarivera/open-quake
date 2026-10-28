## Why

The Keys editor's Move / swap selector needs reliable persistence and selection, and Quick profile titles must remain editable despite legacy template flags. Owner reports are tracked by open-quake-fb9 and open-quake-efm.

## What Changes

- Reproduce selector moves to empty and occupied cells, then fix draft, persistence and preview behavior.
- Honor the owner's title customization policy, including Quick Luminance, and retain explanations only for structural replacement, resize and deletion protection.
- Add regression tests and use the isolated management exerciser for native Electron input, with hidden windows and fake HID. Never launch the owner's app or access real hardware.

## Capabilities

### New Capabilities
- `keys-move-rename`: reliable selector movement and editable titles and explained structural restrictions.

### Modified Capabilities

## Impact

Keys renderer, key-library IPC and profile editing paths as required. No new dependencies or real device access.

Follow-up sweep covers knob draft revisions, generic action value types, closed-disclosure hit testing, hidden-key movement, PR152 findings and enlarged two-line title layout. The execution beads are listed in design.md and tasks.md.
