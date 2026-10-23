# Proposal

## Why

The first release needs local artwork and a clock on the 1920x480 panel, plus evidence for resource transfer. Recovered DK-Suite code renders wallpaper in a desktop panel window, while HID `0xA2` carries keyed JPEG resources; those paths need separate acceptance evidence.

## What Changes

- Define serial-scoped wallpaper settings, local image selection, matching management/panel output, and a basic clock in the first release.
- Define the screen resource request contract and an explicit hardware acceptance gate for `0xA2`, answering inventory open question 6.
- Add later video playlists, transparency, fill modes, and typed countdown, alert, and progress events.
- Record screen binding and the recovered localhost socket as separate compatibility questions rather than assuming arbitrary desktop capture or LAN control.

## Capabilities

### New Capabilities

- `device-screen-wallpaper`: panel content, wallpaper settings, clock and display events, resource delivery state, and binding behavior.

### Modified Capabilities

None.

## Impact

`packages/device` will own display contracts, resource request orchestration, and display-state invariants. `apps/desktop` will own media persistence, decoding/composition, the panel and preview renderers, and typed IPC. `packages/protocol` and its `0xA2` encoding remain owned by `two-layer-sdk` / lane L1. This change consumes `panel-window-prototype`, `theming-animation-contract`, and `profiles-key-grid` without editing those changes. No shipped DK-Suite artwork or new dependencies are proposed. Tasks 1.1–1.5 implement the first-release desktop wallpaper and clock. Hardware behavior remains unverified and Beads updates belong to the parent.
