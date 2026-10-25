# Tasks

Implementation tasks. Only the verified configuration-import task is complete; playback and first-release dispatch acceptance remain open. This change absorbed `soundboard-playback` on 2026-10-23, so its tasks are folded in below. One epic bead for this change, one issue bead per numbered task.

## 1. First-release boundary and configuration

- [ ] 1.1 Keep imported playAudio visibly unavailable in the first release; verify through actual action dispatch that no file scan or player start happens and chat/voice output is unaffected.
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
