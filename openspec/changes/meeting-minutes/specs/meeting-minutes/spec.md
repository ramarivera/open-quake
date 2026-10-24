# Spec Delta

## Purpose

Meeting capture and browsable history are recovered, but capture, processing, and export failure behavior needs an explicit contract. Users must retain their transcript when minutes generation fails.

## ADDED Requirements

### Requirement: Explicit capture lifecycle

The system SHALL start meeting capture only from an explicit desktop or configured device action, require microphone permission, and expose idle, recording, finalizing, transcribing, generating, completed, cancelled and failed states. At most one user-visible capture session SHALL be active.

#### Scenario: Start twice

- **WHEN** a second start arrives while a capture session is recording
- **THEN** the existing session continues and the second request reports already-recording without opening another microphone stream

#### Scenario: Microphone denied

- **WHEN** the OS denies microphone access
- **THEN** the session fails before recording and all partially acquired resources are released

### Requirement: Audio source selection and cleanup

The recorder SHALL capture the selected microphone and optional explicitly selected system audio, identify unavailable optional audio, and stop all owned tracks on stop, cancel, device loss or shutdown.

#### Scenario: System audio unavailable

- **WHEN** microphone capture is available but requested system audio cannot be acquired
- **THEN** the user sees the missing source and chooses microphone-only capture or cancels before recording begins

#### Scenario: Microphone removed

- **WHEN** the selected microphone is disconnected during recording
- **THEN** capture finalizes usable audio, reports source loss and stops owned tracks instead of silently changing microphones

### Requirement: Finalization and processing

Stopping capture SHALL finalize each audio chunk once before transcription. Processing SHALL store transcript and generated minutes separately, label minutes as generated, and preserve completed transcript data if generation fails.

#### Scenario: Duplicate stop

- **WHEN** two stop requests arrive during finalization
- **THEN** the same finalization result is returned and no chunk is transcribed twice

#### Scenario: Summary generation fails

- **WHEN** transcription succeeds and the minutes provider fails
- **THEN** history retains the transcript, identifies generation failure and allows a generation-only retry

### Requirement: Durable meeting history

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
