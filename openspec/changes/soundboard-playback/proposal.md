# Proposal

## Why

Inventory section 5 includes local soundboard playback, which is independent of speech recognition and model-generated audio. A separate contract preserves this parity work without making it a first-release voice dependency.

## What Changes

- Define local MP3 playlist actions, legacy single-file migration, playback state, fade/volume behavior, rescan, and natural end.
- Keep soundboard disabled in the first release and share audio output arbitration with the speech player later.
- Replace undocumented numeric playback controls with named operations and reject unknown legacy values visibly.

## Capabilities

### New Capabilities

- `soundboard-playback`: local sound selection, playlist operations, and runtime playback status.

### Modified Capabilities

None.

## Impact

Proposed future ownership is `packages/edge/src/media/`, desktop file/player adapters, and profile action registration. Uses the audio output contract from `voice-stt-tts`; does not own meeting minutes or the complete DK-Player profile UI from section 8. No dependencies or code are added. Later macOS release first, Linux second.
