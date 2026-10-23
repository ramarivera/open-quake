# Spec Delta

## Purpose

The DK-Player default profile includes audio action, fades and volume. Recovered parsing also establishes MP3 playlists and a legacy single-file format, which need consistent behavior across key and desktop controls. This change is the single soundboard contract; it absorbed the duplicate `soundboard-playback` change on 2026-10-23.

## ADDED Requirements

### Requirement: Later local-only soundboard

Soundboard SHALL remain disabled in the first release; imported playAudio keys SHALL stay visibly unavailable and SHALL NOT scan files or start a player. When enabled it SHALL use explicit user-selected local MP3 files and SHALL require no AI provider, account, cloud library, remote URL, or directory scan.

#### Scenario: First-release imported key

- **WHEN** a first-release user presses a key imported with a playAudio configuration
- **THEN** the key reports soundboard unavailable, no file is read, and chat/voice output is unaffected

#### Scenario: Remote sound URL supplied

- **WHEN** a sound action contains an HTTPS URL instead of a selected local file
- **THEN** validation fails and no download or playback begins

### Requirement: DK-Player configuration

The system SHALL expose a DK-Player profile preset with playAudio configuration for playlist, named playback operation, fade-in/out and volume. Saving the preset SHALL use the profile contract and preserve unrelated profile fields.

#### Scenario: Empty preset

- **WHEN** a user creates DK-Player without selecting an audio file
- **THEN** the player is idle/unconfigured and pressing play starts no backend session

#### Scenario: Save one audio key

- **WHEN** a user changes a key's volume and playlist
- **THEN** the saved key reflects those changes without replacing other keys

### Requirement: Safe configuration import

The importer SHALL accept ordered local MP3 path lists, the recovered JSON-array representation and the legacy single-MP3 value, preserving order. It SHALL publish per-entry status for missing, unreadable, non-file and non-MP3 entries instead of silently dropping them, SHALL NOT traverse directory paths, and SHALL reject malformed JSON. Unknown numeric audioAction/audioFade values SHALL become needsConfiguration rather than guessed behavior. Migration SHALL be idempotent and save only after user review.

#### Scenario: Legacy import

- **WHEN** a saved sound value contains one existing MP3 path
- **THEN** it becomes a one-track playlist in the same key

#### Scenario: Mixed or invalid files

- **WHEN** a playlist contains two valid MP3 files, a missing file and a directory
- **THEN** the two valid files retain their order and the invalid entries are listed with their status without directory traversal

#### Scenario: Unknown recovered numeric control

- **WHEN** imported sound files are valid but audioAction has an unverified numeric value
- **THEN** the files appear in the migration preview, runnable playback stays disabled, and the user must choose a named operation

### Requirement: Shared per-key playback sessions

Desktop and key controls SHALL operate the same per-key playback session with play, pause, resume, stop, previous and next. Each session SHALL expose idle/loading/playing/paused/stopped/failed status keyed by playbackId and playlist revision. Repeated play SHALL replace that key's session; different keys SHALL remain independent until stopAudio stops all soundboard sessions. Pause/resume SHALL preserve position and stop SHALL reset it.

#### Scenario: Key and UI control

- **WHEN** a key starts playback and the desktop pauses it
- **THEN** both controls show paused at the same position and resume continues that session

#### Scenario: Replace and stop all

- **WHEN** key A plays twice while B also plays, then stopAudio runs
- **THEN** A has only its newest session, B remains independent until stopAudio stops both

### Requirement: Track navigation

Track navigation SHALL preserve playlist order, start the target track at its beginning, and clamp previous at the first track and next at the last. Natural end SHALL advance exactly once, or stop after the final track; no repeat or shuffle is implied.

#### Scenario: End of playlist

- **WHEN** the last track ends
- **THEN** the session becomes stopped and does not restart or select a random track

#### Scenario: Boundary navigation

- **WHEN** previous is requested on the first track or next on the last
- **THEN** the selected track stays at that boundary and no out-of-range file access occurs

#### Scenario: Duplicate natural-end callback

- **WHEN** the same track reports naturalEnd twice for one playbackId
- **THEN** only one track advance occurs

### Requirement: Bounded gain and interrupted fades

The player SHALL validate per-session volume 0..100 (gain 0..1) and linear fade-in/fade-out durations 0..10,000 ms, apply fades within the session's target volume, and leave host system volume unchanged. A new command SHALL cancel the session's pending ramp and start from current gain; stale fade callbacks SHALL NOT change a newer playbackId. Zero volume SHALL NOT imply stop.

#### Scenario: Fade and stop

- **WHEN** a track starts at volume 50 with a 1000 ms fade-in and is stopped with a 500 ms fade-out
- **THEN** gain ramps from zero to at most 50, then to zero over the stop fade, and the session releases its audio resource

#### Scenario: New play during fade-out

- **WHEN** stop is fading playback A on a key and play creates B on the same key
- **THEN** A's pending ramp is cancelled and cannot lower B's gain later

#### Scenario: Invalid audio parameters

- **WHEN** volume is 101 or a fade duration is negative or above 10,000 ms
- **THEN** the update is rejected and the active valid configuration remains

### Requirement: Readiness, rescan, and missing files

Loading SHALL fail after 10 s without player readiness. Rescan SHALL check only the configured list, publish per-entry availability, and SHALL NOT restart current playback. An unavailable next track SHALL fail visibly before it starts, and an all-unavailable playlist SHALL NOT acquire output.

#### Scenario: File removed after configuration

- **WHEN** a configured file disappears before play
- **THEN** that key reports file-unavailable and no unrelated session stops

#### Scenario: Rescan after file removal

- **WHEN** an upcoming track is removed while the current decoded track plays
- **THEN** rescan marks it unavailable, current playback is not restarted, and advancing to it reports a file error

### Requirement: Shared audio ownership

The soundboard SHALL hold one shared AudioOutput lease while any of its sessions plays and release it when the last session ends. Voice capture SHALL stop all soundboard sessions immediately before mic start, bypassing configured fades, and capture completion SHALL NOT resume them. New play requests SHALL fail busy while capture or speech owns output. Soundboard stop SHALL release only its own lease and SHALL NOT stop TTS.

#### Scenario: Voice capture preempts playback

- **WHEN** two keys are playing and push-to-talk starts capture
- **THEN** both sessions stop without fade before the mic opens, and neither resumes after capture ends

#### Scenario: Soundboard stop arrives during speech

- **WHEN** soundboard is already stopped and a delayed soundboard stop arrives while TTS is playing
- **THEN** the speech output continues and only soundboard status is affected

### Requirement: Playback failures and teardown

The system SHALL report decode, output-device and file errors against the affected session using catalog errors with file IDs rather than absolute paths, reflect state consistently on panel and management views, and release sessions on profile deactivation or shutdown.

#### Scenario: Profile deactivated

- **WHEN** a playing key's profile is deactivated
- **THEN** that profile's sessions stop and their audio resources are released
