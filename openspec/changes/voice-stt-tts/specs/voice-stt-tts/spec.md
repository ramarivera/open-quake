# Voice STT and TTS

## Purpose

Provide independent recognition and synthesis with correlated capture, bounded provider protocols, and truthful playback completion.

## ADDED Requirements

### Requirement: Independent speech adapters

The system SHALL expose STT and TTS through injected Effect services with independent profile selection, typed events/errors, Config, named spans, and mock-default tests. First release SHALL provide BYO-key DashScope STT and HTTP/SSE TTS plus an independently selected OpenAI TTS adapter without a DecoKee account or geolocation lookup. Evidence: `AI-094`, `AI-101`, `AI-105`, `AI-108`. Unsupported speech transports SHALL remain unavailable until conformance verification, even if chat supports the same provider.

#### Scenario: Text chat works without TTS
- **WHEN** the selected TTS profile is missing or synthesis fails
- **THEN** the generated text remains readable and normal chat continues without selecting another speech provider silently

### Requirement: Capture phase machine and bounded waits

Capture SHALL expose idle, requesting_permission, requesting_session, connecting, configuring, starting_recorder, listening, stopping, processing, and completed/empty/failed/cancelled terminals, skipping inapplicable phases explicitly. Permission wait SHALL be at most 30s, session-acquisition/connect/configure/recorder-start each at most 10s, and stop-to-final at most 15s. Generic listening SHALL automatically stop and finalize at 60s under the same nonempty/empty rules as user stop. Knob capture SHALL stop at 58s after recorder readiness, preserving the generic service ceiling of 60s. Evidence: KNOB-051. Setup/final-result timeout SHALL identify its phase through `VOICE.CAPTURE.PHASE_TIMEOUT` and release owned resources.

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

The DashScope STT adapter SHALL default to `qwen-audio-3.1-asr-flash-streaming` on the explicitly configured workspace host `wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference` or `wss://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/inference`. It SHALL authenticate with a region-matching key and send one run-task on that inference WebSocket with a unique task ID, streaming duplex, audio/asr/recognition, explicit model, pcm format, and sample rate. It SHALL await matching task-started before binary PCM, send one finish-task after the final nonempty frame, and finish only on matching task-finished. Task-failed, premature close, malformed frames, and deadline SHALL yield one failed terminal outcome. Provisional text SHALL replace provisional text; finalized segments SHALL appear once under a verified segment/finality rule. `AI-094` records the audited 0.4.95 model `qwen-audio-3.0-asr-flash-streaming`; the current default comes from [Model Studio ASR models](https://www.alibabacloud.com/help/en/model-studio/asr-model) and [client events](https://www.alibabacloud.com/help/en/model-studio/qwen-audio-asr-streaming-client-events), accessed 2026-10-24. Workspace hosts follow the [connection guide](https://www.alibabacloud.com/help/en/model-studio/qwen-audio-asr-streaming-websocket-api), accessed 2026-10-24.

#### Scenario: Provisional sentence revised
- **WHEN** one segment produces provisional `turn`, provisional `turn left`, then final `turn left`
- **THEN** the final transcript contains `turn left` once and no chat request is made before task-finished

#### Scenario: Late task-started from cancelled capture
- **WHEN** a cancelled task receives task-started after another capture begins
- **THEN** its socket closes and it cannot start recording or finish the newer capture

### Requirement: DashScope HTTP synthesis protocol

DashScope TTS SHALL use `/api/v1/services/audio/tts/SpeechSynthesizer` on the configured HTTPS workspace host `{WorkspaceId}.cn-beijing.maas.aliyuncs.com` or `{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com`, a region-matching key, model `qwen-audio-3.1-tts-flash`, and a model-compatible explicit voice. The body SHALL include `input.text`, `input.voice`, `input.format=pcm`, `input.sample_rate=24000`; headers SHALL include bearer authorization and `X-DashScope-SSE: enable`. Evidence: `AI-101`, `AI-108`; [Model Studio HTTP API](https://www.alibabacloud.com/help/en/model-studio/qwen-audio-tts-http-api), accessed 2026-10-24. It SHALL combine all data lines within each complete SSE event before parsing JSON, handle fragmented input, decode output.audio.data in order, and require output.finish_reason=stop before successful synthesis. It SHALL require a verified codec/rate/channel descriptor before playback. Unknown audio format SHALL fail with `VOICE.TTS.FORMAT_UNSUPPORTED`. Truncated records or provider errors SHALL not become successful synthesis.

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

The shipped Meet AI live audio translation route SHALL be available when its configured adapter is qualified, require explicit user start and source and target language, retain paired original transcript/translated generation, and use only an explicitly configured speech/provider profile. GT UI locale changes SHALL not change spoken-language routing or call a translation cloud service. Evidence: `AI-136`, `AI-292`, `AI-327`; commented library entries do not disable the 0.4.95 default-profile route.

#### Scenario: German UI with English capture
- **WHEN** the user switches UI locale to de while capture language is en
- **THEN** controls change language and the STT language/provider stay unchanged

### Requirement: Safe diagnostics and terminal cleanup

Every capture/utterance SHALL emit one terminal outcome keyed by its ID, clean up mic tracks, sockets, audio contexts, listeners, and buffers, and ignore stale events. Diagnostics SHALL contain bounded phase/timing/usage metadata and scrubbed catalog causes, with no PCM, transcript, generated text, credentials, or duplicate completion logs. Raw capture audio SHALL not persist by default.

#### Scenario: Provider includes transcript in an error
- **WHEN** a provider failure carries raw text/audio or credentials in its cause
- **THEN** the service retains the original cause privately and serializes only the scrubbed diagnostic projection

### Requirement: Independent OpenAI synthesis adapter

The system SHALL provide an explicitly selected facade-owned OpenAI TTS adapter using `POST https://api.openai.com/v1/audio/speech`, with model, voice, language instructions and response audio descriptor in the TTS profile. The audited compatibility profile SHALL encode model `gpt-4o-mini-tts`, voice `marin`, calm medium-speed speech instructions for the selected language, and `response_format=wav` (`AI-105`). It SHALL obey the shared deadlines, output lease, cancellation and natural playback completion requirements. TTS failure SHALL preserve readable chat text and SHALL NOT silently select DashScope. Unsupported or retired model/voice pairs SHALL be unavailable.

The [official OpenAI TTS guide](https://developers.openai.com/api/docs/guides/text-to-speech), accessed 2026-10-24, schedules `gpt-4o-mini-tts` shutdown for 2027-01-06. That profile SHALL be disabled at shutdown. A replacement Realtime model SHALL NOT be sent to `/audio/speech`; replacement transport enablement SHALL require independent conformance verification and explicit profile migration.

#### Scenario: OpenAI synthesis without OpenAI STT

- **WHEN** the user chooses a qualified OpenAI TTS profile while recognition uses DashScope
- **THEN** the answer uses the OpenAI synthesis adapter without opening a Realtime/STT session or changing the recognition profile

#### Scenario: Cancel OpenAI speech

- **WHEN** the user cancels while OpenAI synthesis or WAV playback is pending
- **THEN** the request and queued output stop, late audio is discarded, and the chat answer remains readable

#### Scenario: Retired synthesis profile

- **WHEN** the compatibility model reaches its documented shutdown date
- **THEN** the profile reports unavailable and no request with a replacement Realtime model is sent to the Speech API


### Requirement: Shared persistent microphone identity

Evidence: AI-247, AI-281, KNOB-049, SETTINGS-019. Assistant and meeting capture SHALL use one saved microphone identity containing deviceId, label and groupId. Legacy strings and objects SHALL normalize to that identity; empty values mean system default. The picker SHALL enumerate audio inputs without opening a microphone, refresh on opening/device changes, and discard stale results. Recovery SHALL prefer exact ID, unique group, unique group plus label, then unique label only when no group is saved. Ambiguous or disconnected saved identities SHALL display an empty selection, preserve the saved value and fail exact acquisition without fallback. No saved choice SHALL prefer default then first input. At an isolated capture document boundary, the saved groupId SHALL be excluded because it is document-specific. The capture document SHALL enumerate its own inputs and translate a foreign saved device ID only through a unique nonempty label; missing or ambiguous matches SHALL fail exact acquisition without fallback.

#### Scenario: Identity changes and duplicates
- **WHEN** an input ID changes but its saved group uniquely matches, or group plus label uniquely matches
- **THEN** both capture consumers acquire that recovered exact ID, and ambiguous recovery never chooses an arbitrary input

#### Scenario: Capture worker has a different media-device salt
- **WHEN** settings saves a physical input with document-specific device and group IDs and an isolated capture worker enumerates the same uniquely labeled input
- **THEN** capture uses the worker-local exact device ID, while missing or duplicate labels never select another input

#### Scenario: Stale enumeration and unplugged microphone
- **WHEN** an older enumeration resolves after a newer result or a saved input disappears
- **THEN** the picker ignores stale results and shows Select Microphone without overwriting the saved identity or selecting another microphone

### Requirement: Explicit recorder format and controls

Evidence: AI-110, AI-112. The speech recorder SHALL replace the generic recovered 8/16-bit and output-channel options with one supported output descriptor, mono 24kHz signed 16-bit little-endian PCM. Input SHALL support mono/stereo at 8000, 11025, 16000, 22050, 24000, 44100 and 48000Hz, plus browser rates up to 192000Hz, preserving resampling phase. Pause SHALL suppress incoming frames without ending ownership; resume SHALL continue sequence. Explicit in-memory export SHALL provide PCM, WAV and WAV Blob with a 60-second bound. Export SHALL be opt-in; normal speech SHALL not retain an archive or replay recordings. Stop/close SHALL release tracks/context and reset live level to zero.

#### Scenario: Low-rate stereo and pause export
- **WHEN** synthetic stereo input at each supported source rate is paused, resumed, stopped and explicitly exported
- **THEN** output uses the fixed descriptor with correct sample count, sequence and WAV header, omits paused samples and preserves no recording after close

### Requirement: Capture activity and level cadence

Evidence: AI-252, AI-253, KNOB-050, KNOB-054. Production capture SHALL carry normalized peak and RMS. Peak above 0.15 SHALL enter speaking and exactly 15 quiet buffers SHALL clear activity, without silence auto-stop. Levels SHALL apply RMS times 3.5 clamped to zero through one, speaking when scaled RMS exceeds 0.05 or peak exceeds 0.15, and multiply silent levels by 0.35. Emission SHALL be no faster than 50ms speaking or 180ms silent, scoped to the active capture.

#### Scenario: Quiet activity and stale capture
- **WHEN** onset is followed by fourteen quiet buffers, then a fifteenth, or an older capture produces a late frame
- **THEN** activity clears only at the fifteenth, recording continues, and the old frame cannot change the current meter

### Requirement: Typed capture failure and private timing

Evidence: AI-254, AI-255, KNOB-053, KNOB-055. Missing input SHALL report VOICE.CAPTURE.NO_DEVICE, permission denial SHALL retain PERMISSION_DENIED, and other start errors SHALL retain RECORDER_UNAVAILABLE with private original causes. All failures SHALL release partial acquisitions. Runtime SHALL emit one terminal timing record with bounded monotonic elapsed startup, ready latency, first-frame latency, recording duration, hasAudioFrame and stopBeforeReady, without audio, transcript, device identity or absolute timestamps.

#### Scenario: Release before recorder readiness
- **WHEN** capture stops before ready or fails for missing microphone
- **THEN** it emits one timing record with zero recorded duration and no first-frame latency, identifies early stop separately from failure, and releases late resources

#### Scenario: Knob duration boundary
- **WHEN** a knob recorder reaches 57999ms then 58000ms after readiness
- **THEN** it remains open before the boundary and stops once at 58000ms, finalizes nonempty audio once and closes all capture resources

#### Scenario: Empty synthesis AI-103

- **WHEN** synthesis receives empty or whitespace-only text
- **THEN** it returns text-only without HTTP, credentials or audio output

#### Scenario: Provider switch and reload AI-108

- **WHEN** saved TTS selection switches between OpenAI and DashScope and settings reload
- **THEN** the derived model is respectively gpt-4o-mini-tts or qwen-audio-3.1-tts-flash, without retaining the previous provider model
