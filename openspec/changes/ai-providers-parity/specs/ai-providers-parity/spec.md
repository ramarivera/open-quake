# AI provider parity

## ADDED Requirements

### Requirement: Profile role models and validated controls

Profiles SHALL select independent routing, daily, deepThink, vision, image, video and TTS models and optional thinking, reasoning effort and native web-search controls (AI-008, AI-030–033). The facade SHALL dispatch the selected model and prepare allowlisted provider options before credentials or network calls. Unsupported controls, sampling and modalities SHALL fail explicitly. Recovered quirks SHALL be documented with sources and deliberate safety replacements.

#### Scenario: Router differs from daily model
- **WHEN** a profile selects separate routing and daily models
- **THEN** classification uses the routing model and chat uses daily without mutating the saved profile

#### Scenario: DeepSeek vision or conflicting Kimi sampling
- **WHEN** the request selects the vision role or includes images for DeepSeek, even if the profile advertises image support, or sampling that conflicts with the selected Kimi profile
- **THEN** the facade rejects it before credentials or adapter invocation

#### Scenario: Kimi mandatory sampling without caller ranges
- **WHEN** a valid Kimi profile omits temperature and top-p ranges and the request omits those values
- **THEN** generation sends the selected model's mandatory sampling without changing the saved profile
- **AND** explicitly supplied sampling and declared ranges remain validated

#### Scenario: Independent classification controls
- **WHEN** daily or deep-thinking generation enables medium or high reasoning effort and Auto selects a separate routing model
- **THEN** classification uses its explicit routing controls without inheriting daily controls
- **AND** daily and deep-thinking requests retain the configured reasoning effort

#### Scenario: Disabled controls for DeepSeek classification
- **WHEN** Auto selects an explicitly configured DeepSeek routing model with thinking and native search disabled
- **THEN** classification succeeds without emitting provider reasoning or search options and dispatches the selected target
- **AND** enabling unsupported reasoning or native search still fails before credentials or adapter invocation

### Requirement: Corrected independent speech protocols

Facade-owned speech SHALL implement the corrected voice-stt-tts contracts using independent selection and injected fetch/WebSocket transports (AI-094, AI-101, AI-105). DashScope SHALL use workspace hosts, ASR qwen-audio-3.1-asr-flash-streaming and TTS qwen-audio-3.1-tts-flash with longanlingxin_v3.1 and 24kHz mono PCM. Recognition SHALL gate binary data on matching readiness, replace provisional segments, deduplicate finals and require matching task-finished after one nonempty finish. Synthesis SHALL parse fragmented multiline SSE, require stop, bound buffers and verify audio descriptors. OpenAI SHALL request WAV with explicit voice/instructions, gate retired profiles and reject unsupported replacement transports. Failures SHALL retain private original causes and scrub serialized diagnostics.

#### Scenario: Fragmented synthesis
- **WHEN** SSE records or WAV headers are split across network chunks
- **THEN** audio is assembled once, verified and handed to the owned player only after successful synthesis

#### Scenario: Cancellation and natural drain
- **WHEN** speech is cancelled or revoked while HTTP or playback is pending
- **THEN** owned requests and output stop, late audio is ignored and readable text remains
- **WHEN** synthesis finishes before playback drains
- **THEN** completion waits for natural drain with a bounded playback deadline

#### Scenario: Stalled recognition sends
- **WHEN** run-task, a PCM frame or finish-task stalls in the injected WebSocket transport
- **THEN** a bounded phase deadline fails with VOICE.CAPTURE.PHASE_TIMEOUT, closes and aborts the socket, suppresses late transcripts and releases capture and playback ownership
- **AND** configure includes run-task plus readiness within 10 seconds, capture sends remain within 60 seconds, and final includes finish-task plus task-finished within 15 seconds

#### Scenario: Integrated desktop shutdown during profile initialization
- **WHEN** the desktop quits while knob registration is waiting on a profile read or refresh
- **THEN** registration cancels its owned operations before waiting for its queue and cannot start work on the disposed runtime
- **AND** the built application passes its existing bounded mock shutdown gate

#### Scenario: Retired OpenAI profile
- **WHEN** time reaches 2027-01-06 UTC
- **THEN** gpt-4o-mini-tts is unavailable before HTTP and no replacement Realtime model is sent to the Speech API

### Requirement: Auto voice key mode

Auto SHALL supplement explicit modes, use the routing model and recovered prompt categories, and Schema-parse a bounded JSON object (AI-114, lih.22). It SHALL route one transcript to chat, agents, Home Assistant, shortcuts, meetings, computer operation, key configuration, image/video generation or data analysis through injected typed dispatch. Disabled Home Assistant SHALL be absent from the prompt and rejected on output. Returned session route SHALL pin follow-ups. Model text SHALL never become executable code. Search suggestions SHALL not activate search without the explicit profile control.

#### Scenario: Explicit key and Auto follow-up
- **WHEN** an explicit key mode is selected or an Auto session already has a route
- **THEN** the selected route dispatches without another classification request

#### Scenario: Untrusted router output
- **WHEN** the model returns an expression, unknown category, malformed JSON or disabled HA action
- **THEN** a catalog error is returned and no target runs

### Requirement: Retained role presets

The shipped catalog SHALL preserve recovered role IDs, prompts, per-key thinking/search defaults and all eight translated names, excluding NSFW and jailbreak presets under decision 12 (AI-116, AI-117, AI-147–149, AI-228). A selection helper SHALL produce a system prompt and explicit controls; it SHALL not execute persona instructions as host code.

#### Scenario: Preset localization and exclusions
- **WHEN** a retained role is selected in any shipped locale
- **THEN** its recovered translated name and prompt are available
- **WHEN** a dropped role ID is requested
- **THEN** it cannot be selected
