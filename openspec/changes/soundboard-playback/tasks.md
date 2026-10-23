# Tasks

This is a later capability, independent of provider inference. No soundboard runtime is built by this PR. The parent creates one child Beads issue per checkbox.

## 1. First-release boundary

- [ ] 1.1 Record decisions on named controls, fades, codec scope, and output precedence; verify `openspec validate soundboard-playback --strict` and document soundboard as deferred without blocking direct speech.
- [ ] 1.2 Keep imported playAudio visibly unavailable in first release; verify no file scan/player start or interference with chat/voice through actual action dispatch, and document availability and migration status.

## 2. Later local playback, macOS first

- [ ] 2.1 Implement versioned playlist/action Schemas and legacy importer; verify MP3 arrays/single-file order, invalid JSON/directories, missing files, unknown numeric controls, and idempotence with unit/property tests, and document review/save migration.
- [ ] 2.2 Implement playlist state and desktop player adapter; verify named controls, position preservation/reset, clamped navigation, duplicate/stale natural end, readiness timeout, and rescan without restart through the real profile consumer, and document playback semantics.
- [ ] 2.3 Implement bounded volume/fades and AudioOutput arbitration; verify interrupted ramps, zero gain, voice preemption, no auto-resume, and delayed soundboard stop leaving TTS intact with a fake player/clock and real output service, and document focus behavior.
- [ ] 2.4 Exercise actual macOS local MP3 decoding/output and device controls when available; record codec/control evidence, distinguish synthetic versus physical observations, and document unresolved audio-device behavior.

## 3. Day 2 and later breadth

- [ ] 3.1 Exercise Linux playback/focus with real audio and the same conformance fixtures; document platform gaps and keep unsupported codecs/actions gated.
