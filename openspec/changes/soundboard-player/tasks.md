# Tasks

Implementation tasks. Configuration import and the first-release boundary have verified source implementations; playback remains open. This change absorbed `soundboard-playback` on 2026-10-23, so its tasks are folded in below. One epic bead for this change, one issue bead per numbered task.

## 1. First-release boundary and configuration

- [x] 1.1 Keep imported playAudio visibly unavailable in the first release; verify through actual action dispatch that no file scan or player start happens and chat/voice output is unaffected.
- [x] 1.2 Add versioned playlist/action/fade Schemas, pure invariants and the legacy importer; verify ordered MP3 arrays and single-file values, per-entry status for missing/directory/non-MP3 entries, malformed JSON, every recovered action 0..6 / fade type 0..3 (`KNOB-082/083`) and out-of-mapping controls as needsConfiguration, gain/fade bounds and idempotence with unit/property tests.

## 2. Playback lifecycle (macOS first)

- [ ] 2.1 Implement soundboard repository/conductor and audio adapter with per-key generation IDs and catalog errors; verify explicit-play replacement, PLAY_ADD independent instances, stale and duplicate natural-end rejection, independent keys, stop-all and the 10 s readiness timeout.
- [ ] 2.2 Implement pause/resume/navigation, linear gain ramps, rescan and teardown; verify position continuity, first/last wrap, indefinitely looping playlists, bounded missing-file skip and all-unavailable stop (`KNOB-086`), interrupted ramps, zero gain, rescan without restart and no host-volume mutation with a fake player and TestClock.
- [ ] 2.3 Integrate the shared AudioOutput lease; verify voice preemption of all sessions without fade, no auto-resume, busy while speech owns output, and a delayed soundboard stop leaving TTS intact against the real output service.

## 3. Player acceptance

- [ ] 3.1 Wire the DK-Player preset and actual key/UI controls through shared playback state with user documentation; verify both consumers observe the same session and profile deactivation stops its sessions.
- [ ] 3.2 Run all soundboard-player scenarios against a fake backend, then native macOS MP3 playback when available; record output-device and physical-trigger evidence without claiming unrun hardware checks.
- [ ] 3.3 Exercise Linux playback/focus with real audio and the same conformance fixtures.

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

PR55 was normally restacked against reviewed main on 2026-10-26. Diagnostic
allowlists retain both native-media and importer names; the final diff contains
only the importer scope. All 53 importer tests, 16 filesystem/diagnostics tests,
both typechecks, scoped Biome and strict OpenSpec pass. This disposable worktree
initially lacked generated Husky shims; installing frozen dependencies restored
them, and the first merge's commit-message/post-commit consumers were checked
explicitly before the normal final merge and push gates. Reviewed delivery is
still pending; no playback is enabled by this restack.
