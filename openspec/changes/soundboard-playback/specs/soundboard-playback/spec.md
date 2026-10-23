# Soundboard playback

## Purpose

Define explicit local playlists and observable playback controls without making soundboard a first-release speech dependency.

## ADDED Requirements

### Requirement: Later local-only soundboard

Soundboard SHALL remain disabled in first release. When enabled it SHALL use explicit user-selected local MP3 files and SHALL require no AI provider, account, cloud library, remote URL, or directory scan.

#### Scenario: Remote sound URL supplied
- **WHEN** a sound action contains an HTTPS URL instead of a selected local file
- **THEN** validation fails and no download or playback begins

### Requirement: Safe configuration import

The importer SHALL accept a valid legacy single MP3 path or JSON array of MP3 paths in order, classify missing/unreadable files, and reject directories/malformed JSON. Unknown numeric action/fade values SHALL become needsConfiguration rather than guessed playback behavior. Migration SHALL be idempotent and save only after user review.

#### Scenario: Unknown recovered numeric control
- **WHEN** imported sound files are valid but audioAction has an unverified numeric value
- **THEN** the files appear in the migration preview, runnable playback stays disabled, and the user must choose a named operation

### Requirement: Named playlist operations and status

The runtime SHALL expose play, pause, resume, stop, next, and previous plus idle/loading/playing/paused/stopped/failed status keyed by playbackId and playlist revision. Pause/resume SHALL preserve position; stop SHALL reset it. Next/previous SHALL clamp at bounds. Natural end SHALL advance exactly once or stop at the last track without implicit repeat/shuffle.

#### Scenario: Duplicate natural-end callback
- **WHEN** the same track reports naturalEnd twice for one playbackId
- **THEN** only one track advance occurs

### Requirement: Bounded gain and interrupted fades

Volume SHALL be in 0..100, with gain 0..1 and linear fade-in/fade-out durations in 0..10,000ms. A new playback command SHALL supersede the old fade from current gain. Stale fade callbacks SHALL not change a newer playbackId. Zero volume SHALL not imply stop.

#### Scenario: New play during fade-out
- **WHEN** stop is fading playback A and play creates B
- **THEN** A's pending ramp is cancelled and cannot lower B's gain later

### Requirement: Readiness, rescan, and missing files

Loading SHALL fail after 10s without player readiness. Rescan SHALL check only the configured list, publish per-entry availability, and SHALL NOT restart current playback. An unavailable next track SHALL fail visibly before starting, and an all-unavailable playlist SHALL not acquire output.

#### Scenario: Rescan after file removal
- **WHEN** an upcoming track is removed while the current decoded track plays
- **THEN** rescan marks it unavailable, current playback is not restarted, and advancing to it reports a file error

### Requirement: Shared audio ownership

Soundboard SHALL use the shared AudioOutput lease. Voice capture SHALL stop soundboard immediately before mic start, bypassing configured user fades, and capture completion SHALL not resume it automatically. New play requests SHALL fail busy while capture or speech owns output. Soundboard stop SHALL release only its own lease and SHALL not stop TTS.

#### Scenario: Soundboard stop arrives during speech
- **WHEN** soundboard is already stopped and a delayed soundboard stop arrives while TTS is playing
- **THEN** the speech output continues and only soundboard status is affected
