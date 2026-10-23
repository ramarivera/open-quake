# Spec Delta

## Purpose

The DK-Player default profile includes audio action, fades and volume. Recovered parsing also establishes MP3 playlists and a legacy single-file format, which need consistent behavior across key and desktop controls.

## ADDED Requirements

### Requirement: DK-Player configuration

The system SHALL expose a DK-Player profile preset with playAudio configuration for playlist, playback action, fade-in/out and volume. Saving the preset SHALL use the profile contract and preserve unrelated profile fields.

#### Scenario: Empty preset

- **WHEN** a user creates DK-Player without selecting an audio file
- **THEN** the player is idle/unconfigured and pressing play starts no backend session

#### Scenario: Save one audio key

- **WHEN** a user changes a key's volume and playlist
- **THEN** the saved key reflects those changes without replacing other keys

### Requirement: Verified playlist input

The system SHALL accept ordered local MP3 path lists and import the recovered JSON-array and legacy single-MP3 representations. It SHALL filter missing/non-file/non-MP3 entries with a visible warning and SHALL NOT scan directory paths.

#### Scenario: Legacy import

- **WHEN** a saved sound value contains one existing MP3 path
- **THEN** it becomes a one-track playlist in the same key

#### Scenario: Mixed or invalid files

- **WHEN** a playlist contains two valid MP3 files, a missing file and a directory
- **THEN** the two valid files retain their order and the invalid entries are reported without directory traversal

### Requirement: Shared playback control

Desktop and key controls SHALL operate the same per-key playback session with play, pause/resume, stop, previous and next track actions. Repeated play SHALL replace that key's session; different keys SHALL remain independent until stopAudio stops all sessions.

#### Scenario: Key and UI control

- **WHEN** a key starts playback and the desktop pauses it
- **THEN** both controls show paused at the same position and resume continues that session

#### Scenario: Replace and stop all

- **WHEN** key A plays twice while B also plays, then stopAudio runs
- **THEN** A has only its newest session, B remains independent until stopAudio stops both

### Requirement: Track navigation

Track navigation SHALL preserve playlist order, start the target track at its beginning, clamp previous at the first track and next at the last, and stop at the end of the final track unless an explicitly configured repeat mode applies.

#### Scenario: End of playlist

- **WHEN** the last track ends without repeat configured
- **THEN** the session becomes stopped and does not restart or select a random track

#### Scenario: Boundary navigation

- **WHEN** previous is requested on the first track or next on the last
- **THEN** the selected track stays at that boundary and no out-of-range file access occurs

### Requirement: Volume and fades

The player SHALL validate per-session volume from 0 to 100 and non-negative fade durations in milliseconds, apply fades within that session's target volume, and leave host system volume unchanged.

#### Scenario: Fade and stop

- **WHEN** a track starts at volume 50 with a 1000 ms fade-in and is stopped with a 500 ms fade-out
- **THEN** gain ramps from zero to at most 50, then to zero over the stop fade, and the session releases its audio resource

#### Scenario: Invalid audio parameters

- **WHEN** volume is 101 or a fade duration is negative
- **THEN** the update is rejected and the active valid configuration remains

### Requirement: Playback failures and teardown

The system SHALL report decode/output-device/file errors against the affected session, reflect state consistently on panel and management views, and release sessions on profile deactivation or shutdown.

#### Scenario: File removed after configuration

- **WHEN** a configured file disappears before play
- **THEN** that key reports file-unavailable and no unrelated session stops

#### Scenario: Profile deactivated

- **WHEN** a playing key's profile is deactivated
- **THEN** that profile's sessions stop and their audio resources are released
