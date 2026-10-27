# Spec Delta

## Purpose

Meeting capture and browsable history are recovered, but capture, processing, and export failure behavior needs an explicit contract. Users must retain their transcript when minutes generation fails.

## ADDED Requirements

### Requirement: Explicit capture lifecycle

Evidence: AI-262, AI-267, AI-280, AI-289, AI-293.

The system SHALL start meeting capture only from an explicit desktop or configured device action, require microphone permission, and expose idle, recording, finalizing, transcribing, generating, completed, cancelled and failed states. At most one main capture session SHALL be active; side records share its sources.

#### Scenario: Start twice

- **WHEN** a repeated Start arrives within its cooldown while a capture session is recording
- **THEN** the existing session continues and the second request reports already-recording without opening another microphone stream

#### Scenario: Microphone denied

- **WHEN** the OS denies microphone access
- **THEN** the session fails before recording and all partially acquired resources are released

### Requirement: Audio source selection and cleanup

Evidence: AI-281-284, AI-288, AI-292, AI-294.

The recorder SHALL capture the selected microphone and optional explicitly selected system audio, identify unavailable optional audio, and stop all owned tracks on stop, cancel, device loss or shutdown.

#### Scenario: System audio unavailable

- **WHEN** microphone capture is available but requested system audio cannot be acquired
- **THEN** the user sees the missing source and chooses microphone-only capture or cancels before recording begins

#### Scenario: Microphone removed

- **WHEN** the selected microphone is disconnected during recording
- **THEN** capture finalizes usable audio, reports source loss and stops owned tracks instead of silently changing microphones

### Requirement: Finalization and processing

Evidence: AI-268-275, AI-288-294.

Stopping capture SHALL finalize each audio chunk once before transcription. Processing SHALL store transcript and generated minutes separately, label minutes as generated, and preserve completed transcript data if generation fails.

#### Scenario: Duplicate stop

- **WHEN** two stop requests arrive during finalization
- **THEN** the in-progress finalization is reported and no chunk is finalized or transcribed twice

#### Scenario: Summary generation fails

- **WHEN** transcription succeeds and the minutes provider fails
- **THEN** history retains the transcript, identifies generation failure and allows a generation-only retry

### Requirement: Durable meeting history

Evidence: AI-266, AI-295-317, SETTINGS-105-107.

History SHALL list local meeting ID, title, capture time/duration and stage status, open available transcripts/minutes, and preserve finalized source audio until explicit deletion. Restart SHALL mark interrupted work recoverable rather than completed.

#### Scenario: Restart during generation

- **WHEN** the application restarts after saving a transcript but before generation completes
- **THEN** the transcript remains readable and the meeting shows interrupted generation with a retry action

#### Scenario: Delete meeting

- **WHEN** the user confirms deletion of a meeting
- **THEN** active processing is cancelled and its local record/audio/transcript/minutes are deleted, with partial deletion failure reported

### Requirement: Markdown and plain-text export

The system SHALL export available generated minutes as raw UTF-8 Markdown to `<safe-title>-summary.md` and a transcript as UTF-8 plain text to `<safe-title>-transcript.txt`, using a user-selected destination. Filename characters `\ / : * ? " < > |` SHALL become `-`. The system SHALL report file errors without damaging history. Evidence: `AI-315`.

#### Scenario: Export generated minutes

- **WHEN** a completed meeting's minutes are exported
- **THEN** the `.md` file contains the saved Markdown without HTML or document conversion and its sanitized filename ends in `-summary.md`

#### Scenario: Export transcript

- **WHEN** the transcript tab is exported for a meeting titled `Review/Plan`
- **THEN** `Review-Plan-transcript.txt` contains the plain transcript in UTF-8

#### Scenario: Cancel or fail export

- **WHEN** the user cancels the save dialog or the chosen file cannot be written
- **THEN** cancellation makes no file, write failure reports an error, and the stored meeting remains unchanged

### Requirement: Privacy and retry behavior

Evidence: AI-269-279, AI-291.

The system SHALL send audio/text only to the provider explicitly configured for that stage, keep content and credentials out of diagnostics, and avoid retrying capture or duplicating a saved meeting when a processing retry is requested.

#### Scenario: Generation retry

- **WHEN** a user retries generation for a saved transcript
- **THEN** the provider receives that transcript once and no new microphone session or meeting ID is created

#### Scenario: Cancel capture

- **WHEN** a user cancels while recording
- **THEN** capture stops, transient buffers are removed and no processing provider is called

### Requirement: Shipped live translation route

The system SHALL expose the Meet AI live translation toggle and display, require explicit system-audio capture and language/provider configuration through `voice-stt-tts`, and stop translation when the meeting ends. The commented-out key-library entries SHALL NOT disable the shipped profile route. Translation display history SHALL be bounded rather than copying DK-Suite's unbounded-text bug. Evidence: `AI-136`, `AI-292`, `AI-327`, `AI-338`.

#### Scenario: Meet AI translation is available

- **WHEN** the user selects the shipped Meet AI profile and explicitly starts translation with an available configured adapter
- **THEN** translation starts despite the library entries being commented out, and meeting end releases the translation capture


### Requirement: MeetAI registered controls

The strip registry SHALL render meetingMinutes, tempMeetingMinutes, meetingRecordMark,
liveAudioTranslate, liveAudioTranslateDisplay and meeting-profile mic tiles under
`strip/tiles/meeting/`. The profile catalog is owned by the profiles lane.
Start SHALL show the persisted HH:MM:SS timer updated every 100 ms while recording.
Start, Record, Mark and Translate SHALL enforce independent 5000 ms cooldowns,
with a clockwise black 50% sweep from 12 o'clock. Record and Mark require a running
main meeting. Mic SHALL use the authoritative hardware state, without optimistic toggling.
Evidence: AI-263-265, AI-297, AI-318-328, WIDGETS-097-098.

#### Scenario: Rapid Start and processing presses

- **WHEN** Start is pressed again within 5000 ms or while processing
- **THEN** no duplicate capture opens and processing reports "Meeting minutes is being processed"

#### Scenario: Side record and mark

- **WHEN** Record and Mark are activated during main capture, then main capture stops
- **THEN** side audio is finalized without closing shared tracks early, marks have ordered start/end offsets, and both controls deactivate

### Requirement: Meeting provider contract

The existing AI facade SHALL expose injected meeting ASR and translation adapters, explicitly
configured profile/model/language, async task submit/poll/cancel, speaker timestamps and timeout.
DashScope defaults SHALL be qwen-audio-3.0-asr-flash-filetrans, channel [0], diarization true,
10000 ms poll, 48 h expiry and max(180000, durationMs * 1.5 + 120000) timeout.
OpenAI defaults SHALL be gpt-realtime-mini with timeout clamp(180000,
durationMs * 0.5 + 180000, 1800000). Summary generation SHALL use the existing text facade,
explicit minutes model and language, never a vendor gateway or implicit sidecar.
Tests SHALL use fakes without paid calls. Evidence: AI-269-274, AI-292, AI-294.

#### Scenario: ASR pending then complete

- **WHEN** the configured adapter returns a pending task and then completed speaker segments
- **THEN** polling waits 10000 ms on the Effect clock, transcript persists before summary generation, and stop/cancel/timeout cancels the remote task

### Requirement: Saved summary templates

The system SHALL offer exactly project-weekly, standard, executive and interview with the
recovered labels/section instructions, default project-weekly. Selecting a template SHALL
leave the existing summary unchanged until regeneration succeeds. Regeneration SHALL save
summary, applied template and provider provenance atomically. Evidence: AI-275, AI-277,
AI-296, AI-308, AI-312, SETTINGS-106. This intentionally fixes AI-277.

#### Scenario: Regenerate then restart

- **WHEN** a user regenerates a saved transcript with executive and restarts
- **THEN** history displays the regenerated saved summary and executive template without recapture or ASR

### Requirement: History task workspace

History SHALL offer In progress and Meeting records tabs, literal case-insensitive search,
summary/transcript tabs, copy, title edit, confirmed cascading deletion, per-task Audio and upload,
Live transcript and AI Summary states and retry actions, and the four-template picker.
Layout SHALL use minmax(196px,226px) minmax(470px,1fr) minmax(238px,272px),
with reachable inspector actions below the document at 980px. Generated text SHALL be escaped.
Marks SHALL highlight matching speaker segments using bounded offsets.
Evidence: AI-299-317, SETTINGS-105-107.

#### Scenario: Summary failure retains completed tasks

- **WHEN** summary fails after transcription
- **THEN** task health shows completed audio and transcript, failed summary, and a summary-only retry

### Requirement: Meeting viewer and animations

The viewer, defaulting to 5x2 with user-resizable spans, SHALL expose Main minutes, Temporary record and Live translation tabs,
a floating 344px/44px expanded/collapsed toolbar, dock toggle, copy, clear, font changes
by 2px within -10..20 per pane, 300px scrolling and 1200ms long-press top/bottom.
Temporary record SHALL switch between summary/transcript with a 100px swipe.
Recording, processing, failure and success animations SHALL consume authoritative state.
Success SHALL celebrate once for 5000ms using 35 fireworks only on the panel.
All animations SHALL respect reduced motion. Evidence: AI-329-341, WIDGETS-099-100.

#### Scenario: Bounded live translation

- **WHEN** interim and final translations stream beyond 200 paragraphs or 64000 characters
- **THEN** interim segments replace by ID, oldest content is removed, updates cap at 4000 characters,
  timeline holds eight slots at least 3000ms apart after two estimated lines (50 characters/line), and update speed shows idle after 5000ms


### Requirement: Meeting history consumer regressions

The history workspace SHALL preserve selection through newer and out-of-order snapshots,
show request failures without replacing committed records, and clear a failed rename's
pending edit after a successful save. Records SHALL be the default navigation mode;
In progress SHALL include recording and processing only. Empty lists, unmatched searches
and absent selection SHALL use the recovered English messages. The document SHALL expose
its title, local start time, HH:MM:SS duration, attendee placeholder and edit/delete/export
controls. Cancelling an edit SHALL not save. Evidence: AI-296, AI-299, AI-300, AI-303,
AI-304, AI-316.

#### Scenario: Mounted history updates and responsive actions

- **WHEN** a selected record receives a newer snapshot, an older response and a failed rename
- **THEN** the selected document keeps the newest committed data, displays the error, permits another save and cancels without writing
- **AND** desktop renders three columns and 980px/520px layouts keep the inspector and header controls visible, focusable and reachable by pointer

### Requirement: History content and independent retry regressions

Summary SHALL default when minutes exist, otherwise Transcript; empty Transcript SHALL be
disabled. Copy SHALL write exact raw minutes or timestamp/speaker/plain transcript text,
report no content without writing and report denied clipboard access. Transcript labels,
plain text and markup-like speaker/content strings SHALL render escaped. Processing,
failed and empty bodies SHALL retain completed transcript content and expose independent
retry. Invalid non-string speaker data SHALL be rejected at the snapshot boundary.
Evidence: AI-305, AI-306, AI-307, AI-309.

#### Scenario: Failed summary keeps usable transcript

- **WHEN** summary fails after completed transcription and Retry is clicked in history
- **THEN** the transcript remains readable and copyable, only the summary provider runs, and capture and ASR do not restart
- **AND** switching tabs shows their own content, empty copy writes nothing and clipboard rejection shows the recovered failure message

### Requirement: Durable template and title request regressions

All four templates SHALL send their recovered sections and English labels through the
real provider consumer. New meetings SHALL select project-weekly. A selected template
SHALL persist independently of the applied template until successful regeneration.
Renamed titles and selected/applied templates SHALL survive service restart.
Evidence: AI-275, AI-296.

#### Scenario: Each template reaches the provider and survives restart

- **WHEN** project-weekly, standard, executive or interview is selected and regenerated
- **THEN** the provider receives its fixed sections, persisted history records the applied template, and restart retains the saved title and template without recapturing audio

### Requirement: Shipped MeetAI control regression contract

The shipped MeetAI profile SHALL keep resource 1-1, meetingAssistantTheme with cell 236,
gap 4, edge 2, radius 24 and unitInnerGap 0.04. Its 1,1 viewer SHALL be 5x2, icon 0-80,
subtouch enabled, unlocked and targetLanguage zh. Start at 1,6 SHALL span 1x2 with icon
0-61 and generateReport true; Record 1,7 icon 0-99 and Mark 2,8 icon 0-99 SHALL have
empty actions; Mic 1,8 SHALL retain icons 0-59/0-100 and toggle 0/1; Translate 2,7 SHALL
retain icon 0-98 and targetLanguage zh. Every action key SHALL lock title/grid/icon/delete/
drag through the real editing owner. Evidence: AI-265, AI-318, MGMT-360, MGMT-365.

#### Scenario: Saved controls retain defaults and enforce locks

- **WHEN** the shipped profile is decoded, edited, moved or deleted
- **THEN** all six positions, spans, titles, icons and actions match these defaults, action-key protected edits fail, and the unlocked viewer remains editable
- **AND** pressing saved Mark opens/closes a bounded mark range, updates its counter and respects its independent five-second cooldown

### Requirement: Strip timing, translation and animation regressions

The mounted timer SHALL use capture-ready startedAt, tick every 100ms, cross the hour,
reset after stop and resume correctly after remount. Accepted Start/Record/Mark/Translate
SHALL draw clockwise black cooldown sweeps at 0/180/360 degrees over 0/2500/5000ms.
The main recording animation SHALL appear only in Main minutes. Success SHALL use 35
panel-only bursts until 5000ms after accepted completion, never restart that window on
remount or failed regeneration, and allow a fresh successful completion. OS and app reduced
motion SHALL disable recording/pulse/gears/fireworks/border animation and transitions while
keeping status text visible. The viewer SHALL scale its 1196x456 base inside its actual
box, accept alternate valid grid spans through the editing owner, keep Clear reachable, and clear only the selected pane without deleting saved
minutes. Selected target language and bounded live translation updates SHALL reach the
viewer. Evidence: AI-321, AI-322, AI-329, AI-332, AI-333, AI-334, MGMT-152, MGMT-360.

#### Scenario: Mounted strip clocks and pane interactions

- **WHEN** capture readiness is delayed, a meeting crosses an hour, controls cool down and translated content arrives
- **THEN** the timer, sweeps, active mark and selected translation pane follow authoritative snapshots without opening native capture
- **AND** clearing Main, Temporary or Live affects only that pane, renderer boxes keep Clear within the visible frame, and the editing owner saves alternate valid spans and retains collision and edit-lock checks

#### Scenario: Completion and reduced motion remain bounded

- **WHEN** success, remount, failed regeneration and a new accepted completion occur on panel and management views
- **THEN** only a fresh panel completion celebrates for its remaining five-second window
- **AND** OS/app reduced motion removes computed animations and transitions without hiding the current status


### Requirement: Recoverable recorder teardown and private files

Stop SHALL drain every affected main/side recorder before audio conversion, attempt all
recorders even if one fails, and retain failed source chunks for retry. Shutdown SHALL
keep chunk IPC available until final recorder writes drain and persist a finite end time.
Interrupted recordings without an end time SHALL recover duration from finalized audio
before ASR. Cascading deletion SHALL stage audio reversibly until history commits; restart
SHALL restore staged audio for retained records and collect committed deletions.
Capture permissions and IPC SHALL require the trusted app document and top-level frame,
revoking authority on navigation. Hidden capture windows SHALL be released when idle and
SHALL NOT prevent shutdown after user windows close. Standalone translation source loss
SHALL stop the provider and clear translating state. Audio, including ffmpeg outputs, and
export replacements SHALL use private files and reject paths escaping managed storage.
Evidence: AI-263-264, AI-280-294, AI-299-317, AI-338. These strengthen local privacy and recovery.

#### Scenario: Side conversion fails while stopping main

- **WHEN** a main meeting and side record stop and side conversion fails
- **THEN** all recorders and shared tracks have already stopped, main audio still finalizes,
  and the side failure retains chunks and its own retryable task status

#### Scenario: Quit before the first periodic audio chunk

- **WHEN** shutdown stops a recording shorter than ten seconds
- **THEN** final dataavailable chunks pass through IPC before handlers are removed and the
  record retains a finite end time for recovery

#### Scenario: Restart after an unclean exit

- **WHEN** retained audio belongs to a recording without endedAt
- **THEN** retry derives and saves a finite duration from finalized audio before provider
  submission, excluding application downtime

#### Scenario: Failed cascading deletion

- **WHEN** staging a child directory or saving history fails
- **THEN** retained records retain their audio, staged directories are restored immediately
  or on restart, and the error is reported without committing shortened history

#### Scenario: Capture renderer navigates or crashes

- **WHEN** the capture document navigates or its renderer crashes with only translation active
- **THEN** further media/IPC requests are denied and the translation provider stops with
  a source-loss notice

#### Scenario: Native MeetAI controls and manual processing

- **WHEN** native touch activates each shipped MeetAI action key whose profile omits touch-effect flags
- **THEN** each reaches its action once; a manually stopped recorded meeting exposes Generate
  minutes and processes saved audio without opening capture again

#### Scenario: Existing readable export and audio destination

- **WHEN** private meeting content replaces an existing readable file or audio conversion runs
- **THEN** resulting files are private from creation, managed audio never follows a directory
  symlink or traversal ID, and export replacement never follows a destination symlink

#### Scenario: Cancellation or deletion races source loss

- **WHEN** cancellation or cascading deletion overlaps recording finalization or a delayed source-loss callback
- **THEN** capture transitions serialize, each recording finalizes at most once, cancelled records remain cancelled and deleted records remain absent; shutdown still progresses without holding capture locks over provider calls

#### Scenario: Recording startup delay and unrelated failure

- **WHEN** recording capture waits for permission or fails while standalone translation is already active
- **THEN** successful recording timestamps exclude the startup wait and a failed recording request preserves the existing translation stream

#### Scenario: Cancelled native touch

- **WHEN** link loss or layout teardown cancels a held MeetAI key
- **THEN** the synthetic release clears visual state without dispatching a meeting action


### Requirement: Qualified system audio and deliberate fallback

Evidence: AI-111, AI-282, KNOB-056. Windows system capture SHALL use the trusted main-process desktop loopback grant and discard video tracks. macOS and Linux SHALL select an exact enumerated BlackHole or Monitor audio input with echo cancellation, noise suppression and automatic gain disabled. Missing input, denied access, empty audio streams and cancelled acquisition SHALL release partial resources and never capture default audio silently. The desktop SHALL offer explicit microphone-only retry or cancellation before recording. Meeting microphone choice SHALL share the speech identity and recovery contract in AI-247, AI-281, KNOB-049 and SETTINGS-019.

#### Scenario: Optional source unavailable
- **WHEN** Windows loopback has no audio or macOS/Linux has no named source or permission
- **THEN** all acquired tracks close, no recorder starts, and the user can deliberately retry microphone-only or cancel; an accepted retry persists systemAudio=false on the recording while retaining the configured preference for future meetings

### Requirement: User-directed macOS capture setup

Evidence: AI-283. Settings SHALL enumerate installed inputs without opening them, explain routing and permission prerequisites, and allow refresh or cancel. Installation SHALL require user action and consent. The app SHALL hand a signed BlackHole package to macOS Installer and report handoff errors without claiming installation succeeded. It SHALL never change audio routing automatically.

#### Scenario: Missing or installed virtual input
- **WHEN** the user opens setup help with no BlackHole input, then refreshes after manually installing one or cancels
- **THEN** help reports missing or available from fresh enumeration, a failed refresh reports unavailable, and cancel changes no capture or host setting


### Requirement: History activation and refresh feedback

Evidence: AI-301, AI-302, CENTER-106, SETTINGS-104. History SHALL refresh on mount, Management Center activation including reselect, and window focus or becoming visible. Literal trimmed case-insensitive title and formatted-time searches SHALL accept punctuation and Unicode without regular expressions. Refresh SHALL show busy feedback for at least 1000 ms and until the read finishes, retaining selection and reporting failures. Cards SHALL sort newest capture first with stable ID tie-breaking, distinguish all saved states and processing stages, show unknown duration when no finite end/transcript is available, and auto-select the newest only when no selection exists. Responsive layout SHALL keep document and inspector actions reachable.

#### Scenario: External history changes and delayed replies

- **WHEN** the meeting page is activated or reselected, or the window becomes visible with externally changed history
- **THEN** it reads history, retains the selected identity and pending edits, and ignores lower-revision replies

#### Scenario: Search and failed refresh

- **WHEN** the user searches Unicode, punctuation or formatted time and refreshes a selected record
- **THEN** matching is literal, empty and no-match states differ, refresh stays busy for at least one second, and failure leaves the selected document intact

### Requirement: Safe summary document and metadata

Evidence: AI-308, SETTINGS-105. Summaries SHALL render Markdown headings, tables, task lists and HTTP/HTTPS autolinks with the saved applied-template annotation. Provider HTML SHALL stay inert, unsafe link schemes SHALL be rejected, and images SHALL NOT fetch remote resources. Metadata SHALL show recorded attendee counts, otherwise attendees not recorded. Copy and export SHALL use the saved raw summary or plain transcript of the active tab.

#### Scenario: Generated Markdown contains hostile content

- **WHEN** a summary contains a heading, table, task list, autolink, raw script or unsafe URL
- **THEN** supported Markdown renders, HTML remains text, unsafe URLs cannot navigate, and raw content remains available for copy and export

### Requirement: Timed main-meeting mark details

Evidence: AI-310, AI-317. Main and side tags SHALL remain explicit. A present legacy numeric parent zero SHALL identify a side record. Marks SHALL render only for main meetings, with optional provider word timestamps highlighting strictly overlapping words, numbered begin/end bookmarks and selection toggles. Transcript segments without word timestamps SHALL retain paragraph highlighting and mark boundary lines. Open or legacy sentinel ends SHALL resolve to the finite recording/transcript duration, never a fabricated year. Tooltips SHALL show millisecond start/end and remain within 20 px of viewport edges with width at most 260 px.

#### Scenario: Word timing preserves saved transcript text
- **WHEN** AI-310 provider tokens omit punctuation, whitespace or part of the saved paragraph
- **THEN** the renderer preserves the complete saved text around aligned tokens and falls back to paragraph highlighting and numbered bookmarks if tokens cannot align or omit saved words

#### Scenario: Word boundary and open mark

- **WHEN** a main meeting mark begins exactly at a word's end or remains open
- **THEN** the touching word stays unmarked, strictly overlapping words highlight with numbered bookmarks, and the open end uses the finite available duration

#### Scenario: Side record contains legacy marks

- **WHEN** a side record, including one with parent zero, contains saved marks
- **THEN** its Temporary Record tag remains visible and no mark highlight or bookmark renders

### Requirement: Independent task actions and regeneration feedback

Evidence: AI-311, AI-312, SETTINGS-106. Audio, transcript and summary tasks SHALL show Complete, Processing, Needs attention or Pending independently. Completed actions SHALL reveal managed audio only after checking a real regular file under the managed UUID directory, or switch to the corresponding document tab. Missing audio SHALL report Audio file not found. Retry SHALL restart only unfinished processing, retain completed artifacts that still match their inputs, and show pending/failure feedback. Replacing a transcript SHALL atomically invalidate prior minutes, applied template and provenance, then regenerate minutes from the replacement. Regeneration SHALL show Regenerating with the selected template until the asynchronous job finishes, then Summary regenerated or Failed to regenerate summary. Stale pushes SHALL NOT clear pending work.

#### Scenario: Summary retry fails after completed audio and transcript

- **WHEN** the user retries only failed summary generation
- **THEN** completed audio/transcript remain readable, no microphone or transcription restarts, and a failed summary retains the prior saved summary and applied template

#### Scenario: Shutdown interrupts an audio retry conversion

- **WHEN** retrying failed or interrupted audio is interrupted before conversion finishes
- **THEN** the saved audio task becomes interrupted and remains retryable after restart, while completed transcript and summary artifacts remain intact

#### Scenario: Background job fails before its first processing save

- **WHEN** retry or regeneration is acknowledged but the first processing save fails and an asynchronous failure arrives before or after acknowledgement
- **THEN** pending feedback ends, failure is shown and retry/template controls are enabled even without a new processing attempt or changed artifacts; a prior identical failure or stale snapshot cannot finish a fresh request

#### Scenario: Transcription retry replaces the source of completed minutes

- **WHEN** failed transcription is retried on a meeting with completed minutes
- **THEN** the replacement transcript invalidates the old minutes and triggers generation from the new text; a generation failure leaves a failed summary that can retry without repeating transcription

#### Scenario: Missing managed audio

- **WHEN** View audio file targets an absent or symlinked file or directory
- **THEN** the operation reports Audio file not found and never reveals another location

### Requirement: Durable default summary template

Evidence: AI-312, SETTINGS-107. The four template choices SHALL persist a global meeting summary-template preference alongside the selected record choice, defaulting to project-weekly for legacy stores. New main and side recordings SHALL use that preference after restart. Selecting a template SHALL NOT modify existing summaries or their applied-template labels. Successful regeneration SHALL save summary, applied template and provenance atomically; failure SHALL preserve originals.

#### Scenario: Choose template then restart

- **WHEN** a user selects interview and restarts before starting another recording
- **THEN** new recordings use interview, while existing saved summaries and applied templates remain unchanged

### Requirement: Weighted title modal and neighbour deletion

Evidence: AI-313, AI-314, SETTINGS-108. Edit Meeting Title SHALL open a 400 px modal, remain open on outside clicks, show a live weighted counter out of 100, and support Enter, Save and Cancel. Each ASCII character SHALL weigh one and each non-ASCII Unicode code point two. UI and backend SHALL reject blank or overweight titles and preserve edits on save failure. Success SHALL show Meeting title updated successfully. Confirmed deletion SHALL select the surviving next visible record below, otherwise above, while cancellation or failure preserves selection. Cascade deletion SHALL skip removed side records when choosing the neighbour.

#### Scenario: Weighted title validation and retry

- **WHEN** a title contains 50 CJK characters, 51 CJK characters, blank text or a failed save
- **THEN** weight 100 saves, weight 102 and blank fail without mutation, failed edits remain retryable, and a successful trimmed title survives restart

#### Scenario: Delete middle or last meeting

- **WHEN** a selected record is confirmed deleted
- **THEN** selection moves below it or, when no survivor remains below, above it; failure keeps the dialog and original selection


### Requirement: Direct meeting provider composition

Evidence: AI-136, AI-137, AI-269, AI-270, AI-272, AI-327. Production registration SHALL compose AiMeetingAdapter with the existing saved model profiles, protected credential resolver and managed audio references. DashScope SHALL use matching qwen-audio-3.0-asr-flash-filetrans upload and submit models, private OSS form upload, mono channel zero with diarization, asynchronous task polling and cancellation, and at most three InternalError retries after 2, 4 and 6 seconds. OpenAI SHALL own a unique private PCM conversion per job, use gpt-realtime-mini with gpt-4o-transcribe input transcription and server VAD threshold 0.4, 800 ms prefix and 1000 ms silence, send frames of at most 30720 bytes after 500 ms startup, cap frame delays at 100 ms and budget long-file pacing within the transcription deadline, preserve speech segment timing, await all correlated final results for up to 10 seconds after EOF and release PCM/socket on all exits. Translation SHALL use explicit source auto and selected target language with qwen3.5-livetranslate-flash-realtime, bounded state and 500 ms reconnect. Device toggles, source loss and meeting end SHALL stop the same adapter.

#### Scenario: Saved profile drives a fake provider

- **WHEN** the production meeting registration processes managed audio with saved Qwen or OpenAI credentials against a fake transport
- **THEN** only that provider receives the normalized audio, model and channel plan, correlated speaker/time segments reach durable history, and cancellation closes owned resources without generating text

#### Scenario: Translation disconnect and cancellation

- **WHEN** translation disconnects during audio input or its owner stops
- **THEN** reconnect waits 500 ms, at most eight 300 ms PCM blocks remain pending, late results from a prior session cannot enter the display, and stop releases the socket and queued audio

### Requirement: Private recoverable meeting provider resources

Evidence: AI-266, AI-273, AI-276, AI-278, AI-279. Upload location, expiry, task identity, provider/profile identity and cleanup state SHALL persist privately per meeting, outside renderer snapshots. Retry SHALL resume a valid task, reupload an expired or rejected upload only from existing managed audio, and retain completed transcript on generation retry. Distinct catalog codes SHALL identify missing audio, expired and deleted audio, missing transcript and no valid speech. Successful transcription SHALL save private UTF-8 compatibility and raw provider artifacts, ordered by numeric timestamps; deletion SHALL remove them with the meeting. Provider file operations SHALL affect only locally owned remote identities, retain failed cleanup for retry, and never delete an arbitrary account file.

#### Scenario: Restart and expired resource

- **WHEN** a host restarts with a pending task or an expired upload
- **THEN** retry resumes the same task or replaces the expired upload, preserves the meeting identity, and missing local audio fails with a specific actionable code instead of an invented transcript

#### Scenario: Empty recognition and cleanup failure

- **WHEN** the provider returns no speech or a remote deletion fails
- **THEN** no transcript is fabricated, no-valid-speech is distinct from transport failure, failed remote cleanup remains durable, and another meeting's files cannot be deleted

#### Scenario: Cancellation and file cleanup both fail

- **WHEN** cancellation of a running provider task and deletion of its owned files both fail, then cleanup retries after the adapter restarts
- **THEN** the private failed-cleanup record retains the task and file identities, retry cancels that task before deleting its files, and a task already cancelled successfully is not cancelled again

#### Scenario: Processing completes during failed deletion

- **WHEN** deletion overlaps processing and the job completes or fails while remote cleanup later fails or times out
- **THEN** the retained processing record is durably cancelled before remote cleanup, its original recording end time survives, another meeting can start, and deletion can retry without a stale job restoring processing or completion

### Requirement: Continuous encoded capture and deterministic mixing

Evidence: AI-285, AI-286, AI-288, AI-294. Main and side records SHALL isolate mic_N.webm and system_N.webm under their own UUID directories, use audio/webm;codecs=opus and ten-second slices, and rotate hourly by starting replacement recorders before stopping old ones. Finalization SHALL concatenate numeric segment order, mix usable mic/system tracks at 48 kHz with longest duration and mono MP3 output, and use mic-only output for empty or unusable optional system tracks. Upload SHALL submit the mono artifact, reject failed conversion and clean private temporary files.

#### Scenario: Hour rollover and optional silent file

- **WHEN** an hour rolls over while both tracks record, or system audio is empty or unusable
- **THEN** new recorders run before old stop, both old final writes drain, unequal tracks retain the longer duration, numeric segments 2 and 10 stay ordered, and upload receives mono bytes

### Requirement: Rate-conformant bounded live result consumers

Evidence: AI-292, AI-338, SCREEN-110. Translation capture SHALL resample actual input rates to mono 24 kHz signed little-endian PCM in exact 7200-sample blocks without playback. Every mounted live display SHALL receive incremental correlated results and selected target language, render speaker/finality, scroll to new content and show idle update speed after five seconds. Stored display text SHALL remain bounded to 200 paragraphs and 64000 characters with at most eight timeline marks. Profile/reset isolation SHALL clear old session content.

#### Scenario: Two displays and rate conversion

- **WHEN** fake 44100 Hz or 48000 Hz audio drives translation and two registered displays receive interim then final results
- **THEN** each submitted block contains exactly 300 ms at 24 kHz, displays replace the same interim paragraph, show selected language and speaker, become idle after five seconds, and reset never restores previous profile text


### Requirement: Reviewed provider boundary safety

Evidence: AI-269, AI-270, AI-272, AI-278, AI-288, AI-292. Meeting provider IPC, resource URLs, finality, retries and ownership handoffs SHALL preserve the review-fix scenarios below without real-provider calls in automated tests.

#### Scenario: Review fixes preserve provider security and completed retry semantics

- **WHEN** AI-269 or AI-270 returns an untrusted upload or transcript location, or a renderer requests AI-278 file management
- **THEN** remote file IPC requires the management window main frame, upload policies are restricted to documented DashScope temporary OSS buckets, and transcript downloads reject private, loopback, link-local, metadata and arbitrary DNS destinations; a deliberately configured loopback provider is confined to its exact configured origin

#### Scenario: Review fixes preserve complete speech and owned resources

- **WHEN** AI-272 reaches EOF with an automatic VAD turn still pending, a long file is submitted, or a completed AI-269 transcription is explicitly retried
- **THEN** finality waits for the ordered VAD-disable acknowledgement and explicit flush, pacing leaves time within the ASR deadline, completed results are replaced in both providers, and pending DashScope tasks still recover after restart

#### Scenario: Review fixes prevent silent recording loss and remote leaks

- **WHEN** AI-288 system validation times out, conversion fails permanently, AI-278 ownership persistence fails after upload, or AI-292 translation reconnects
- **THEN** validation decodes at most a one-second sample and a timeout fails finalization instead of dropping the system track, conversion retries only transient host errors, failed ownership persistence triggers remote deletion with interruption deferred during the handoff, and reconnect clears undelivered old-session text

#### Scenario: LiveTranslate uses documented wire audio

- **WHEN** AI-136, AI-137 and AI-292 send a 300 ms capture block to qwen3.5-livetranslate-flash-realtime
- **THEN** the adapter SHALL resample the 7200 signed little-endian mono samples at 24 kHz into exactly 4800 samples at 16 kHz and declare input_audio_format pcm and sample_rate 16000 in session.update, as documented at https://www.alibabacloud.com/help/en/model-studio/live-translator-client-events

#### Scenario: Saved Qwen profiles use documented regional endpoints

- **WHEN** AI-269, AI-270 or AI-137 selects a saved Qwen endpoint
- **THEN** the adapter SHALL accept HTTPS dashscope.aliyuncs.com, dashscope-intl.aliyuncs.com and one valid workspace DNS label under cn-beijing.maas.aliyuncs.com or ap-southeast-1.maas.aliyuncs.com, reject other remote hosts and nondefault ports before transport, and retain explicitly configured loopback providers for offline use

#### Scenario: EOF replaces provisional VAD identity

- **WHEN** AI-272 reaches EOF during speech and the explicit commit uses the pending VAD ID or a different ID
- **THEN** only committed items SHALL require final transcripts or appear in saved segments; provisional speech timing SHALL survive into the committed segment and an unstopped segment SHALL end at the submitted audio duration

#### Scenario: Saved credential removal stops active transcription

- **WHEN** AI-272 is sending file audio or waiting in a blocked socket send and the saved credential is removed
- **THEN** the operation SHALL observe revocation of that credential generation, stop sending further audio, abort and close its owned socket, release private PCM and save no partial transcript

#### Scenario: Failed subtask invalidates rejected upload

- **WHEN** AI-269 or AI-270 reports FILE_DOWNLOAD_FAILED inside output.results even when the overall task is SUCCEEDED
- **THEN** the adapter SHALL clear the terminal task and durably expire the upload before returning failure, so a restarted retry reuploads managed audio with a new URL or reports expired audio when the local recording is missing

### Requirement: Post-review provider lifecycle integrity

The system SHALL let the duration-based ASR deadline bound conversion and recording uploads, keep conversion interruptible with partial-file cleanup, and stop uploading when its socket reader fails. Cleanup SHALL continue after an unsuccessful task cancellation while retaining failed file deletion for retry. Remote cleanup and file requests SHALL run outside the capture transition lock with bounded deadlines. File listing SHALL enumerate all pages while returning only locally owned IDs. Source recognition SHALL remain separate from translated output and generated-output language. Translation speakers SHALL follow source-to-response identity, and unrelated configuration changes SHALL preserve in-flight results. Explicit new ASR attempts SHALL reset internal retries without resetting recovered pending tasks. Renderer errors SHALL keep their message and code paired and provide actionable English feedback. Hourly recorder replacement SHALL start before predecessors stop. Evidence: AI-269-279, AI-285-294, AI-327-338; PR109 comments 4381197743, 4381197987, 4381198019, 4381198051, 4381198108, 4381406130, 4381406145, 4381406159, 4380486754, 4380486762, 4381197836, 4381197895, 4381197978, 4381198035, 4381198072, 4381197800.

#### Scenario: Slow conversion and upload remain cancellable

- **WHEN** a fake recording takes more than 120 seconds to convert or 30 seconds to upload within its duration-based ASR deadline
- **THEN** processing continues until that deadline, cancellation stops conversion and removes partial files, and a socket reader failure stops further PCM sends

#### Scenario: Cleanup and file listing preserve ownership and capture progress

- **WHEN** a running DashScope task rejects cancellation or owned files occur on later pages
- **THEN** cleanup still deletes owned files, listing returns every owned file, unrelated capture transitions remain available during provider requests, and file cleanup failures retain local records for retry

#### Scenario: Source and translated identities remain distinct

- **WHEN** generated output uses a different language from speech and the provider emits source recognition plus translated responses
- **THEN** ASR omits an unspecified source hint, only translated responses enter translation history, speaker labels follow source linkage, and unrelated configuration changes do not discard delivered translations

#### Scenario: Retry and renderer feedback start with current state

- **WHEN** an exhausted ASR attempt is explicitly retried or a coded renderer failure is cleared or replaced
- **THEN** the new attempt gets a fresh internal retry budget, recovered pending work retains its budget, stale error codes cannot replace new messages, and English failure messages explain the next action

#### Scenario: Recorder rollover assertion detects an audio gap

- **WHEN** hourly capture replaces recorders while main and side capture share microphone and system sources
- **THEN** at least five recorders remain recording before each predecessor stops, and the regression fails if predecessors stop before replacements start

### Requirement: Consented BlackHole installer handoff

AI-283 setup SHALL expose installation only on macOS. Main SHALL authenticate the management renderer, confirm the warning natively, accept only a BlackHole-named pkg selected by the user, and verify an Existential Audio Developer ID Installer signature before the native handoff. Mock mode SHALL never invoke installation.

#### Scenario: Driver installation warning
- **WHEN** a user considers installing BlackHole
- **THEN** setup explains driver installation, the administrator password request and Multi-Output Device routing and volume-control effects before explicit consent

#### Scenario: Cancellation and failed setup
- **WHEN** consent or package selection is cancelled, signature validation fails, or the Installer handoff fails
- **THEN** setup reports the outcome, permits retry, and never changes audio routing or claims successful capture
