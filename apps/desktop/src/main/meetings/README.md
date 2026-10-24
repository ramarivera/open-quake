# Meetings

MeetAI uses the shipped profiles catalog and registers its viewer, Start, Record,
Mark, Translate and Mic tiles under `renderer/src/strip/tiles/meeting/`. The
Meeting page provides local history, task health, four summary templates,
regeneration, marks, side records and Markdown/plain-text export.
All five shipped MeetAI action keys accept native touch even when their profile
omits `supportTouchEffect`. Saved manual recordings expose Generate minutes so
they can be processed after automatic generation was disabled.

Start/Record/Mark/Translate have independent five-second cooldowns. Repeated presses of an in-flight key are ignored; independent keys retain
their order. A side recorder shares its main capture's streams;
only the owner releases them. Capture uses the selected microphone plus explicitly
requested system audio. macOS microphone and screen-recording permissions are
checked before the relevant capture. Failed optional capture does not silently
fall back; choose microphone only in Audio sources and models and start again.

The renderer writes ten-second Opus WebM chunks, rotates recorders hourly, bounds
queued writes to 16 MiB and sends ordered chunks to main. Main uses an existing
`ffmpeg` executable to mix/resample to 48 kHz mono MP3 and concatenate hourly
segments. Set `OPEN_QUAKE_FFMPEG` to an explicit executable path if needed. No
installer or dependency is added. A failed finalization retains source chunks;
Retry finalizes them before ASR. A canceled recording removes transient files.
Stopping a main meeting drains every main/side recorder before any conversion.
A side conversion failure remains on that task while the main recording still
finalizes. Shutdown keeps chunk/PCM IPC and its quit veto until recorder writes
finish; concurrent disposal callers await the same cleanup. Idle capture hosts
are destroyed, and closing the last user window suspends any remaining capture.

History lives in `<userData>/meetings-v1/history.json`, with per-meeting audio
under `<uuid>/final_recording.mp3`. Writes stage and atomically rename before the
committed ref changes. Managed directories use mode 0700; JSON, chunks, converter
outputs and exports use mode 0600 where the filesystem supports Unix permissions.
Converter outputs become private before ffmpeg writes. Export replaces the
chosen directory entry with a private staged file, including existing readable
files and symlinks. Audio writes require UUID-contained directories and reject
symlinked directories or outputs. Corrupt history reports an error instead of
replacing it. Restart marks interrupted work recoverable.

Deleting a main record cancels its jobs and cascades to side records. Audio
directories move into `.deleting` before history commits, with rollback on a
staging or commit failure. Startup restores folders still referenced by history
and collects committed deletions. The repository holds its lock through each
uninterruptible disk/ref commit. Shutdown persists finite end times; older
interrupted records recover their duration from finalized audio before ASR.

A generated summary, applied template and provider/model/language provenance are
saved together. Failed regeneration preserves the previous summary. This fixes
DK-Suite's unsaved regeneration (`AI-277`). Generated text is escaped instead of
injected HTML (`AI-308/340`). Summary export is UTF-8 `.md`; transcript export is
UTF-8 `.txt` (`AI-315`). Export cancellation leaves history unchanged.

Translation uses 24 kHz mono signed-16 PCM in 300 ms frames, a bounded PCM queue,
and display limits of 200 paragraphs / 64,000 characters / 4,000 characters per
update (`AI-338`). Interim segments replace by ID; final segments are immutable.
The timeline keeps eight slots, with at least three seconds and two estimated
lines (50 characters/line) between marks. Clear affects the current display pane,
not saved meeting content. Main/temp/live tabs have independent font offsets.
Both OS reduced motion and the app's Reduce motion preference disable animation.
Capture media grants, replies, chunks and PCM require the exact trusted capture
document and top frame. Navigation/popups are blocked, and actual navigation
revokes capture. A renderer crash reports standalone translation loss and stops
the provider even when no meeting recorder is active.

## Provider integration boundary

`packages/edge/src/ai/meeting-adapter.ts` defines `AiMeetingAdapter` behind the
existing `AiProviderService`. The provider lane supplies submit/poll/cancel file
ASR and translate/stop PCM operations. `registerMeetings({ adapter })` injects the
port. Its `audioRef` is a meeting UUID: resolve the local finalized file under
`<userData>/meetings-v1/<uuid>/final_recording.mp3` in the composition root.
Credentials, upload policy and SDK types belong behind that port.

The facade supplies DashScope's `qwen-audio-3.0-asr-flash-filetrans`, channel `[0]`,
diarization, ten-second polling, 48-hour upload expiry and timeout
`max(180000, durationMs * 1.5 + 120000)`. OpenAI file realtime uses
`gpt-realtime-mini` and timeout `clamp(180000, durationMs * 0.5 + 180000, 1800000)`.
Summary generation uses the existing text facade and requires the explicitly
selected AI profile's model to match the minutes model. Language selection is
independent of UI locale. ASR/summary failures never log transcript or credentials.

Production does not yet supply a live meeting adapter. Missing translation fails
before acquiring audio; offline recording/history are available. Non-mock
configuration rejects fake ASR and deterministic summary models. Mock mode alone
installs fake meeting providers and bypasses all audio capture. The configuration
form accepts a provider-owned AI profile UUID/model; configuration applies to new
sessions in the running app, while each saved record retains its configuration.
Provider catalog/credential persistence remains owned by the provider lane.

Mic state comes from the existing hardware session via meeting snapshots. Panel
windows cannot use the management-only hardware channel. No optimistic local Mic
toggle is used. `AI-341` alert-tone call sites are commented out in recovered
0.4.95. At base `19d7240`, `ToneName` exposes start/end/error/busy/preview; it does
not expose the advertised MM_FIREWORK/MM_SUCCESS patterns. This lane invents no
hardware code or substitute tone.

## Verification

Run from the worktree root. All output goes to the lane scratch directory.
The native smoke requires already-installed `ffmpeg` and `ffprobe` and never
opens a microphone, display capture or QUAKE device.

```sh
export TMPDIR=/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/meetings
pnpm biome check packages apps
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @open-quake/desktop test:bundle
openspec validate --all --strict
pnpm --filter @open-quake/desktop exec electron-vite build --config src/main/meetings/smoke.config.ts
env -u ELECTRON_RUN_AS_NODE OPEN_QUAKE_MOCK_DEVICE=1 pnpm --filter @open-quake/desktop exec electron out/meetings-smoke/smoke.js "$TMPDIR"
```

Also run the documented [media smoke](../media/README.md), passing the same
scratch directory and mock environment. Both native smokes destroy their windows,
dispose runtimes and exit. Never run DK-Suite or open real hardware from a lane.

The native meetings smoke drives the real renderer/preload/main with the shipped
MeetAI profile: all five actions through native touch IPC, repeated Start,
manual processing, side record, mark, translation, native touch
font control, processing/success/failure, template regeneration/restart, native
save cancellation/error, independently compared exports, unauthorized documents,
and narrow/light/reduced-motion views. Synthetic sine WebM exercises real
mix/concat, finite duration recovery and private output permissions. `ffprobe`
confirms 48 kHz mono MP3 (`audio-finalization.json`).

Unit/property tests cover ASR TestClock polling/deadlines/cancel; retained
transcripts and summaries; persistence and deletion failures; source loss;
permission rejection before capture; unavailable translation before capture;
mic state; monotonic snapshot numbering; long finalization overlap; translation bounds;
real filesystem rollback/crash recovery and cancellation during committed
deletion; private export replacement and path rejection; exact-document capture
authority; hidden-host/translation crash cleanup; final-chunk and repeated-quit
shutdown races; fake MediaRecorder side ownership, hourly rotation, late
permission cancellation and missing-stop cleanup.

Native screenshots in the scratch directory:

- `meetings-idle.png`, `meetings-recording-side-mark.png`
- `meetings-manual-processing.png`
- `meetings-processing.png`, `meetings-success.png`, `meetings-failure.png`
- `meetings-live-translation.png`, `meetings-reduced-motion.png`
- `meetings-history-empty.png`, `meetings-history-summary.png`
- `meetings-history-transcript.png`, `meetings-task-failure.png`
- `meetings-history-narrow.png`, `meetings-history-light.png`

PR #31 review round 1 passed 915 tests (protocol 47, device 388, edge 44,
desktop 436), all six required gates, the meetings native smoke and the existing
media native smoke. Strict OpenSpec validation passed all 34 items. Gate and
smoke logs use the `round1-` prefix in the scratch directory.

Physical QUAKE/touch/Mic behavior, OS permission dialogs, actual system loopback,
hours of continuous real capture and live provider integrations remain
unverified. Follow-up: `open-quake-lih.16.1`; the parent parity cluster remains
open for that acceptance. Native mock screenshots do not close those checks.
