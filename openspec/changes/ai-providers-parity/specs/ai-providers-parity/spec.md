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

#### Scenario: GPT-5.1 reasoning intent
- **WHEN** GPT-5.1 has no thinking or reasoning-effort control
- **THEN** the facade omits reasoning_effort to preserve the provider default
- **WHEN** thinking is explicitly disabled without an effort override
- **THEN** reasoning_effort is none; explicit effort remains respected and enabled thinking without an effort uses high

### Requirement: Corrected independent speech protocols

Facade-owned speech SHALL implement the corrected voice-stt-tts contracts using independent selection and injected fetch/WebSocket transports (AI-094, AI-101, AI-105). DashScope SHALL use workspace hosts, ASR qwen-audio-3.1-asr-flash-streaming and TTS qwen-audio-3.1-tts-flash with longanlingxin_v3.1 and 24kHz mono PCM. Recognition SHALL gate binary data on matching readiness, replace provisional segments, deduplicate finals and require matching task-finished after one nonempty finish. Synthesis SHALL parse fragmented multiline SSE, require stop, bound buffers and verify audio descriptors. OpenAI SHALL request WAV with explicit voice/instructions, gate retired profiles and reject unsupported replacement transports. Failures SHALL retain private original causes and scrub serialized diagnostics.

#### Scenario: Fragmented synthesis
- **WHEN** SSE records or WAV headers are split across network chunks
- **THEN** audio is assembled once, verified and handed to the owned player only after successful synthesis

#### Scenario: Streaming speech framing
- **WHEN** a completed WAV response uses 0xffffffff RIFF and final data sizes
- **THEN** the final data size comes from remaining bytes while PCM and ordinary chunk validation remain enforced
- **WHEN** DashScope SSE uses JSON null or string "null" for finish_reason
- **THEN** synthesis remains in progress until stop; unsupported reasons and missing stop fail

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

#### Scenario: Profile-compatible classification budget
- **WHEN** Auto classifies with an explicit profile token limit below 2048 or with no token-override support
- **THEN** classification requests at most the supported limit capped at 2048, or omits the unsupported override, and dispatches the selected target
- **AND** the saved profile, bounded response size and classification timeout remain enforced

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

#### Scenario: Custom prompt belongs to the custom role
- **WHEN** customPrompt is supplied with a preset role ID instead of custom role -1
- **THEN** the request fails with AI.PROVIDER.CONFIG_INVALID before credentials or dispatch
- **WHEN** role -1 supplies a custom prompt
- **THEN** the facade uses it as the persona system prompt

### Requirement: Retained local provider catalog and migration

The catalog SHALL preserve all twelve legacy engine dispositions and every retained seeded model, expose shared assistant/direct defaults and model options, and merge user entries without removals (AI-001, AI-004, AI-005, AI-006, AI-011, AI-012, AI-017, AI-028, AI-048). Model names SHALL be used only for legacy migration, never to grant capabilities. Explicit custom models and endpoints SHALL survive. Unknown default-provider queries SHALL return gpt-5.1. Availability SHALL derive from local configured credentials and registered adapters without account, region or cloud fields.

#### Scenario: Legacy and custom settings survive an upgrade
- **WHEN** a retained legacy model or engine is imported, or seeded catalogs are merged with user entries
- **THEN** the explicit provider disposition is retained, all original entries remain, and missing built-ins are appended once
- **AND** known cross-family assistant models reconcile to qwen3.6-plus, kimi-k2.5, deepseek-v4-flash or gpt-5.1 while explicit custom IDs and endpoints remain unchanged

#### Scenario: Shared assistant and direct options
- **WHEN** assistant or direct consumers request models, including DeepSeek's four retained IDs
- **THEN** both receive the same local options including their saved custom choice and truthful configured/unavailable state

#### Scenario: Missing credentials retain catalog options
- **WHEN** a saved row has an empty, malformed or unavailable credential reference
- **THEN** its validated model metadata and catalog including the custom model remain listed with needs-key state
- **AND** availability and direct readiness are false, without resolving malformed credential references or exposing secrets

#### Scenario: Inactive model rows cannot provide a direct voice route
- **WHEN** a saved row has role none
- **THEN** the provider listing and knob pinning both report no usable direct route using the shared role readiness rule
- **AND** default and fallback rows remain eligible

### Requirement: Explicit specialized provider settings

Volc Ark SHALL select inference or agent entry method with explicit endpoint or bot ID and corresponding /api/v3 or /api/v3/bots URL. Coze SHALL select a bot ID and dedicated /v3/chat protocol. XFY SHALL use typed app ID, API key and secret resolved only in the host. Dedicated transports SHALL never silently fall back to OpenAI-compatible chat (AI-007, AI-034, AI-036, AI-051, AI-052).

#### Scenario: Selected destination and protocol
- **WHEN** a configured Groq, ZhiPu, Volc, Coze or Spark profile generates
- **THEN** only its selected endpoint and credential are used and fixtures assert its exact request and stream framing
- **AND** Spark uses generalv3.5, generalv3 or 4.0Ultra with HMAC SHA256 signing and a 60 second deadline, closes on failure or cancellation and rejects tools

#### Scenario: Provider changes clear incompatible options
- **WHEN** the provider input or model selection changes a row to a different provider
- **THEN** provider-specific controls and settings are cleared so unsupported Qwen search options cannot block OpenAI or DeepSeek
- **AND** aliases of the same provider preserve the selected controls

#### Scenario: Qwen chat and media endpoints coexist
- **WHEN** a scope saves Qwen chat and media rows or changes either endpoint
- **THEN** endpoint propagation and credential invalidation affect only rows using the same protocol
- **AND** the other protocol's endpoint and credential remain unchanged

#### Scenario: Qwen generation type selects the matching model
- **WHEN** a saved Qwen chat row switches to image or video generation
- **THEN** its model changes to wanx2.1-t2i-turbo or wan2.2-t2v-plus and its endpoint changes to the media API
- **AND** returning to chat selects qwen3.6-plus, while reselecting the current generation kind preserves an explicit custom model and endpoint

### Requirement: Structured tools and provider search

The facade SHALL accept typed assistant tool calls, correlated tool results and retained reasoning content. OpenAI and Qwen SHALL transport explicitly declared tools and execute only through an injected host allowlist bridge. A tool declaration SHALL NOT grant host execution; a missing bridge SHALL reject execution. Tool loops SHALL be bounded to four steps and validate primitive arguments and output size. Kimi and DeepSeek assistant tool-call follow-ups SHALL preserve reasoning_content or insert an empty placeholder when absent. Qwen SHALL pass explicit search_options; ZhiPu SHALL encode explicit web_search query/result selection. Search SHALL remain disabled unless selected, with provenance emitted only for selected search (AI-031, AI-032, AI-033, AI-037, AI-118).

#### Scenario: Tool follow-up preserves reasoning
- **WHEN** a selected capable profile receives assistant tool calls and matching tool results
- **THEN** their IDs, arguments and reasoning survive the outbound wire request and an unselected tool or unmatched result fails before I/O

#### Scenario: Search remains opt-in
- **WHEN** search is absent or explicitly disabled
- **THEN** no search tool, search request or source provenance is emitted
- **WHEN** Qwen or ZhiPu search is selected
- **THEN** fixtures assert the exact allowed options and bounded returned source provenance

### Requirement: Legacy assistant state compatibility

Imports SHALL map assistant session start/end/error, animation ongoing/processing/idle, and chat/keyConfig type values to explicit local states without executing generated key configuration (MGMT-405).

#### Scenario: Every retained assistant enum maps
- **WHEN** each recovered session, animation or type enum is decoded
- **THEN** its local state is returned, including keyConfig, and unknown values fail closed

### Requirement: Window-owned provider files

Opt-in file operations SHALL use only the profile pinned by the requesting window's owned conversation (AI-038, AI-244). Renderer-supplied row or session IDs SHALL NOT grant credential access.

#### Scenario: Another window requests provider files
- **WHEN** a second RPC connection supplies a known session and file ID, or tries to acquire the first window's session by submitting a turn
- **THEN** it fails before provider I/O
- **AND** the owning window can use its pinned row, while another row and closed conversation fail
