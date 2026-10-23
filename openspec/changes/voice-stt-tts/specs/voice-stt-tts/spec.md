# Voice STT and TTS

## Purpose

Provide independent recognition and synthesis with correlated capture, bounded provider protocols, and truthful playback completion.

## ADDED Requirements

### Requirement: Independent speech adapters

The system SHALL expose STT and TTS through injected Effect services with independent profile selection, typed events/errors, Config, named spans, and mock-default tests. First release SHALL provide BYO-key DashScope STT and HTTP/SSE TTS without a DecoKee account or region lookup. Unsupported speech transports SHALL remain unavailable until conformance verification, even if chat supports the same provider.

#### Scenario: Text chat works without TTS
- **WHEN** the selected TTS profile is missing or synthesis fails
- **THEN** the generated text remains readable and normal chat continues without selecting another speech provider silently

### Requirement: Capture phase machine and bounded waits

Capture SHALL expose idle, requesting_permission, requesting_session, connecting, configuring, starting_recorder, listening, stopping, processing, and completed/empty/failed/cancelled terminals, skipping inapplicable phases explicitly. Permission wait SHALL be at most 30s, session-acquisition/connect/configure/recorder-start each at most 10s, and stop-to-final at most 15s. Listening SHALL automatically stop and finalize at 60s under the same nonempty/empty rules as user stop. Setup/final-result timeout SHALL identify its phase through `VOICE.CAPTURE.PHASE_TIMEOUT` and release owned resources.

#### Scenario: Configuration acknowledgement absent
- **WHEN** a configured speech connection receives no readiness acknowledgement for 10s
- **THEN** capture fails in configuring, closes the connection, and never starts the mic

### Requirement: Early stop and empty capture

Release/cancel SHALL latch before every awaited setup operation. A late mic grant, provider acknowledgement, or recorder start after cancellation SHALL be cleaned up immediately. Empty PCM SHALL NOT be committed to a provider, and empty final text SHALL NOT be submitted to chat. Cancelled, empty, permission-denied, and provider-failed outcomes SHALL remain distinguishable.

#### Scenario: Release while permission prompt is open
- **WHEN** the user releases before permission resolves and later grants mic access
- **THEN** capture remains cancelled, closes the granted tracks, and sends neither PCM nor a chat request

### Requirement: PCM framing and bounded flow

First-release capture SHALL deliver mono signed 16-bit little-endian headerless PCM at 24,000Hz, resampling actual input as needed. Normal frames SHALL contain 20ms/960 bytes; an aligned shorter final frame is allowed. Internal frames SHALL carry captureId and monotonic seq. Audio SHALL wait for provider readiness, and queued PCM SHALL not exceed five seconds. Overflow SHALL fail explicitly without silent frame loss.

#### Scenario: Browser input is 48kHz
- **WHEN** the recorder produces 48kHz audio for a 24kHz STT task
- **THEN** the adapter resamples it and sends frames whose descriptor and sample count both match 24kHz

#### Scenario: Sender cannot drain
- **WHEN** the queued PCM exceeds five seconds
- **THEN** capture fails with `VOICE.CAPTURE.BUFFER_OVERFLOW`, releases the mic/socket, and sends no transcript to chat

### Requirement: DashScope realtime recognition protocol

The DashScope STT adapter SHALL send one run-task on an authenticated inference WebSocket with a unique task ID, streaming duplex, audio/asr/recognition, explicit model, pcm format, and sample rate. It SHALL await matching task-started before binary PCM, send one finish-task after the final nonempty frame, and finish only on matching task-finished. Task-failed, premature close, malformed frames, and deadline SHALL yield one failed terminal outcome. Provisional text SHALL replace provisional text; finalized segments SHALL appear once under a verified segment/finality rule.

#### Scenario: Provisional sentence revised
- **WHEN** one segment produces provisional `turn`, provisional `turn left`, then final `turn left`
- **THEN** the final transcript contains `turn left` once and no chat request is made before task-finished

#### Scenario: Late task-started from cancelled capture
- **WHEN** a cancelled task receives task-started after another capture begins
- **THEN** its socket closes and it cannot start recording or finish the newer capture

### Requirement: DashScope HTTP synthesis protocol

First-release TTS SHALL use the configured HTTP multimodal-generation endpoint with explicit model/text/voice and SSE enabled. It SHALL parse complete SSE records across fragmented input, decode output.audio.data in order, and require a verified codec/rate/channel descriptor before playback. Unknown audio format SHALL fail with `VOICE.TTS.FORMAT_UNSUPPORTED`. Truncated records or provider errors SHALL not become successful synthesis.

#### Scenario: SSE record split across chunks
- **WHEN** a JSON/base64 audio record is divided across several network chunks
- **THEN** it is decoded exactly once after the complete record arrives and produces no duplicate audio

### Requirement: Ordered synthesis and playback completion

TTS SHALL distinguish idle, synthesizing, playing, and completed/failed/cancelled. Utterances SHALL be serialized per turn and flush at punctuation, 200 characters, or two seconds of pending text. Pending text SHALL be bounded to 4,000 characters. Queue overflow SHALL cancel the speech remainder with `VOICE.TTS.QUEUE_FULL` while text continues. Provider completion SHALL NOT imply playback completion; completed SHALL require natural output drain.

#### Scenario: Provider finishes before audio drains
- **WHEN** synthesis finishes while the last audio frame is still playing
- **THEN** the utterance remains playing and completes only after the matching natural-end event

#### Scenario: Stop while audio is queued
- **WHEN** the turn is cancelled during playback
- **THEN** the player stops, unsaid text/audio is discarded, and late natural-end/provider events cannot report completed

### Requirement: Playback deadlines and output arbitration

Player readiness SHALL time out after 10s, synthesis after 30s per utterance, and playback after declared duration plus 10s with a 120s hard cap. AudioOutput SHALL grant one output lease and SHALL suspend output before voice capture begins. Capture completion SHALL NOT automatically resume suspended soundboard or assistant audio.

#### Scenario: Player never signals ready
- **WHEN** synthesized audio waits 10s without a player-ready event
- **THEN** the utterance fails, its queued audio is released, and the chat answer remains available

### Requirement: Later realtime adapter preserves session invariants

A later OpenAI Realtime adapter SHALL open exactly one provider session per capture, send exactly one session.update, treat the first session.updated as its acknowledgement without requiring echoed event_id, append audio only after configuration, and commit exactly once on a nonempty stop. It SHALL keep the research-specific nutrition tool and confirmation/logging stages outside STT.

#### Scenario: Ack has no client event ID
- **WHEN** the first session.updated lacks the sent event_id
- **THEN** the adapter accepts the acknowledgement and does not send a duplicate session.update or create another session

### Requirement: Live translation and locale separation

Live audio translation SHALL remain disabled in first release. A later enabled route SHALL require explicit source and target language, retain paired original transcript/translated generation, and use only an explicitly configured speech/provider profile. GT UI locale changes SHALL not change spoken-language routing or call a translation cloud service.

#### Scenario: German UI with English capture
- **WHEN** the user switches UI locale to de while capture language is en
- **THEN** controls change language and the STT language/provider stay unchanged

### Requirement: Safe diagnostics and terminal cleanup

Every capture/utterance SHALL emit one terminal outcome keyed by its ID, clean up mic tracks, sockets, audio contexts, listeners, and buffers, and ignore stale events. Diagnostics SHALL contain bounded phase/timing/usage metadata and scrubbed catalog causes, with no PCM, transcript, generated text, credentials, or duplicate completion logs. Raw capture audio SHALL not persist by default.

#### Scenario: Provider includes transcript in an error
- **WHEN** a provider failure carries raw text/audio or credentials in its cause
- **THEN** the service retains the original cause privately and serializes only the scrubbed diagnostic projection
