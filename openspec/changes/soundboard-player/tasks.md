# Tasks

Future implementation tasks; no checkbox is complete. This change absorbed `soundboard-playback` on 2026-10-23, so its tasks are folded in below. One epic bead for this change, one issue bead per numbered task.

## 1. First-release boundary and configuration

- [ ] 1.1 Keep imported playAudio visibly unavailable in the first release; verify through actual action dispatch that no file scan or player start happens and chat/voice output is unaffected.
- [ ] 1.2 Add versioned playlist/action/fade Schemas, pure invariants and the legacy importer; verify ordered MP3 arrays and single-file values, per-entry status for missing/directory/non-MP3 entries, malformed JSON, unknown numeric controls as needsConfiguration, gain/fade bounds and idempotence with unit/property tests.

## 2. Playback lifecycle (macOS first)

- [ ] 2.1 Implement soundboard repository/conductor and audio adapter with per-key generation IDs and catalog errors; verify repeated-play replacement, stale and duplicate natural-end rejection, independent keys, stop-all and the 10 s readiness timeout.
- [ ] 2.2 Implement pause/resume/navigation, linear gain ramps, rescan and teardown; verify position continuity, first/last boundaries, end-of-playlist, interrupted ramps, zero gain, rescan without restart and no host-volume mutation with a fake player and TestClock.
- [ ] 2.3 Integrate the shared AudioOutput lease; verify voice preemption of all sessions without fade, no auto-resume, busy while speech owns output, and a delayed soundboard stop leaving TTS intact against the real output service.

## 3. Player acceptance

- [ ] 3.1 Wire the DK-Player preset and actual key/UI controls through shared playback state with user documentation; verify both consumers observe the same session and profile deactivation stops its sessions.
- [ ] 3.2 Run all soundboard-player scenarios against a fake backend, then native macOS MP3 playback when available; record output-device and physical-trigger evidence without claiming unrun hardware checks.
- [ ] 3.3 Exercise Linux playback/focus with real audio and the same conformance fixtures.
