# Tasks

These are future implementation tasks. This lane creates specs only; no checkbox is complete. The parent creates one epic for this change and one issue per numbered task, using each task's text as its description and this OpenSpec path as its reference. Do not close implementation issues on planning-only evidence.

## 1. Configuration and compatibility

- [ ] 1.1 Resolve overlap/stop-all/track-boundary proposals and map legacy audioAction/audioFade encodings from source fixtures; verify documented mappings or keep unsupported legacy forms explicitly rejected.
- [ ] 1.2 Add playlist/action/fade schemas and pure invariants with import-format documentation; verify ordered MP3 lists, single-file legacy values, missing entries, directories and gain bounds.

## 2. Playback lifecycle

- [ ] 2.1 Implement soundboard repository/conductor and audio adapter with per-key generation IDs and catalog errors; verify repeated-play replacement, stale callback rejection, independent keys and stop-all.
- [ ] 2.2 Implement pause/resume/navigation/gain scheduling and teardown; verify position continuity, first/last boundaries, end-of-playlist, configured fade timing and no host-volume mutation.

## 3. Player acceptance

- [ ] 3.1 Wire DK-Player preset and actual key/UI controls through shared playback state with user documentation; verify both consumers observe the same session and profile deactivation stops its sessions.
- [ ] 3.2 Run all soundboard-player scenarios against a fake backend, then native MP3 playback when available; record output-device and physical-trigger evidence without claiming unrun hardware checks.
