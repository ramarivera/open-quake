# Proposal

## Why

Cluster open-quake-lih.11 covers display discovery and recovery gaps that leave the panel on the wrong monitor or disconnected after sleep. open-quake-l86.12 and open-quake-l86.13 require single-instance startup and a hidden release fallback.

## What Changes

- Pair the strip through serialized screen-off/watch/screen-on transactions and physical pixel matching.
- Count transient HID read errors, back off reconnects, preserve the panel across a three-second disconnect, and recover after unlock/resume.
- Refuse duplicate processes before opening HID and focus the existing management window.
- Add USB/HDMI diagnostics, Re-detect, and consent-based display remediation with ten-minute Later snoozes.
- Correct the desktop-panel-window requirements in panel-window-prototype for approved decision 7.

## Capabilities

### New Capabilities

- `device-lifecycle`: connection supervision, display binding, diagnostics, remediation, and single-instance ownership.

### Modified Capabilities

No archived main specs exist. The existing desktop-panel-window capability remains owned by panel-window-prototype and is updated there in this same change set.

## Impact

Desktop main/preload/renderer and the existing QuakeDevice abstraction. No new dependencies. All verification uses fake HID, mocked display/native APIs and Effect TestClock. Hardware verification belongs to the lead.
