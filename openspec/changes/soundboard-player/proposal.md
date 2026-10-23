# Proposal

## Why

The DK-Player default profile includes audio action, fades and volume. Recovered parsing also establishes MP3 playlists and a legacy single-file format, which need consistent behavior across key and desktop controls.

## What Changes

- Define a DK-Player preset and normalized local MP3 playlists.
- Specify play/pause/stop, track navigation, volume and fade behavior.
- Keep playback state in one service shared by key events and desktop controls.

This is the single soundboard contract; it absorbed the duplicate `soundboard-playback` change on 2026-10-23. It adds planning artifacts only. The requirements describe proposed future behavior; all implementation tasks remain open.

## Capabilities

### New Capabilities

- `soundboard-player`: Define a DK-Player preset and normalized local MP3 playlists.

### Modified Capabilities

None. Existing in-flight SDK, profile, display, AI and theme contracts remain owned by their changes.

## Impact

`packages/edge` soundboard contracts, playlist/fade invariants, repository and conductor; `packages/client` typed controls/events; `apps/desktop` audio backend, file picker and player UI. Profile services own grid configuration; device/protocol packages reuse existing normalized key/display behavior.

Recommended phase: Later phases item 3, soundboard/DK-Player, after profile actions and host media backend. No recording or new AI provider required.

Research: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, sections 7–9 and Later phases. Evidence and unresolved decisions are recorded in design.md. No npm dependency is added in this spec-only change.
