# Tasks

Implementation tasks. Configuration import, playback lifecycle and cluster 18 key composition have source implementations. Desktop playback controls and physical acceptance remain open. This change absorbed `soundboard-playback` on 2026-10-23, so its tasks are folded in below. One epic bead for this change, one issue bead per numbered task.

## 1. First-release boundary and configuration

- [x] 1.1 Establish the original unavailable imported-key boundary with no file scan or player start. Cluster 18 task 4.1 supersedes this boundary for configured committed keys while retaining quarantine and silent import previews.
- [x] 1.2 Add versioned playlist/action/fade Schemas, pure invariants and the legacy importer; verify ordered MP3 arrays and single-file values, per-entry status for missing/directory/non-MP3 entries, malformed JSON, every recovered action 0..6 / fade type 0..3 (`KNOB-082/083`) and out-of-mapping controls as needsConfiguration, gain/fade bounds and idempotence with unit/property tests.

## 2. Playback lifecycle (macOS first)

- [x] 2.1 Implement soundboard repository/conductor and audio adapter with per-key generation IDs and catalog errors; verify explicit-play replacement, PLAY_ADD independent instances, stale and duplicate natural-end rejection, independent keys, stop-all and the 10 s readiness timeout.
- [x] 2.2 Implement pause/resume/navigation, linear gain ramps, rescan and teardown; verify position continuity, first/last wrap, indefinitely looping playlists, bounded missing-file skip and all-unavailable stop (`KNOB-086`), interrupted ramps, zero gain, rescan without restart and no host-volume mutation with a fake player and TestClock.
- [ ] 2.3 Integrate the shared AudioOutput lease; verify voice preemption of all sessions without fade, no auto-resume, busy while speech owns output, and a delayed soundboard stop leaving TTS intact against the real output service.

## 3. Player acceptance

- [ ] 3.1 Wire the DK-Player preset and actual key/UI controls through shared playback state with user documentation; verify both consumers observe the same session and profile deactivation stops its sessions.
- [ ] 3.2 Run all soundboard-player scenarios against a fake backend, then native macOS MP3 playback when available; record output-device and physical-trigger evidence without claiming unrun hardware checks.
- [x] 3.3 Exercise Linux playback/focus with real audio and the same conformance fixtures. Native Electron/PipeWire loopback and 138 shared conformance tests pass; reviewed delivery tracked by `open-quake-uv9.8`. This does not establish physical speaker output or hearing.

## Configuration import verification, 2026-10-25

Task 1.2 now has a version-1 review-only preview, actual saved playAudio action-shape import, exact recovered action/fade mappings, pure bounded-path/configuration checks, an Effect importer with bounded metadata probes, and a read-only desktop filesystem adapter. Unit/property tests cover order, duplicate entries, all controls, malformed JSON, boundaries, no remote-path probing, stable migration and fresh availability. Native filesystem tests cover missing files, directory/non-MP3 status and real permission denial. A real diagnostics runtime retains fault catalog identity and correlated importer/probe spans without paths, raw messages or credentials. Import performs no persistence, decoding, audio acquisition, player start or OS-volume mutation. Task 1.2 remains in progress in Beads pending reviewed PR delivery; all playback, shared output, UI and native/physical acceptance tasks remain open.

PR55 review found that trimming a legacy single-file value could inspect a different path. The targeted regression failed before the fix; single-file values now retain exact whitespace while JSON detection and deliberate empty values retain syntax trimming. Missing production UI/IPC consumers are explicitly tracked by task 3.1 and open-quake-uv9.5; source import completion does not claim desktop availability.

## First-release boundary verification, 2026-10-26

Opus 5.5's unavailable-tile decision is implemented for imported local and legacy
keys. Only the exact empty sound/action-zero preset retains native system-media
controls. Whitespace, arrays, malformed, missing, duplicate and other operation
values cannot become system-media actions. Full-width tiles show the release
limit without filenames; compact keys retain artwork with an Unavailable chip.

Two actual KeyRuntime/production desktop-port consumers exercise quarantined and
unquarantined imports while the real shared output owner holds a speech lease.
Neither performs filesystem probes, starts an Electron worker, invokes owned,
host, clipboard or media actions, publishes invalid-operation feedback, or
interrupts speech. Twenty-six ownership/render tests cover the actual registry,
malformed settings, private-data exclusion and preserved built-in transport.
All 320 focused strip/weather/dispatch tests, desktop typecheck, scoped Biome,
production build and strict OpenSpec validation pass.

The hidden Electron smoke uses production renderer/preload and isolated mock IO.
Both tile sizes and existing native-media/weather scenarios pass, with the media
action list unchanged at one explicit pause. A new geometry assertion caught
nine pixels of explanation clipping caused by default paragraph margins. Local
spacing now prevents flex shrink; the final measured detail scroll/client height
is 85/85 pixels, both copies fit and the compact chip retains artwork within its
key. Final screenshots were inspected. External artifacts are under
`soundboard-boundary/native-verified` in the project scratch directory.

This proves the first-release boundary, not MP3 playback or physical input.
open-quake-uv9.1 remains in progress until reviewed delivery. Playback lifecycle,
shared session integration and native/physical acceptance remain open.


## Shared output prerequisite, 2026-10-25

Task 2.3 now has a canonical `AudioOutput` Effect service and production desktop
speech/capture composition. It serializes transitions, invalidates old tokens
before native teardown, caches cleanup per token, stops all resources registered
by a soundboard group without fades, rejects new soundboard ownership during
speech/capture, and bounds native cleanup at two seconds. Failed teardown blocks
future acquisition. Interrupted acquisition, late worker creation, duplicate
release and stale soundboard stop cannot acquire or stop a replacement output.
Catalog errors and allowlisted spans retain source identity without private paths.
Recognition holds the scoped capture reservation through protocol errors and
cancellation; completion never resumes prior soundboard playback.

The actual hidden native Electron smoke uses a synthetic microphone and muted
output. It passes production output readiness, natural drain, voice/capture
preemption, busy rejection, stale group-release isolation and cleanup. Artifacts
are external under `shared-output/speech-electron-J8aEEj`. Unit and real-service
consumer tests cover concurrent teardown, capture failure/cancellation, retained
original causes, and persisted diagnostic correlation. This does not establish
MP3 playback or actual soundboard-session wiring. Task 2.3 and open-quake-uv9.7
remain incomplete until the conductor supplies its live session group; prerequisite
source/delivery is tracked separately by open-quake-uv9.9. Tasks 2.1/2.2/3.1 and
native/physical acceptance remain open.

PR56 review found shutdown could return while preempted native resources were
still stopping. Shutdown now invalidates ownership immediately and waits through
the same transition gate as acquisition. Two deterministic regressions fail on
the previous source and cover both completed and timed-out prior cleanup, with
no replacement lease granted after shutdown.

## Gated playback lifecycle verification, 2026-10-26

Task 2.1 now has a scoped conductor, bounded detached runtime repository and a
sandboxed desktop MP3 adapter. Independent real-service tests verify same-key
replacement, additional instances, different keys, wrapping/loop-track behavior,
stale/duplicate native completions, missing-file skipping, stop-all, remembered
track identity and the total ten-second acquisition/readiness/start deadline.
The configured path-data and opaque-ID bounds precede IO; unsupported fades are
rejected rather than ignored while task 2.2 remains open.

Five initial consumer regressions reproduced failure-state, remembered-track,
preempted-load, delayed Stop and mutable-snapshot defects before their fixes.
Additional tests cover concurrent Stop/capture/close, interrupted readiness,
native-end transitions, 128 active sessions, 256 terminal snapshots, shutdown
and a stalled native finalizer. The real AudioOutput service fails closed at its
two-second deadline and doesn't grant replacement output after unsafe cleanup.
Native teardown defects publish failed observations. Actual diagnostic storage
preserves correlated conductor/player catalog errors and original EACCES identity
without local paths or raw error text.

A hidden native Electron run decodes a generated MP3 with muted output, pauses
and resumes at the same position, consumes natural completion through the real
conductor, preempts two key instances for capture, isolates stale Stop from
replacement speech, and reports corrupt MP3 decode failure. Final cleanup found
zero player windows and zero worker directories. The harness first needed two
corrections: avoid top-level app-readiness await, and retain the scoped Layer
instead of returning an already-finalized service. Both are external harness
issues; the final run passes. Artifacts and full-suite logs stay external under
`open-quake-finish/soundboard-playback/` in the project scratch directory.

Task 2.1 source is complete; reviewed delivery remains tracked by uv9.3. This
doesn't enable release playback. Task 2.3 has actual conductor/shared-output and
native muted evidence, but remains open for production composition and completed
fade semantics. Tasks 2.2 and 3.x, audible output, physical triggers and Linux
audio acceptance remain open. The full edge suite passes 573 tests, including
the final unsupported-fade and queued ownership regressions. The full desktop
suite passes 1,567 tests. Existing skips are three external edge cases and one
native desktop case. Both typechecks, lint, production build, both bundle smoke
modes and strict validation are required for delivery.


## Playback controls source verification, 2026-10-26

Task 2.2 source now supplies pause/resume, explicit wrapped navigation, rescan,
linear element-gain ramps, all seven imported operations and profile teardown.
The source tests exercise the real conductor and AudioOutput owner with Deferred
and TestClock, including Stop All during metadata, replacement during fade-out,
concurrent ramp cancellation awaiting native finalization, interrupted callers,
natural end during Stop/paused states, invalid updates and missing-file traversal.
A property test covers arbitrary volume/navigation sequences. Original lifecycle
scenarios remain covered; task 2.1's interim rejection test now rejects invalid
fade bounds because valid fades are implemented.

A hidden muted Electron run verifies the actual decoder through service
pause/resume with increasing position, unchanged generation during rescan,
previous/next wrapping, zero-gain playback, outgoing fade timing, natural end,
two-key capture preemption, stale Stop isolation, decode failure and cleanup.
The final run measured a 150 ms fade at 158 ms and found zero player windows or
worker directories. Diagnostics persist real open and pause failures with catalog
identity, original EACCES cause and no private paths. Current tests and source
notes live in the change; generated run evidence stays outside git under
`open-quake-finish/soundboard-controls/` and `soundboard-playback/native/`.

Reviewed delivery remains open under uv9.4. Task 2.3 and task 3.1 remain open for
production composition/consumers, despite direct shared-output and native source
proof. The first-release unavailable key/renderer/IPC boundary is unchanged.
Audible output, physical triggers and Linux audio acceptance remain unverified.

## PR59 concurrency review, 2026-10-26

Six deterministic regressions reproduced the reported failures before the fix:
profile deactivation during output delivery and replacement cleanup, Stop All
during replacement cleanup, natural completion during next/previous fades, and
a stalled rescan blocking another key's pause. Starts now recheck request and
epoch validity after each asynchronous ownership boundary and release an idle
reservation when rejected. Explicit navigation defers automatic advancement until
its selection settles. Interrupted navigation stops its player. Metadata rescan
runs outside the shared command gate and publishes only for the current slot,
track generation and latest scan. Two additional regressions cover interrupted
navigation cleanup and a stale overlapping scan. The production release gate
remains unchanged; this is service source proof, not user-facing playback.


PR59 follow-up review reproduced three additional failures before correction.
A precomposed profile-stop effect now snapshots sessions only when it executes.
Navigation rechecks command ownership after the final unavailable-file probe,
so a newer pause or volume command survives instead of losing its player. All
133 soundboard/audio tests, both typechecks, scoped Biome and strict validation
pass. The fresh hidden muted native MP3 smoke passes playback controls, natural
end, two-key preemption, stale-stop isolation and cleanup with zero windows or
workers. This remains source acceptance with the release boundary unchanged.

PR55 was normally restacked against reviewed main on 2026-10-26. Diagnostic
allowlists retain both native-media and importer names; the final diff contains
only the importer scope. All 53 importer tests, 16 filesystem/diagnostics tests,
both typechecks, scoped Biome and strict OpenSpec pass. This disposable worktree
initially lacked generated Husky shims; installing frozen dependencies restored
them, and the first merge's commit-message/post-commit consumers were checked
explicitly before the normal final merge and push gates. Reviewed delivery is
still pending; no playback is enabled by this restack.

PR58 lifecycle review follow-up, 2026-10-26: three regressions first failed on
the reviewed source. A native teardown defect during natural advancement now
uses the existing slot cleanup, publishes AudioOutputFailed, retains unsafe
teardown ownership and prevents capture from acquiring output. Releasing an
empty idle group no longer invalidates another key already queued at the gate;
both decode failure and the ten-second load timeout are covered. All 89 focused
soundboard/shared-output tests, both typechecks, scoped Biome and strict
soundboard validation pass. The release gate stays unchanged.

PR58 interrupted teardown review: Stop and capture during natural advancement
reproduced a mutual wait before the fix. Cleanup now waits for shared native
teardown before interrupting its watcher, and the watcher does not re-enter
cleanup after its slot has been removed. Both operations finish successfully
once native teardown settles, without falsely poisoning the output owner. All
91 focused soundboard/audio tests pass, including the original native-defect
and bounded-stalled-teardown cases. Release playback remains disabled.

PR58 native-worker cleanup review: the late-acquisition regression now waits
for an explicit callback checkpoint before interrupting. Temporary HTML-file
deletion uses three bounded retries after the audio window is destroyed. A
residual deletion failure emits an allowlisted warning through the owning
runtime with the existing scrubbed catalog error, without poisoning shared
audio ownership or replacing an acquisition failure. The deletion regression
failed before the fix; 25 desktop player/diagnostics tests and 91 shared-output
tests, desktop typecheck, scoped Biome and strict validation pass. A fresh
hidden, muted Electron MP3 run proves native playback/pause/end, two-key capture
preemption, corrupt-file rejection and zero remaining windows/workers. External
evidence is under `soundboard-controls/review-r2/cleanup-native` in project
scratch. Real window-destruction failures still fail closed.

## Native Linux audio conformance, 2026-10-26

The merged playback source at `30613c8` ran on Linux x64 with Electron 43.4.1,
Wayland and PipeWire 1.6.10. The same 138 soundboard/shared-output tests pass.
The production sandboxed MP3 worker emitted a generated tone into a temporary
private null sink. Its monitor measured RMS 0.070720 at gain 0.8, 0.035360 at
0.4, and zero while paused or at zero gain. Pause/resume advanced position from
163.556 to 239.003 ms, and a 150 ms fade completed in 156 ms. The production
conductor also passed wrap, rescan without restart, natural advancement, two-key
capture preemption, stale Stop isolation and typed corrupt-file rejection.

Final cleanup found zero owned audio windows, workers, recorders or virtual
sinks. Default input/output and physical-output volume remained unchanged. No
physical microphone, speakers, key presses, provider or account were used.
Task 3.2 retains physical-trigger/hearing acceptance; tasks 2.3 and 3.1 retain
production consumer wiring. Imported sound keys remain unavailable in release.

The first external test bundle combined two Effect versions. Resolving all
imports to the workspace's exact 3.22.1 dependency removed that warning, and the
clean run reproduced every assertion and measurement. Reproduction sources and
run artifacts remain outside git under `open-quake-finish/linux-audio/` in the
project scratch directory; the Linux fixture is under the corresponding
`~/dev/agentic-scratchpads/open-quake/linux-audio-30613c8/` directory.

## 4. Cluster 18 recovered behavior

- [x] 4.1 Wire guarded local soundboard key releases to the existing conductor using recovered actions 0..6 and fades 0..3; prove all codes, no work on press, stopAudio, profile teardown and shared output preemption with silent fakes (`KNOB-082/083/086`, open-quake-lih.19.2; links open-quake-uv9.5/7).
- [x] 4.2 Verify natural-end and previous/next wrapping, missing-file skipping and interrupted fade timing using TestClock; run all lane gates and record audible/hardware limits (`KNOB-082/083/086`, open-quake-lih.19.5).


## Cluster 18 verification, 2026-10-26

Before this change, main already had the recovered parser, SoundboardService,
native MP3 adapter, linear fades, indefinite wrapping and canonical AudioOutput.
Committed key dispatch did not compose the soundboard owner. This lane supplies
that existing conductor to guarded local key releases and shares the same
AudioOutput instance with speech and wallpaper. Presses and import previews stay
silent, quarantine stays enforced, stopAudio only stops soundboard, and device or
profile teardown cancels its sessions. No second audio playback stack is added.

KNOB-082/083/086 are covered by existing schema/property and TestClock tests plus
new key-adapter and actual KeyRuntime regressions. Every action 0..6 and fade type
0..3 is decoded, repeated natural ends wrap beyond the final track, and the new
restart test observes the outgoing ramp before replacement. Existing real-owner
tests cover capture/speech preemption, busy output and stale Stop isolation.
All lane gates pass, with the same 2,890-test and 46-item validation results
recorded in device-screen-wallpaper/tasks.md. Task 2.3 now has verified production composition in source;
open-quake-uv9.7 stays open behind its existing open-quake-c5w prerequisite.
This lane does not close the broader voice acceptance gate. Task 3.1 / open-quake-uv9.5
retains live desktop playback controls and status, and task 3.2 retains physical
trigger/hearing acceptance. No audio was played aloud, and no real QUAKE or
DK-Suite process was used.

## PR79 review fixes

- [x] 4.3 Centralize profile/page invalidation after a successful guarded repository commit; cover real key-library selection, KeyRuntime navigation, failed delivery/write and stale transactions with regressions. Evidence: KNOB-086; open-quake-lih.19.6.

Review-fix verification: all six new cases fail against PR79 head `95a6844`
and pass with these fixes. Full gates pass with 2,896 tests and four existing
skips, six package typechecks, production build, both bundle modes, Biome
1,158 files with zero errors and 14 existing warnings, and 46 strict OpenSpec
items. External logs, including `regressions-final-before.log`, stay under
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/wallpaper-soundboard/fix1/`.
No renderer UI changes, real QUAKE access, DK-Suite execution or audible playback.

## PR79 round 2

- [x] 4.4 Dispatch configured local soundboard touches through the strip controller while retaining native-media preset sub-controls. Evidence: KNOB-082/086; open-quake-lih.19.8, review 4375809599.
