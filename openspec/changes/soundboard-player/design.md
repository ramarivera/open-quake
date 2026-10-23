# Design

## Context

See proposal.md for the capability boundary. This is a spec-only proposal; every product choice below marked "Approved (Ramiro, 2026-10-23)" was accepted by Ramiro on that date. The delta spec records the recommended acceptance contract, not existing implementation or verified hardware parity.

Inventory: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, sections 7–9, Later phases and the cited open questions.

## Evidence and source paths

Path roots are local-only, read-only research inputs. S means recovered source for the stated behavior, P means partial analysis/dependency evidence, and N means name-only evidence. Source availability does not prove runtime or hardware success. Replacement limits and new failure behavior are proposed, not recovered facts.

- ATLAS = `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion`
- ART = `ATLAS/artifacts`
- RS = `ART/recovered_sources`

- **S** `RS/webpack:__dk-suite_src_utils_DefaultProfileData.js`: DEFAULT_DK_PLAYER_CONFIG with sound/audioAction/audioFade/volume defaults.
- **S** `RS/webpack:__dk-suite_src_utils_playAudioSoundValue.js`: JSON MP3 path array, legacy single MP3, missing-file filtering and unsupported directory paths.
- **S** `RS/webpack:__dk-suite_src_views_Components_AudioPlayerView.vue`: playlist actions, runtime status, playlist rescan and player state.
- **S** `RS/webpack:__dk-suite_src_views_Components_AudioPlayerMagneticNeedle.vue`: visual playback indicator.

## Goals / Non-Goals

Goals: give implementers one owned contract, observable failure states and a verification path for this capability.

Non-goals: implementation in this lane, new dependencies, changes to other lanes' artifacts, guessed device opcodes, or claiming unresolved integrations work.

## Package ownership

`packages/edge` soundboard contracts, playlist/fade invariants, repository and conductor; `packages/client` typed controls/events; `apps/desktop` audio backend, file picker and player UI. Profile services own grid configuration; device/protocol packages reuse existing normalized key/display behavior.

Approved (Ramiro, 2026-10-23): keep domain modules in the existing packages rather than adding feature packages now. In `packages/edge`, each domain separates contracts, pure invariants, repository interfaces and an Effect.Service conductor. Electron-specific APIs live in `apps/desktop/src/main` adapters supplied at the composition root; renderers consume `packages/client` through a narrow typed preload bridge. `packages/protocol` stays pure; `packages/device` owns hardware I/O. `packages/cli` is an optional client, not another domain owner.

Native control contracts are Schema-first `@effect/rpc`; external third-party protocols stay boundary adapters. Services declare dependencies, use named `Effect.fn` methods with explicit success/error types and scoped cleanup. User/automation actions have one capability-registry declaration. UI never calls raw SDKs. AI calls, where needed, use the existing Vercel AI SDK Effect facade and mocked providers in CI.

## Decisions

1. Approved (Ramiro, 2026-10-23): initial playback is one active session per DK-Player key, with repeated play replacing that key's session; distinct keys may overlap. stopAudio stops all sessions and restores no OS volume.

2. Approved (Ramiro, 2026-10-23): preserve source playlist order, use per-session volume 0–100, and define fade durations in milliseconds. Decode legacy numeric actions at the import boundary only after fixture mapping.

3. Approved (Ramiro, 2026-10-23): MP3 is the initial verified input subset. No directory scanning, streaming URLs or codec expansion is implied by a path string.

### Data model

Approved (Ramiro, 2026-10-23): SoundKeyConfig stores ordered managed local file references, typed playback action, volume 0–100 and fadeInMs/fadeOutMs. PlaybackSession is keyed by profile/key identity and contains track index, position, generation ID and idle/playing/paused/stopped/failed state. Legacy sound-value decoding is kept at import boundaries.

### Data flow and lifecycle

Approved (Ramiro, 2026-10-23): The profile owner saves normalized key settings. The player conductor validates files and sends commands to an injected audio backend, publishing one state stream for panel and desktop. Repeat play replaces only that key's generation; late callbacks from the old session are discarded. Global stopAudio enumerates active sessions once.

### Failure contract

Approved (Ramiro, 2026-10-23): use operation-specific catalog leaves, initially QUAKE.AUDIO.CONFIG_INVALID, QUAKE.AUDIO.FILE_UNAVAILABLE, QUAKE.AUDIO.DECODE_FAILED and QUAKE.AUDIO.OUTPUT_FAILED. Final code names must be reconciled with the shared catalog before implementation; never introduce a second catalog. Each leaf is a catalog-derived Schema.TaggedError with private original cause and bounded, scrubbed diagnostic projection. Consumers branch on tag/code, never text. Verify exact identity, cause retention, safe serialization and broken-dependency paths through real consumers.

## Recommended phase and dependencies

Later phases item 3, soundboard/DK-Player, after profile actions and host media backend. No recording or new AI provider required.

Dependencies are contracts supplied by their owning changes. An unavailable dependency yields an explicit unavailable state; this change does not duplicate its implementation or modify its specs.

## Risks / Trade-offs

Runtime callbacks can arrive after replacement, and path strings can outlive the files. Validate at play time, correlate events to session generations and report a per-key failure.

The proposed package placement keeps current workspace boundaries but grows `packages/edge`; retain cohesive domain files and split a new package only when ownership or dependency constraints justify it. No npm dependency is selected here; future dependency proposals must name exact versions and approval needs.

## Migration plan

Create versioned local settings/repository records behind a capability gate. Validate imported shapes before writing and preserve the last valid snapshot on failure. Enable only the verified capability subset after its acceptance scenarios pass. Roll back by disabling the capability and retaining readable user records; destructive native side effects need their own recovery flow.

## Verification and outstanding evidence

Use the recovered playlist shapes as independently authored fixtures, plus missing/non-MP3/directory cases. Drive a configured key and actual player controls against a fake audio backend and clock; assert gain ramps, session replacement, stop-all and no host-volume API call. Native audio output and physical key/touch behavior remain unverified.

Implementation closure requires scenario evidence and parent-managed Beads updates. The tasks in tasks.md remain unchecked in this design lane. Do not launch DK-Suite; use independent fixtures and the open-quake application for future verification.

## Reconciliation with soundboard-playback (2026-10-23)

Two parallel lanes specced the same feature. `soundboard-playback` was folded into this change and removed, and its epic bead was superseded. Where the two disagreed, these choices apply. Ramiro approved both changes' proposals on 2026-10-23, and this merge chooses between them:

- Concurrency: keep this change's per-key sessions with stopAudio for all, under one soundboard-wide AudioOutput lease (from soundboard-playback). Voice capture preempts every session without fade and nothing auto-resumes.
- Missing files: per-entry visible status (from soundboard-playback) instead of silent filtering with a warning.
- Repeat: no repeat or shuffle in this change. The earlier "unless explicitly configured repeat" escape is dropped until a repeat mode has its own requirement.
- Fade bounds: linear ramps, 0..10,000 ms (from soundboard-playback).
- First-release boundary, the HTTPS-URL rejection, needsConfiguration for unknown numeric audioAction/audioFade, the 10 s readiness timeout and rescan semantics all come from soundboard-playback.

Carried-over evidence: `ATLAS/artifacts/ipc_channels.txt` (N) names PlayerReady, AudioTrackNaturalEnd, AudioPlaylistAction, RequestPlayAudioPlaylistRescan, AudioPlayStart/Stop/LoadError and get-play-audio-runtime-status. Exact payloads and timing are unverified.

Catalog errors: `MEDIA.SOUNDBOARD.CONFIG_INVALID`, `MEDIA.SOUNDBOARD.FILE_UNAVAILABLE`, `MEDIA.SOUNDBOARD.LOAD_TIMEOUT`, `MEDIA.SOUNDBOARD.OUTPUT_BUSY`, `MEDIA.SOUNDBOARD.PLAY_FAILED`. Diagnostics use file IDs and outcome codes, never absolute paths.
