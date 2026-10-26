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

1. Approved (Ramiro, 2026-10-23): initial playback is one active session per DK-Player key, with explicit play replacing that key's current playback; PLAY_ADD creates additional identified instances (`KNOB-082`), and distinct keys may overlap. stopAudio stops all sessions and restores no OS volume.

2. Approved (Ramiro, 2026-10-23): preserve source playlist order, use per-session volume 0–100, and define fade durations in milliseconds. Decode the recovered action values 0..6 and fade strings `<type>-<ms>` at the import boundary (`KNOB-082/083`), with fixtures for every value.

3. Approved (Ramiro, 2026-10-23): MP3 is the initial verified input subset. No directory scanning, streaming URLs or codec expansion is implied by a path string.

### Data model

Approved (Ramiro, 2026-10-23): SoundKeyConfig stores ordered managed local file references, typed playback action, volume 0–100 and fadeInMs/fadeOutMs. PlaybackSession is keyed by profile/key identity and contains track index, position, generation ID and idle/playing/paused/stopped/failed state. Legacy sound-value decoding is kept at import boundaries.

### Data flow and lifecycle

Approved (Ramiro, 2026-10-23): The profile owner saves normalized key settings. The player conductor validates files and sends commands to an injected audio backend, publishing one state stream for panel and desktop. Explicit play replaces only that key's playback generation; PLAY_ADD retains independently identified instances. Late callbacks from stopped/replaced generations are discarded. Playlist navigation and natural end wrap indefinitely, skipping unavailable files with a bounded scan (`KNOB-086`). Global stopAudio enumerates active sessions once.

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
- Repeat: superseded by the 0.4.95 audit correction (`KNOB-086`). Playlists wrap indefinitely in source order and previous/next wrap too. No shuffle is implied. Keep visible missing-file status while skipping unavailable entries; stop when none are available.
- Fade bounds: linear ramps, 0..10,000 ms (from soundboard-playback).
- First-release boundary, the HTTPS-URL rejection, needsConfiguration for controls outside recovered audioAction 0..6 / audioFade types 0..3 or malformed fade strings, the 10 s readiness timeout and rescan semantics all come from soundboard-playback.

Carried-over evidence: `ATLAS/artifacts/ipc_channels.txt` (N) names PlayerReady, AudioTrackNaturalEnd, AudioPlaylistAction, RequestPlayAudioPlaylistRescan, AudioPlayStart/Stop/LoadError and get-play-audio-runtime-status. Exact payloads and timing are unverified.

Catalog errors stay in the shared `QUAKE.*` catalog, per the failure contract above. soundboard-playback's `MEDIA.SOUNDBOARD.*` names are dropped, and its two extra cases join the existing `QUAKE.AUDIO` leaves: `QUAKE.AUDIO.CONFIG_INVALID`, `QUAKE.AUDIO.FILE_UNAVAILABLE`, `QUAKE.AUDIO.DECODE_FAILED`, `QUAKE.AUDIO.OUTPUT_FAILED`, `QUAKE.AUDIO.LOAD_TIMEOUT`, `QUAKE.AUDIO.OUTPUT_BUSY`. Diagnostics use file IDs and outcome codes, never absolute paths.

## Configuration-import implementation, 2026-10-25

The first implemented step is a review-only version-1 preview, not a playback capability. It accepts the saved playAudio key actions, equivalent migration fields, or a previous preview. It preserves duplicate selections and ordering, represents each unavailable entry, rechecks saved availability, and requires explicit review before a future profile save. Numeric operation/fade decoding is exact. Unknown controls remain needsConfiguration. A preview cannot acquire AudioOutput or execute an action.

Metadata inspection is injected through SoundboardFiles. The desktop adapter only stats/checks access on explicit local paths and never traverses directories or decodes media. Limit inputs to 1,024 entries, 32,768 characters per path and 1 MiB of path data, four concurrent probes and a two-second per-probe Effect deadline. Reject URLs, relative paths, network shares, device paths and control characters before IO. Configuration contains private paths; diagnostics contain only catalog identity, source errno and static span/log names. File IDs are deterministic and scoped to the ordered configuration. Playback stays unavailable until the remaining tasks are delivered and verified.

## First-release tile decision, 2026-10-25

Opus 5.5 reviewed the actual PlayerSlot source and chose a neutral unavailable
state for local soundboard keys. Only exact empty sound plus audioAction 0 retains
the existing native system-media player; malformed, missing, duplicate, legacy,
nonempty and other operation values stay with the unavailable local owner.
Volume/fade edits alone don't turn native media into local playback. No path
parsing, IO or transport is part of this predicate.

A full-width blocked tile uses the existing black device palette, muted playlist
glyph and source row, a clear release-limit heading and retained-file explanation.
It has no jade action, buttons, sub-touch targets or live announcements. Compact
legacy keys retain their artwork with a neutral Unavailable chip. No file paths,
names or counts appear. Native media transport/card and strip geometry stay with
their owners. Source of the design decision is delegated task
`oq-soundboard-boundary-design-20261025-r1`; artifacts stay outside git.

## Playback implementation boundary, 2026-10-26

The runtime repository owns bounded session snapshots, not a second copy of the
profile configuration on disk. The profile owner supplies a validated playlist
revision for each explicit request. Public snapshots contain file IDs and entry
status, never private paths. A scoped player port owns native resource cleanup;
the conductor owns per-key instances, track generations and the one soundboard
output reservation shared with production speech.

Commands serialize, while output preemption invalidates the entire group before
awaiting cleanup. Pending native acquisition has its own closeable scope so voice
can cancel readiness without waiting for the command lock. Natural-end tokens
carry instance and track generation; consumed and stale tokens do nothing. The
ten-second readiness deadline includes native acquisition and readiness. These
modules remain uncomposed behind the first-release boundary until their native
adapter and consumer acceptance are delivered.


## Playback controls, 2026-10-26

The conductor delegates controls, explicit-list selection and track-scoped gain
ramps to separate modules. Pause/resume retains the native player and position;
previous/next wraps and performs at most one configured-list traversal. Rescan
updates availability without reopening a decoded player. Navigation from a
stopped key chooses its target before decoding rather than briefly starting the
remembered file. Profile deactivation invalidates pending requests as well as
active sessions.

Ramps use the Effect clock, update element gain at most every 20 ms, retain the
latest applied gain, and run outside the global command gate. Cancelling a ramp
awaits its native write fiber before a successor starts. Every ramp is bound to
the track's scope and generation. Stop/restart waits for applicable fade-out;
capture and teardown bypass it. Stop intent survives natural completion during
its fade, and an end observed while paused is retained until resume. Pending
start requests are bounded at 128 and carry cancellation identity through metadata
checks, fades and the serialized start. A newer command can supersede an older
Stop All fade without its late completion stopping the replacement.

Only service/native-adapter behavior is implemented here. The approved
first-release key/renderer/IPC gate remains intact; task 3.1 owns production
consumer composition and acceptance. No visual design decision changes.

### PR59 follow-up concurrency fixes

Natural completion now defers to a command-owned replacement through its outgoing
fade. New controls clear that intent; interruption/failure releases resources
still owned by the cancelled replacement. Play checks its request again after
native readiness before beginning either incoming or fresh-play outgoing gain.
Stop All and profile deactivation include matching already-stopping sessions in
their snapshot, awaiting cached cleanup without selecting later replacements.

Six deterministic real-service regressions failed before these fixes and pass
afterward. A seventh covers interrupted replacement after natural end. All 126
soundboard/audio tests, both package typechecks, scoped Biome and strict spec pass.
The hidden muted Electron control harness passes actual MP3 decode, pause/resume,
navigation, rescan, natural end, capture preemption, gain ramps and teardown with
zero remaining windows/workers. Artifacts stay external in
`open-quake-finish/soundboard-controls/review-r2/`. Production consumer composition
and audible/physical acceptance remain open.

The next PR59 review identified the separate stopped-key navigation readiness
path and volume superseding a replacement after natural completion. Navigation
now checks its request after readiness before ramping. A successful, still-owned
volume command processes any deferred end after applying its gain. Four cases
cover both navigation directions and volume superseding replacement/navigation;
three fail before the fix. All 130 soundboard/audio tests, both package types,
scoped Biome and strict spec pass. A fresh muted native control harness also
passes with no remaining windows/workers. External outputs use the
`review-r2/second-*` names. Production consumer and physical limits are unchanged.

## Cluster 18 composition

The main application supplies one AudioOutput instance to speech and SoundboardService. KeyRuntime forwards only a committed key plus activation identity after its guards; local audio waits for release. The adapter decodes the recovered controls and supplies the profile revision to the existing conductor. The empty system-media preset stays with its current owner. No second decoder or soundboard playback service is introduced.

### Selection commit ownership

The shared ProfileRepository compares committed device selections after persistence and publication, under its transaction lock. An injected ProfileSelectionCommit callback invalidates that device's soundboard owner only when its profile or page changes. Direct ProfileService selections and manager/automatic transactions share this path. Fallible delivery, rejected writes and expired guards never reach the callback; redelivery and unchanged selections don't invalidate playback. The desktop callback doesn't reenter the repository. The recovered KNOB-086 lifecycle evidence and profile/page decision are cited in the Cluster 18 requirement.

### Bounded committed-selection cleanup

The desktop selection commit callback wraps resetOwned in a recoverable Effect with a five-second timeout. Only the post-publication promise wait is interruptible because the repository holds an uninterruptible commit lock. Failures and timeouts log catalog codes and scrubbed diagnostic causes without device identifiers or upstream messages. Recovery continues cleanup for later devices and preserves the already durable commit. A timed-out promise may still finish its underlying cleanup; it no longer holds the repository lock.
