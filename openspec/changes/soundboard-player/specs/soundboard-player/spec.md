# Spec Delta

## Purpose

The DK-Player default profile includes audio action, fades and volume. Recovered parsing also establishes MP3 playlists and a legacy single-file format, which need consistent behavior across key and desktop controls. This change is the single soundboard contract; it absorbed the duplicate `soundboard-playback` change on 2026-10-23.

## ADDED Requirements

### Requirement: Later local-only soundboard

Cluster 18 enables committed local playAudio, playAudioLegacy and stopAudio keys. Import preview alone SHALL NOT start playback; a guarded explicit release is required. Soundboard SHALL use explicit user-selected local MP3 files and SHALL require no AI provider, account, cloud library, remote URL, or directory scan.

#### Scenario: Import preview stays silent

- **WHEN** a user previews an imported playAudio configuration without activating its committed key
- **THEN** no player starts and chat/voice output is unaffected

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

The importer SHALL accept ordered local MP3 path lists, the recovered JSON-array representation and the legacy single-MP3 value, preserving order. It SHALL publish per-entry status for missing, unreadable, non-file and non-MP3 entries instead of silently dropping them, SHALL NOT traverse directory paths, and SHALL reject malformed JSON. The importer SHALL decode the recovered `audioAction` values and `audioFade` encoding below. Values outside those mappings or malformed fades SHALL become needsConfiguration rather than guessed behavior. Evidence: `KNOB-082`, `KNOB-083`. Migration SHALL be idempotent and save only after user review.

#### Scenario: Legacy import

- **WHEN** a saved sound value contains one existing MP3 path
- **THEN** it becomes a one-track playlist in the same key

#### Scenario: Mixed or invalid files

- **WHEN** a playlist contains two valid MP3 files, a missing file and a directory
- **THEN** the two valid files retain their order and the invalid entries are listed with their status without directory traversal

#### Scenario: Unknown recovered numeric control

- **WHEN** imported sound files are valid but audioAction is 7, outside the recovered 0..6 mapping
- **THEN** the files appear in the migration preview, runnable playback stays disabled, and the user must choose a named operation

### Requirement: Shared per-key playback sessions

Desktop and key controls SHALL operate the same per-key playback session with play, pause, resume, stop, previous and next. Each session SHALL expose idle/loading/playing/paused/stopped/failed status keyed by playbackId and playlist revision. An explicit play control SHALL replace that key's current playback; recovered PLAY_ADD SHALL instead add an independently identified instance under the same key session; different keys SHALL remain independent until stopAudio stops all soundboard sessions. Pause/resume SHALL preserve position. Stop SHALL reset the position to the start of a track while remembering which playlist track was stopped, so a later PLAY_STOP or PLAY_RESTART resumes at that track's beginning.

#### Scenario: Key and UI control

- **WHEN** a key starts playback and the desktop pauses it
- **THEN** both controls show paused at the same position and resume continues that session

#### Scenario: Replace and stop all

- **WHEN** key A plays twice while B also plays, then stopAudio runs
- **THEN** A has only its newest session, B remains independent until stopAudio stops both

### Requirement: Track navigation

Track navigation SHALL preserve playlist order and start the target track at its beginning. Previous from the first track SHALL wrap to the last; next or natural end from the last SHALL wrap to the first. Natural end SHALL advance exactly once per playbackId and track generation, continuing indefinitely until stopped. The only exception is a PLAY_LOOP session, whose natural end repeats the current track (`KNOB-082`). Unavailable entries SHALL remain visible but be skipped by navigation with a search bounded to one playlist traversal; when all entries are unavailable the key session SHALL stop without another start. This copies the intended DK-Suite playlist behavior, not a bug. Evidence: `KNOB-086`; GAP-MAP cluster 18 and its copy-DK-Suite direction.

#### Scenario: End of playlist

- **WHEN** the last track ends
- **THEN** the session starts the first available track and continues in playlist order

#### Scenario: Boundary navigation

- **WHEN** previous is requested on the first track or next on the last
- **THEN** previous selects the last available track and next selects the first available track without out-of-range access

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

Loading SHALL fail after 10 s without player readiness. Rescan SHALL check only the configured list, publish per-entry availability, and SHALL NOT restart current playback. Navigation SHALL skip unavailable tracks as specified above; an explicit play of an unavailable file SHALL report file-unavailable. An all-unavailable playlist SHALL stop without acquiring output. Evidence for bounded skip/stop behavior: `KNOB-086`.

#### Scenario: File removed after configuration

- **WHEN** a configured file disappears before play
- **THEN** that key reports file-unavailable and no unrelated session stops

#### Scenario: Rescan after file removal

- **WHEN** an upcoming track is removed while the current decoded track plays
- **THEN** rescan marks it unavailable, current playback is not restarted, and navigation skips it with visible unavailable status and stops if no available track remains

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

### Requirement: Recovered audio operation and fade mapping

The importer and runtime SHALL use these recovered mappings. Evidence: `KNOB-082`, `KNOB-083`, `background.js` constants at character offset 5948, and `AudioPlayer.vue:33-140`.

| audioAction | Named operation | Behavior |
| --- | --- | --- |
| 0 | PLAY_STOP | Toggle stop/play; stop remembers the track index (not the position), and play starts that track from its beginning |
| 1 | PLAY_ADD | Start another independent playback instance |
| 2 | PLAY_RESTART | Restart the current track, or start the last stopped track |
| 3 | PLAY_LOOP | Toggle playback of the current track on repeat: while it plays, its natural end restarts the same track instead of advancing |
| 4 | STOP_ALL | Stop all soundboard playback |
| 5 | PLAY_PREV | Select previous track, wrapping |
| 6 | PLAY_NEXT | Select next track, wrapping |

`audioFade` SHALL decode the string `"<type>-<ms>"`: type `0` none, `1` fade-in from zero to configured volume, `2` fade-out to zero, `3` fade-out if already playing or fade-in otherwise. Duration SHALL retain the existing 0..10,000 ms bound. Stop/restart actions with an applicable fade-out SHALL wait for its completion, except immediate voice-capture preemption. New commands SHALL retain the existing cancellation and stale-callback protections.

#### Scenario: Recognized legacy controls

- **WHEN** import contains audioAction `6` and audioFade `3-500`
- **THEN** it decodes to PLAY_NEXT with a 500 ms in-out fade and does not require the user to guess numeric meanings

#### Scenario: Add independent playback

- **WHEN** PLAY_ADD arrives twice for one key
- **THEN** both instances may play, each has its own playback identity, and STOP_ALL stops both

#### Scenario: All playlist files unavailable

- **WHEN** natural end occurs and no playlist entry is available
- **THEN** the session stops after at most one traversal without an endless retry loop

### Requirement: Cluster 18 local key execution

Committed local playAudio and playAudioLegacy keys SHALL execute on a guarded release through the existing SoundboardService, sharing production speech AudioOutput. Key press and long-press SHALL NOT start playback. The exact recovered operations SHALL be 0 PLAY_STOP, 1 PLAY_ADD, 2 PLAY_RESTART, 3 PLAY_LOOP, 4 STOP_ALL, 5 PLAY_PREV, 6 PLAY_NEXT. Fade strings SHALL encode `<type>-<ms>` with 0 none, 1 in, 2 out, 3 in-out. Existing bounded linear ramps and cancellation SHALL apply. Playlists SHALL wrap indefinitely, including previous/next, skipping unavailable files within one traversal and stopping when none remain. This covers `KNOB-082/083/086`.

#### Scenario: A recovered local action

- **WHEN** a configured local key is pressed and released
- **THEN** press opens no player and release decodes and executes the recovered operation and fade through the existing owner

#### Scenario: Profile or page deactivation

- **WHEN** a different profile or page commits through key-library selection, KeyRuntime navigation, or automatic/manager switching, or its device disconnects
- **THEN** that device's active and pending sessions stop without fading and other devices keep playing
- **AND** a repeated selection, failed delivery/write, or invalidated transaction leaves current playback intact

Selection cleanup SHALL run after durable publication under the same repository transaction lock, never in the fallible delivery port. This follows `KNOB-086`'s device/key/multi-action session ownership and the recovered lifecycle. Evidence: `~/dev/dark-encyclopedia/dk-suite-introspeccion/v0.4.95/app-resources/background.js:2`, `Dn` at character 988931 keys sessions by serial plus keyCode/multiActionIndex; `Wi` at characters 1032317..1033459 destroys non-timer players and calls `bn` to clear that device's sessions. Both profile switching `Yi` and page/folder switching `$i` call `Wi`, with `$i` at character 1043825 returning early for an unchanged page. Therefore DK-Suite stops soundboard audio on both profile and page changes; timer-player preservation is outside soundboard scope.

#### Scenario: Selection cleanup failure or timeout

- **WHEN** owned playback reset rejects or exceeds five seconds after a durable profile/page commit
- **THEN** the commit still succeeds, a catalog-coded warning with scrubbed diagnostics records failure or timeout, later device cleanup proceeds and repository operations can continue
