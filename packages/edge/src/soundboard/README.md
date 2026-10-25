# Local sound configuration import

`SoundboardImporter.preview` is a read-only migration preview. It accepts a saved
`playAudio` key's `{ type, actions }`, the equivalent `{ sound, audioAction,
audioFade, volume }`, or a version-1 preview to inspect again. It never saves
configuration, starts a player, changes volume, or acquires the shared AudioOutput
lease. Soundboard execution remains unavailable in the first release.

Compose `SoundboardImporter.Default` with the `SoundboardFiles` metadata port.
The desktop's `SoundboardFilesLive` uses only stat/access on explicit local paths,
not directory traversal or audio decoding. No IO occurs during layer acquisition.
A preview marked `ready` means configuration and file metadata are valid, not
that the file can be decoded or playback is enabled. Saving remains an explicit
review step owned by the profile configuration flow.

The importer preserves playlist order and duplicate selections. Every entry has
an index-scoped opaque file ID and an availability status. File paths are private
configuration data and must never go into diagnostics. JSON syntax/shape and
size errors fail with `QUAKE.AUDIO.CONFIG_INVALID`. Unknown numeric operations,
malformed fades, invalid volume, empty playlists and unsafe paths produce
`needsConfiguration`, without guessing or clamping controls. Mixed available and
unavailable playlists retain all entries; no available files requires configuration.
`STOP_ALL` does not need a file.

Only absolute local POSIX or Windows drive paths are accepted. URLs, UNC/network
shares, device paths, relative paths and control characters are never probed.
The host adapter rejects paths belonging to a different OS. Limits are 1,024
entries, 32,768 characters per path and 1 MiB of path data. Four metadata probes
may run concurrently, each with a two-second Effect deadline. An inspection
failure becomes an `unreadable` entry, with its original cause retained privately
and a catalog warning/span emitted before handling it. Re-import rechecks
availability instead of trusting saved statuses. Migration is stable under
unchanged observations.

Playback service, managed-file import/copy, 10-second player readiness, fades,
shared speech preemption, player controls, native audio and physical key
acceptance remain in the other `soundboard-player` tasks.
