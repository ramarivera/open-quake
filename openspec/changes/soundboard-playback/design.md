# Design

## Context

Soundboard is later-phase section 5 parity. First-release normal chat and direct voice do not depend on it. The section 8 complete DK-Player profile, meeting recorder, and audio editing/merge workflows remain outside this change. Recovered IPC names for merging do not establish a merge algorithm.

Approved (Ramiro, 2026-10-23): `packages/edge/src/media/` owns soundboard contracts, playlist/migration invariants, repository, and SoundboardService. Desktop main owns user file selection and existence validation; a desktop audio adapter owns decoding/output. The profile domain registers playAudio. `packages/client/` provides typed status/control clients. AudioOutput from `voice-stt-tts` arbitrates output ownership; sharing its contract must not import AI provider logic into soundboard. Conductors use Effect.fn spans, declared Layers, Schema-first RPC, and catalog errors with scrubbed original causes.

## Goals / Non-goals

Goal: Keep local playlist behavior deterministic and share output ownership with speech.

Non-goal: Do not require a model provider, recursively scan folders, or implement meeting/audio-merge workflows.

## Decisions

Approved (Ramiro, 2026-10-23): the draft specifications encode the recommendations below. Supplied product direction is fixed; other design choices await acceptance before implementation. Evidence labels describe recovered observations, not approval of the proposed replacements.

### Configuration and migration

Recovered sound values accept a JSON array of MP3 paths or a single legacy MP3 path. Approved (Ramiro, 2026-10-23): version 1 stores ordered local file references, a named operation, fadeInMs/fadeOutMs, and volume 0..100. Imports parse explicit files only, keep order, reject malformed JSON/directories, and classify missing/unreadable paths for user repair. Do not recursively scan directories or fetch remote URLs. Resolve user-selected references in the host, not from raw renderer paths.

Recovered audioAction numeric semantics and the audioFade `0-0` encoding are not proven by the inspected default configuration. Do not assign guessed meanings. Import recognized sound paths and volume; mark unknown action/fade values needsConfiguration. The user chooses a named operation/fade before saving. Repeating migration yields the same result.

### Playback state and operations

Approved (Ramiro, 2026-10-23): states are idle, loading, playing, paused, stopped, failed, with playbackId, playlist revision, track index, volume, and fade metadata. Named operations are play, pause, resume, stop, next, previous. Play starts at the first selected track; pause/resume preserves position; stop resets position; next/previous clamp at playlist bounds. Natural end advances once to the next track, or stops at the end. No shuffle or repeat is implied.

Volume 0..100 maps to gain 0..1. Apply fade-in on play/resume and fade-out on stop/pause, bounded to 0..10,000ms. Approved (Ramiro, 2026-10-23): start with linear gain ramps. A new command cancels the old ramp and begins from current gain; no delayed fade callback can affect another playbackId. Zero volume remains a valid playing state. Mute is not an inferred stop.

Loading times out at 10s. The player signals ready/loadError/naturalEnd/stop with matching IDs. A repeated naturalEnd cannot skip two tracks. A rescan checks only the existing explicit file list and does not restart playback. It publishes per-entry availability; a currently playing decoded file may finish, while a removed upcoming file fails visibly before it starts. All unavailable/empty playlists fail before output acquisition.

### Audio output and concurrency

Soundboard takes one AudioOutput lease. Voice capture stops it immediately, bypassing user fade durations, and blocks new soundboard play until the mic releases. Approved (Ramiro, 2026-10-23): require explicit play after capture rather than auto-resume. Speech output takes precedence over new soundboard play; report busy rather than mixing unrequested audio. Stopping soundboard must never stop another output owner's TTS.

Catalog errors include `MEDIA.SOUNDBOARD.CONFIG_INVALID`, `MEDIA.SOUNDBOARD.FILE_UNAVAILABLE`, `MEDIA.SOUNDBOARD.LOAD_TIMEOUT`, `MEDIA.SOUNDBOARD.OUTPUT_BUSY`, and `MEDIA.SOUNDBOARD.PLAY_FAILED`. Diagnostics use file IDs and outcome codes, not absolute paths. UI state/error strings use the shared bundled GT messages; file names remain user content.

### Evidence and deliberate replacements

Read-only root `R` is `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion`; `RS` is `R/artifacts/recovered_sources`.

- S: `RS/webpack:__dk-suite_src_utils_playAudioSoundValue.js`, MP3 array/single-file parsing, existence filtering, and directory rejection.
- S: `RS/webpack:__dk-suite_src_utils_DefaultProfileData.js`, DEFAULT_DK_PLAYER_CONFIG with sound/audioAction/audioFade/volume fields. Field presence is not a complete control-value specification.
- N: `R/artifacts/ipc_channels.txt`, PlayerReady, AudioTrackNaturalEnd, AudioPlaylistAction, RequestPlayAudioPlaylistRescan, AudioPlayStart/Stop/LoadError, and get-play-audio-runtime-status. Exact timing/operation payloads remain unverified.
- Product scope: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, section 5 soundboard and Later phases.

Replace opaque numeric controls with named actions, silent missing-file filtering with per-entry status, and unrestricted output overlap with the shared output lease. Do not promise recovery of numeric semantics or add audio merge behavior from IPC names alone.

## Open decisions and verification

- Approved (Ramiro, 2026-10-23): approve named operations, non-looping playlist behavior, linear fade bounds, and voice/TTS precedence.
- Approved (Ramiro, 2026-10-23): MP3 first to match recovered file handling; other codecs need separate capability tests.

Use an injected filesystem/player/clock to test action sequences, fade interruption, missing files, stale callbacks, rescan, and shared audio focus through actual profile dispatch. Live codecs, sound-card output, physical device controls, and Linux audio are unverified.

## Migration and rollback

Keep legacy playAudio configurations inactive until a reviewed named-operation mapping is saved. Enable the local player behind its gate and then integrate audio ownership. Rollback stops only soundboard output and preserves playlists/import backups. Do not delete user-selected media or interrupt another output owner's speech.

## Risks and alternatives

- Absolute legacy paths may no longer exist on another machine. Preserve per-entry repair status instead of silently dropping files.
- Mixing independent players can feed speech into STT. Use the shared exclusive lease instead of implicit output overlap.
- Numeric action/fade semantics are not recovered. Named operations are a proposed replacement, and unsupported imports remain visible for repair.
