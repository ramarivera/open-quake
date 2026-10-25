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

## Gated playback implementation

`SoundboardService.Default` declares its runtime repository dependency. At an
application root, provide `SoundboardPlayer`, `SoundboardFiles` and the same
`AudioOutput` instance that production speech/capture uses. Never create a
second output owner for soundboard. Keep the service's Layer alive until its
consumer finishes; acquiring a scoped service and returning it from a locally
provided Layer closes it before the caller can use it.

The current methods are `play`, `stop`, `stopAll`, `naturalEnd`, `snapshot` and
idempotent awaited `close`. Explicit play replaces that key's instances;
`additional: true` creates an independent instance. Track generations reject
stale or duplicate completion, playlists wrap, and `loopTrack` repeats the
current track. Navigation probes at most one traversal and stops if every
entry is unavailable. Explicit play checks its remembered target before stopping
valid playback. Acquisition, readiness and start share one ten-second deadline.

The repository retains at most 256 terminal observations alongside 128 active
instances. Callers receive detached snapshots with opaque IDs/statuses, never
paths. A group owns one output lease. Capture/speech invalidates it before
awaiting every native resource, including pending readiness. Stop cancels loading
immediately, concurrent teardown waits for the same cleanup, and stale release
can't stop replacement speech. A two-second teardown failure makes the shared
output owner refuse future acquisition until restart.

Desktop `SoundboardPlayerLive` uses an invisible sandboxed HTML media worker
with no Node or microphone access. Each session permits only its own page and
the explicitly selected local MP3 URL. Gain is local to that media element.
Its scope closes the window/private directory, including interrupted and late
acquisition. Native decode failures retain their original cause privately.

These modules aren't composed into the production root or exposed through key,
IPC or UI controls. Imported soundboard keys remain unavailable. Non-`none`
fades are rejected until task 2.2 implements ramps. Service pause/resume,
explicit previous/next, rescan, profile deactivation, managed-file import/copy,
UI/key integration, audible output and physical-trigger acceptance remain open.
