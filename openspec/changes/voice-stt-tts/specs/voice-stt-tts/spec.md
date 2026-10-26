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

### Requirement: Independent retained speech engines

Evidence: AI-002, AI-044, AI-090, KNOB-072. Explicit STT choices SHALL include DashScope, OpenAI transcription, Azure and XFY; explicit TTS choices SHALL include HTTP DashScope, OpenAI, Azure and XFY. Chat model or credential changes SHALL never change speech selections. Unsupported models, voices or transports SHALL fail before provider IO. All adapters SHALL own scoped instances and close them on completion, cancellation, replacement and error, under the existing deadlines.

#### Scenario: Independent engine round trip
- **WHEN** independent recognition and synthesis profiles are saved and the controller restarts
- **THEN** provider, model, language, voice and credential reference remain selected independently of chat, and changing providers requires explicit speech credentials

### Requirement: OpenAI transcription session

Evidence: AI-097, AI-098. OpenAI STT SHALL use the direct transcription WebSocket endpoint, session.update with transcription-only session type, explicit gpt-transcribe model, source language and mono 24kHz PCM. It SHALL wait for session.updated without an echoed event ID, never request response generation or tools, and correlate transcript items. Delta text SHALL be provisional, completed text SHALL replace it once, and committed item ordering SHALL determine final text. Empty captures SHALL send no commit. Nonempty uncommitted audio SHALL commit once; already server-committed audio SHALL not commit again. Final results SHALL wait at most 15s, and cancelled or stale events SHALL never complete another capture.

#### Scenario: Completion before release
- **WHEN** server VAD commits and completes the current item before capture is released with no further audio
- **THEN** finish returns its completed text once without an empty duplicate commit or response.create

### Requirement: Azure speech and recovered voice catalog

Evidence: AI-045, AI-046, AI-099, AI-106, AI-245. Azure SHALL use a main-owned subscription key, explicit region defaulting to eastasia, source language and a typed catalog containing every recovered en-US, zh-CN and zh-TW voice. A language change SHALL choose that language's first voice unless an explicitly selected compatible voice exists. Recognition SHALL push explicit PCM frames into a scoped recognizeOnce session after readiness and await its result. Synthesis SHALL use explicit raw mono 24kHz signed PCM and a push output stream, never a default speaker. Initialization failures, provider cancellation and physical SDK close SHALL propagate through the speech facade; per-session closure SHALL isolate concurrent and stale callbacks.

#### Scenario: Azure cancellation
- **WHEN** recognition or synthesis is cancelled before its provider result
- **THEN** all SDK stream, configuration and recognizer or synthesizer resources close, and a late callback cannot deliver a result or audio

### Requirement: XFY signed speech protocols

Evidence: AI-047, AI-100, AI-107. XFY SHALL resolve APPID, API key and secret only inside the main-owned adapter from one encrypted write-only bundle. HMAC-SHA256 signing SHALL use the exact host, RFC1123 date and request line. IAT SHALL convert 24kHz PCM to 16kHz with streaming phase preserved, send status 0 then 1 then one status 2 only after nonempty audio, use explicit en_us or zh_cn language and wpgs revisions, replacing the entire inclusive revision range. A provider status-2 result before release SHALL end capture and return its final transcript without another finish frame. TTS SHALL send UTF8 base64 text, selected aisxping voice, raw 16kHz output, and convert it to the shared 24kHz descriptor. Both SHALL reject provider errors, malformed or oversized audio, enforce final deadlines and close on cancellation.

#### Scenario: Inclusive correction
- **WHEN** an IAT revision replaces segments one through three
- **THEN** all three old segments disappear, the revision appears once, and only status 2 yields final text

#### Scenario: Server ends recognition
- **WHEN** the IAT server returns status 2 while the capture stream remains open
- **THEN** recognition returns its final transcript, interrupts capture and closes its scoped socket without sending an additional finish frame

### Requirement: Explicit gated Qwen realtime synthesis

Evidence: AI-104. An explicitly enabled qualified realtime profile SHALL send session.update, wait for session.updated before text append and commit, collect correlated response.audio.delta frames and require response.done before completing synthesis. Cancellation SHALL clear the text buffer, finish the session and close the socket within bounded cleanup. The default SHALL remain HTTP synthesis; realtime SHALL require its own explicit enablement and SHALL never be inferred from chat.

#### Scenario: Readiness and clear
- **WHEN** realtime synthesis waits for readiness then is cancelled after append
- **THEN** no text is sent before readiness and cancellation clears and closes the owned session without playback

### Requirement: Secure settings and geographic seeding disposition

Evidence: AI-044, AI-046, AI-047, AI-109. Settings SHALL return only public provider configuration and credential-presence booleans. Azure keys and all three XFY credential fields SHALL be write-only, encrypted through the existing vault, and absent from persisted settings, renderer reads, diagnostics and chat credentials. Explicit saved STT, TTS and live-translation choices SHALL survive startup unchanged. Geographic seeding SHALL be an opt-in suggestion only, without network lookup or automatic provider activation: China suggests DashScope and qwen3.5-livetranslate-flash-realtime; other known countries suggest OpenAI and gpt-4o-transcribe. Unknown or failed lookups SHALL produce no suggestion. Repeated startup SHALL never overwrite a saved selection or live-translation model.

#### Scenario: Lookup failure with explicit selections
- **WHEN** a geographic lookup is unavailable or the app restarts in another country
- **THEN** existing speech and live-translation choices remain unchanged, no provider is enabled and no location request is sent

### Requirement: Reload-safe speech ownership

Evidence: AI-246. Speech settings SHALL persist configuration in main rather than a renderer engine registry. Renderer reload SHALL replay public saved configuration without credentials; a changed profile SHALL cancel and await all active capture and output before publication. Each subsequent session SHALL resolve the latest profile and own a fresh scoped engine. Repeated profile replacement and stale callbacks SHALL never reuse destroyed engines or report results into a newer session.

#### Scenario: Replacement and restart
- **WHEN** active speech is replaced twice and the settings renderer reloads
- **THEN** old sessions close before the new settings become visible, the latest selected profile replays, and stale old events cannot alter it

The direct committed-turn model and endpoint follow [official OpenAI realtime transcription documentation](https://developers.openai.com/api/docs/guides/realtime-transcription), accessed 2026-10-26. This replaces the recovered gpt-4o-transcribe configuration with the documented gpt-transcribe profile and transcription-only transport. The geographic suggestion retains its historical live-translation model string as an inert suggestion, never an activated profile.

### Requirement: Voice-runtime transcript and failure policy

AI-084 and AI-086 SHALL accept one-character and two-character utterances containing a Unicode letter or number, including Chinese. Whitespace and punctuation-only finals SHALL be empty and never submitted. This intentionally replaces DK's length cutoff. No-audio and unclear audio SHALL remain distinct from permission denial, missing device, recorder start failure, authentication and provider timeout; visible failures SHALL carry stable catalog codes without inspecting message substrings. Every terminal SHALL release capture ownership.

#### Scenario: Short meaningful final
- **WHEN** recognition returns `好`, `a`, `你好`, punctuation-only or whitespace
- **THEN** meaningful finals submit once and the other finals end empty with no chat submission

### Requirement: Voice-runtime speech ownership

AI-091, AI-155, KNOB-073, MGMT-149, MGMT-301 and WIDGETS-015 SHALL use an explicit assistant/device output target independent of request-id spelling. AudioBot SHALL toggle an owned same-device reader which consumes ordered answer chunks without follow-up prompts, exposes thinking/speaking state from the actual queue, stops on repeat release/reset and leaves other devices untouched. Its default-agent and model labels SHALL round trip through saved actions. Cloud `qwen` SHALL use the independently configured global TTS profile; local `webSpeech` SHALL use installed system voices with rate 0.5–2, pitch 0–2, volume 0–1 and an optional voice-name hint. Missing local voices SHALL fail visibly without selecting cloud. The ClawBot read-aloud pill SHALL toggle its existing owned controller once per gesture and render active/playing state.

#### Scenario: Reader toggle and engine isolation
- **WHEN** a reader receives ordered reply chunks then a second effective release
- **THEN** its unsaid text and playback stop, other device owners remain intact, and no microphone or alternate engine starts

#### Scenario: Committed reader authorization
- **WHEN** a renderer requests an AudioBot reader toggle for MGMT-149 and MGMT-301
- **THEN** main verifies the sender frame and the visible AudioBot binding on the device's committed active profile page, uses its saved settings, and rejects unbound keys or unavailable profile storage before activating speech

#### Scenario: Delayed local voice enumeration
- **WHEN** a fresh local worker initially has no system voices for KNOB-073 and MGMT-301
- **THEN** it waits for voiceschanged for at most 1000ms before rejecting an empty list, and stop or close removes the listener and timer without allowing late playback

### Requirement: Bounded segmentation and stalled output

AI-092 explicitly retains the app's punctuation/200-character/two-second pending-text segmentation as a supported replacement for DK's first-20/later-50 segmentation. Tests SHALL pin punctuation boundaries, 200-character splitting, remainder, exact idle flush and the 4000-character queue bound. AI-156, KNOB-074 and WIDGETS-108 SHALL reuse the shared 12s no-audio watchdog and one suspended-context resume at 8s. Playback SHALL complete only on natural drain. A failed segment SHALL report its stable timeout, release output and allow later queued segments; stop SHALL invalidate timers. A stalled resume SHALL be bounded by declared duration plus 5s or 30s when unknown, with at least 8s observation after a resume attempt.

#### Scenario: Suspended segment resumes once
- **WHEN** received audio remains suspended for 8s
- **THEN** one resume is attempted, natural drain can complete, and a hung resume fails within the bounded deadline without reporting successful playback

### Requirement: App-owned optional host tones

KNOB-068 SHALL register app-generated start/end/error tone resources without copying proprietary WAVs. Host tone playback SHALL be opt-in, carry the explicit device target and use the shared output owner. Disabled host tones SHALL acquire no audio output and SHALL preserve the existing hardware buzzer behavior.

#### Scenario: Opt-in tone lookup
- **WHEN** host tones are disabled or a registered tone is requested
- **THEN** disabled requests perform no playback; enabled requests select the app-owned bounded PCM resource and exact target


### Requirement: Mode deadlines and truthful spoken status

AI-070 SHALL preserve the normal-chat absolute 60000ms deadline and require a 300000ms absolute deadline for long-mode execution. AI-071 SHALL flush pending normal-chat speech after its two-second text idle boundary, and PC/analysis runners SHALL terminate stalled work with a stable failure rather than manufacture success. AI-080 SHALL select recovered assistantConfig status phrases from a bounded eight-locale catalog and speak each action status at most once in its turn. Normal answer completion SHALL flush its remainder before the localized finishedOutput phrase. Cancellation or failure SHALL NOT speak successful completion.

The long, PC and analysis runners are not implemented: ChatService rejects every non-normal mode with ChatModeUnavailable. AI-070, AI-071 and AI-080 remain blocked as complete rows until their owning mode runners can exercise the deadlines, stall policies and action statuses. The catalog and normal completion path do not establish those missing behaviors.

#### Scenario: Absolute mode deadlines
- **WHEN** a normal stream reaches 60001ms or a long-mode stream reaches 300000ms without completing
- **THEN** that runner cancels its provider and releases its owner with a stable timeout, without successful completion speech

#### Scenario: Stalled mode and localized completion
- **WHEN** normal speech text stops arriving for two seconds or a PC/analysis action stalls
- **THEN** normal speech flushes its pending remainder while the stalled action fails truthfully under its runner policy
- **AND** an otherwise successful normal turn speaks finishedOutput exactly once in the selected TTS language after answer drain

#### Scenario: Interrupting an armed AudioBot reader
- **WHEN** a knob interrupt, selection change or shared speech cancellation stops an AudioBot-owned queue
- **THEN** main stops playback, drops stale chunks and publishes thinking for the still-armed reader with the same key and session
- **AND** the next answer can speak without toggling the reader again, while disarming or reset publishes idle
