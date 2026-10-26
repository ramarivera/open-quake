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
saved together. Failed regeneration preserves the previous summary when its
transcript is unchanged. A transcription retry clears minutes, applied template
and provenance when saving its replacement transcript, then generates from the new
text. If that generation fails, Retry reuses the saved transcript. Interrupted
audio conversion remains retryable after restart. Background job failures release
the inspector controls even if the initial processing save never succeeded. This fixes
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

## History documents

Search matches literal title text or the displayed recording time, ignoring case
and surrounding spaces. Refresh keeps the selected record and title draft, shows
feedback for at least one second, and reports read failures without clearing the
document. Activating or reselecting Meetings refreshes history too.

Summaries render Markdown headings, tables, checklists and HTTP(S) links. Provider
HTML stays inert and images show alt text without downloading. Copy and export
use saved source text. The task inspector opens the appropriate audio, transcript
or summary; missing managed audio reports `Audio file not found`. Retrying a failed
task preserves completed artifacts. Template choice persists as the default for
future recordings, while the current summary changes only after regeneration
succeeds. Regeneration reports progress, success or failure and retains old text
on failure.

Edit Meeting Title accepts up to 100 weighted characters. ASCII characters count
one and other Unicode code points count two. Enter or Save submits; Cancel
discards the draft. Failed saves keep it open. Confirmed deletion selects the
next surviving visible record below, otherwise above, skipping deleted children.
Timed words keep their original punctuation and spacing. Main-meeting mark
bookmarks toggle selection and show finite start/end times in tooltips; side
records don't inherit main-meeting marks. Attendance appears only when recorded
explicitly, since speaker diarization doesn't establish attendee count.

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
`gpt-realtime-mini` with `gpt-4o-transcribe` input transcription and timeout `clamp(180000, durationMs * 0.5 + 180000, 1800000)`.
Summary generation uses the existing text facade and requires the explicitly
selected AI profile's model to match the minutes model. Language selection is
independent of UI locale. ASR/summary failures never log transcript or credentials.

Production binds the direct meeting adapter to the selected saved Qwen/OpenAI model and the existing protected credential vault. Qwen uses private OSS upload and asynchronous filetrans; OpenAI uses the existing transcription socket protocol with per-job private PCM. Live translation requires a saved Qwen profile and explicit target language. Missing configuration fails before capture. Non-mock
configuration rejects fake ASR and deterministic summary models. Mock mode alone
installs fake meeting providers and bypasses all audio capture. The configuration
form accepts a provider-owned AI profile UUID/model; configuration applies to new
sessions in the running app, while each saved record retains its configuration.
Provider catalog/credential persistence remains owned by the existing provider module. Provider task/upload references and expiry live only in private per-meeting `provider-state.json`, never renderer snapshots. Compatibility `MM_Transcription.txt` and raw `MM_Transcription.txtoriginal.json` artifacts remain private until meeting deletion. They are not logs or exports. Temporary normalized MP3 and per-job PCM are deleted on every exit. Only locally owned remote file identities can be listed/deleted; failed cleanup blocks local deletion for explicit retry. The protected remoteFiles command uploads only the selected saved transcript, and is never called automatically.

Translation receives source auto and selected target language, resamples the internal 24 kHz mono PCM into documented pcm at 16 kHz in exact 300 ms wire blocks, bounds pending pushes to eight, reconnects after 500 ms, and clears results when profile/language changes. The renderer worklet resamples actual device rates. Hourly recorders start replacements before draining their predecessors. Empty or undecodable optional system tracks use the microphone-only conversion.

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

PR #31 integration review includes main `639924d7f6ca1e79f9b72dc14905502d9ae3f277`
and preserves the shared maintenance, voice, monitor and preload owners. Shared
writer shutdown now awaits meeting disposal before closing windows. Recovery
rounds fractional audio durations to integer milliseconds before history commit;
source-loss callbacks share the capture-transition semaphore. Deterministic
stalled-save tests cover main/side loss, explicit stop and suspend. The seven
new behavioral cases fail against the original implementation and pass with
the fix. Invalid durations still fail before provider submission.

Fresh verification: all six gates, 1291 tests (desktop 655, device 390, protocol
60, edge 186), strict OpenSpec 37/37, and sequential native meetings plus combined
media/profile/voice/monitor mock smokes. Both smokes register and await maintenance
and meetings owners. Retained synthetic audio measured 250.125 ms through FFmpeg;
retry over the production preload IPC submitted 250 ms once and saved a completed
integer end time. No microphone, live provider or hardware call was made.
Evidence and capture hashes: `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/meetings/review-round-1/`.
Turbo gates use `--env-mode=loose` so owned ExtSSD temporary paths and mock flags
reach child processes; workers remain bounded at two and Turbo concurrency at one.
The meetings smoke logs Chromium temporary-cache and macOS process-policy errors;
assertions pass. The combined smoke has no warning/error lines.

Cancellation and cascading deletion now share the capture-transition semaphore with
start/stop, source loss, suspend and recovery finalization. Delayed loss for absent,
cancelled, processing or completed records is ignored. Genuine loss queued behind
stop/suspend still reports on the affected main/side task. Provider results cannot
overwrite cancelled records or recreate deleted records. ASR and summary requests
run outside the capture lock; provider translation cleanup has a two-second deadline
so shutdown can progress. Recording timestamps are sampled after capture readiness,
excluding permission/window startup delays. A failed recording request preserves an
independent live translation. Cancelled native touch releases, including teardown,
clear pressed state without dispatching a MeetAI action.

PR #31 cancellation review proof: 1310 uncached tests, all six fresh gates with
`--env-mode=loose`, both bundle modes, 37/37 strict OpenSpec items and sequential
meetings/combined native mocks passed. The production request handler regression
allows a read while cancellation awaits final chunk IO, then proves delayed loss
cannot finalize cancelled audio or restore deleted history. New races cover both
orders, main/side records, recovery, ASR/summary completion and hung translation
cleanup. Native IPC confirms cancelled/deleted state, cancelled Start touch makes
no record, and fractional recovery still measures 250.125 ms and submits 250 ms
once. All 33 captures have SHA-256 hashes; four were inspected. Native meetings
logged four Chromium temporary-cache errors; assertions passed, combined smoke
logged no errors/warnings, and owned Electron/process groups were gone. Evidence:
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/meetings/review-round-2/`.
No physical, live-provider or packaged acceptance is closed by this round.


PR #98 single review fix round covers Devin 4378930331/4378930536 and Codex
4378948017/4378948029, each committed, pushed and answered separately. All four
findings have fail-before consumer regressions. Provider settings remain covered
by unit/consumer tests, with live acceptance under `open-quake-lih.16.1`.

The required root loose-environment test run passed 3,389 tests with four existing
skips, using two workers and SSD TMPDIR. Counts: protocol 63, device 508, edge 746
with three skips, desktop 2,072 with one skip. All six package typechecks, Biome
1,258 files with 14 existing warnings, production build, both bundle modes and
47 strict OpenSpec items pass. Hidden muted meetings and combined media native
smokes pass and exit, with 28 and 22 captures. The meetings fixture now honors
the strip's 600 ms post-touch click suppression before selecting a tab and waits
for the selected animation. The unchanged fixture failed before that correction.
Chromium cache/process-policy messages and combined-fixture missing-handler
messages remain in the logs; no console-clean claim is made. No microphone,
physical QUAKE, OS capture or paid-provider acceptance is closed.

Logs and captures remain external under
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/burndown/meeting-ui/fix1/`.
Review threads stay unresolved and merge/hosted-check ownership stays with the lead.


## meeting-provider fake-boundary acceptance

The direct adapter uses the saved default Qwen/OpenAI model profile and existing
credential vault. DashScope file operations use its compatible file API and only
locally recorded remote IDs. Upload/task expiry and raw/compatibility transcript
artifacts remain private under the managed meeting directory. Hourly capture
starts replacement recorders before draining old ones; optional unusable system
tracks fall back to microphone-only mixing. PCM resamples the actual input rate
to exact 300 ms / 24 kHz / s16le blocks. Adapter and display queues both cap text;
reconnects use a new result identity, and a final result ignores stale interim
updates.

All 18 meeting-provider rows have requirements and production consumer tests in
OpenSpec section 10. Local fake HTTP/WebSocket/SSE servers verify actual mono
uploads, saved model/vault selection, OpenAI file transcription with per-job PCM
cleanup, and the existing summary facade. No new dependency or second credential
store was added. After merging main `aab428f7`, the root suite passes 4,036 tests
with four existing skips, including 2,570 desktop tests. Six typechecks, Biome
1,388 files, production build, both bundle modes and 47 strict OpenSpec items pass.
Both hidden, muted native mock smokes pass; 28 meeting and 22 media captures,
including EN/DE, stay in the meeting-provider SSD scratch directory. Logs retain
Chromium cache/process-policy diagnostics and existing combined-fixture missing
profiles/connections/knob handlers; this isn't a console-clean claim.

Physical acceptance remains open for AI-285, AI-286, AI-288, AI-292, AI-294,
AI-327, AI-338 and SCREEN-110; paid-provider qualification remains unverified for
AI-136, AI-137, AI-269, AI-270, AI-272 and AI-278. No microphone, system capture,
physical device or paid request is part of this evidence. Beads
open-quake-lih.16.9 through .12 stay open for lead merge.


## PR #109 provider review fixes

Credential-backed remote file IPC requires the management window main frame.
Task-supplied transcript URLs stay on HTTPS Alibaba OSS; upload policies also
require the documented `dashscope-file-*` temporary bucket namespace. An
explicitly configured HTTP loopback provider can use only its own exact origin.
Redirects remain disabled. These restrictions apply before audio acquisition or
HTTP transport.

OpenAI file EOF disables server VAD, waits for the ordered session update and
then commits the remaining audio. Completion waits for every committed item;
empty-flush errors must identify our explicit commit. Frame delays remain capped
at 100 ms but scale down for long files to reserve server processing time within
the existing deadline. A new transcription attempt replaces completed speech in
both providers, while pending DashScope task IDs still recover after restart.

System-track validation decodes a one-second sample. Timeout or host failure
fails finalization instead of silently removing remote participants. Only
transient OS contention retries conversion. An accepted transcript upload is
deleted if its ownership save fails, and interruption waits for the handoff.
Translation disconnect clears undelivered text before reconnecting.

The single fix round has fail-before regressions for every code change. The root
suite passes 4,097 tests with four existing skips, including 2,604 desktop and
916 edge tests. Six package typechecks, Biome 1,403 files, build, both bundle
modes, 11 release-script tests and 47 strict OpenSpec items pass. Hidden muted
meetings smoke passes and exits with 28 captures. Its Chromium cache and
process-policy diagnostics remain visible in the external log. All 11 original
threads are answered and remain unresolved. Hosted CI/current-head review,
physical audio and paid-provider qualification remain lead-owned.

Evidence: `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/burndown/meeting-provider/fix1/`.

## PR #109 final provider review fixes

The default LiveTranslate session uses the provider-documented `pcm` format
and 16 kHz sample rate. The adapter resamples each internal 7200-sample 24 kHz
block into exactly 4800 signed little-endian wire samples. The regression checks
the session payload and every sample of two nonzero blocks. Contract source:
https://www.alibabacloud.com/help/en/model-studio/live-translator-client-events.

Saved Qwen profiles accept the documented Beijing/Singapore workspace domains
and both legacy hosts. A workspace is one valid DNS label; private, metadata,
arbitrary, suffix-spoofed, malformed and nondefault-port remote destinations
remain rejected. Configured offline loopback providers stay supported. Source:
https://www.alibabacloud.com/help/en/model-studio/fun-asr-recorded-speech-recognition-http-api.

OpenAI EOF tracks provisional VAD timing separately from committed items, so
a manual commit with a replacement ID cannot block finality. Removing the saved
credential races the complete PCM/socket operation against that exact credential
generation's revocation. Regressions use the real CredentialVault with fake
keychain/socket backends during paced and blocked sends, and assert socket abort,
cleanup and no partial artifacts. DashScope task and subtask failures share durable
upload invalidation; restarted retries replace rejected URLs or report expired
audio when the managed recording is missing.

All five findings have regressions observed failing before their fixes, and each
fix was committed, pushed and answered separately. Current main `31c400cc` was
merged first in `ff20d0f9`, preserving both sides. The exact root loose-environment
suite passes 4162 tests with four existing skips across 422 passing files and two
skipped files. Counts are protocol 63, device 515, edge 921 and desktop 2663.
All six package typechecks, Biome 1415 files with zero errors, 14 existing warnings
and one info, production build, both bundle modes and all 47 strict OpenSpec
items pass. The hidden, muted meetings mock smoke passes and exits with 28
captures. Chromium cache and macOS process-policy diagnostics remain in its log.

Execution is tracked in open-quake-lih.16.13, left open for lead merge. Evidence
and screenshots stay outside the repository under
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/burndown/meeting-provider/fix2/`.
No real device, microphone, paid provider or audible output was used. No further
review round, thread resolution or merge is part of this final fix round.

The supplemental combined media smoke reached its wallpaper and OBS passes but
failed the German local-player label. Its fixture writes the retired
`open-quake-key-locale` storage key, while merged main reads the document locale.
The assertion remains unchanged; this failure is tracked in open-quake-lih.16.14.
That same follow-up records valid new bot findings 4380486754 and 4380486762 for
size-appropriate OSS upload deadlines and interruptible conversion acquisition.
Both receive follow-up replies without another fix round.
