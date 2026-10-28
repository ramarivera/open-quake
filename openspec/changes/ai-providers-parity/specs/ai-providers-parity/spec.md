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
- **THEN** the provider listing, knob readiness/pinning and per-key assistant submit all report no usable direct route using the shared role readiness rule
- **AND** default and fallback rows remain eligible; named role-none rows stay visible as unavailable selections and cannot use retained credentials

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

### Requirement: Media turn deadlines

The desktop chat turn and AI facade SHALL share the selected transport's absolute deadline including acceptance and setup (AI-007, AI-079). Explicit DashScope media profiles SHALL have 300 seconds; text SHALL retain 60 seconds. Deltas SHALL NOT extend either deadline.

#### Scenario: Media generation outlasts a normal text turn
- **WHEN** a selected media profile completes after 90 seconds
- **THEN** the owning chat turn completes successfully instead of timing out at 60 seconds
- **WHEN** media work is still pending at 300 seconds
- **THEN** upstream aborts and exactly one timedOut terminal is emitted

### Requirement: Window-owned provider files

Opt-in file operations SHALL use only the profile pinned by the requesting window's owned conversation (AI-038, AI-244). Renderer-supplied row or session IDs SHALL NOT grant credential access.

#### Scenario: Another window requests provider files
- **WHEN** a second RPC connection supplies a known session and file ID, or tries to acquire the first window's session by submitting a turn
- **THEN** it fails before provider I/O
- **AND** the owning window can use its pinned row, while another row and closed conversation fail

#### Scenario: UTF-8 upload and download bounds agree
- **WHEN** an upload's text exceeds 2097152 UTF-8 bytes or 1048576 characters
- **THEN** it fails before credentials or provider I/O
- **WHEN** multibyte text fits both limits, including the exact byte boundary
- **THEN** an upload and content retrieval round trip preserves it

### Requirement: Persisted assistant controls

Assistant keys SHALL expose typed settings and save/reopen without raw credentials. Defaults SHALL be voice input on, wake window off, history count zero, context timeout 5 seconds, role zero, temperature 1, topP .7, router on, and explicit search and HA off. Router selection SHALL force voice on and wake window off. Roles SHALL use the retained catalog or custom role -1 with at most 3000 characters. Personality SHALL span 0..1 and Reply Quality 0..2 in .05 steps; timeout SHALL span 5..30 in steps of 5; history SHALL span 0..50. Provider-unsupported controls SHALL explain their restriction. HA selection SHALL intersect the assistant entity IDs with the host allowlist before dispatch (AI-009, AI-041, AI-053, AI-054, AI-055, AI-056, AI-057, AI-058, AI-059, AI-060, MGMT-285).

#### Scenario: Save and reopen key controls
- **WHEN** a user selects a retained role or a custom prompt and changes bounded controls
- **THEN** Save and reopen retain the settings, excluded role IDs and invalid combinations fail validation, and credentials never enter the key
- **AND** router/plain-chat selection changes subsequent dispatch; unsupported routes report unavailable instead of executing another route

#### Scenario: Context expiration and history
- **WHEN** a subsequent assistant turn follows the selected 5..30 second idle timeout
- **THEN** earlier context is excluded, and before expiry only the selected number of completed exchanges is eligible
- **AND** already accepted turns keep their selection and profile snapshot

#### Scenario: Wake the conversation window without voice capture
- **WHEN** a saved assistant key has Wake Chat Window enabled and is pressed
- **THEN** the host restores and focuses the existing management conversation window, including when Voice Input is disabled
- **AND** selection alone sends no model request; keys with wake disabled and external-agent keys do not trigger assistant window activation (AI-060)

### Requirement: Local assistant provider selection

General Settings SHALL expose AI Model Provider using saved local rows in QWen, Kimi, DeepSeek, OpenAI order. Loading, empty, failed and fewer-than-two choices SHALL be visible; a single option SHALL be disabled. An explicit choice SHALL persist through the Models default role and apply to subsequent chat turns. Per-key settings SHALL display the resolved provider read-only and link General Settings. Direct choices SHALL share the provider catalog and retain custom model IDs (AI-003, AI-019, AI-042, AI-062, SETTINGS-008).

#### Scenario: Local catalog and explicit choice
- **WHEN** providers load or a user chooses another saved provider
- **THEN** the fixed engine order is retained, unconfigured choices explain why, the saved default changes, and reopening uses it without cloud/account calls

#### Scenario: Saved assistant follows a changed General provider
- **WHEN** an assistant follows General Settings default and the provider changes from Qwen to DeepSeek
- **THEN** subsequent turns and the reopened editor clear unsupported Thinking and Web Search controls and discard known cross-provider model overrides before using the current default model
- **AND** compatible controls, custom model IDs, explicitly selected rows and unrelated assistant preferences remain intact (AI-005, AI-041, AI-048, AI-062)

### Requirement: Named assistant models

Models SHALL support Add, Rename, Copy and confirmed Delete. Names SHALL contain 1..30 trimmed characters. Copies SHALL own a fresh ID and independent settings with no credential or pending secret. Built-in rows SHALL disallow rename/delete. Deleting the default SHALL select a remaining row through existing default-role normalization; deleting the last global row SHALL fail (AI-043).

#### Scenario: Isolated copy and delete fallback
- **WHEN** a named model is copied, renamed and saved
- **THEN** editing the copy leaves its source unchanged and the copy has no credentials until explicitly saved
- **AND** editing or saving either named row's endpoint preserves the other row's endpoint and credentials; legacy unnamed provider siblings retain their existing URL propagation
- **WHEN** its default is deleted with confirmation
- **THEN** a remaining configured model becomes default and built-in protections remain enforced

### Requirement: Reachable protected provider configuration

Assistant settings SHALL link the existing Models and Speech settings consumers for Azure voice/key/region, Spark app ID/key/secret, custom model URL/name, HuoShan Inference/Agent and Coze bot configuration. Those consumers SHALL keep keys in the host protected credential store and expose readiness without secret values. The assistant editor SHALL expose roles, bounded sampling, timeout and HA configuration through the same production path (SETTINGS-102).

#### Scenario: Configure a retained provider
- **WHEN** a user follows assistant provider or speech configuration
- **THEN** the existing protected settings editor is reachable and subsequent assistant turns use the saved model configuration without copying secrets into keys

#### Scenario: Equipment dispatch requires accepted turn ownership
- **WHEN** an Auto assistant request is busy, duplicates a saved turn ID or fails chat admission
- **THEN** no classification or Home Assistant executor runs
- **AND** accepted routing and equipment work run inside the turn worker, with terminal failure/cancellation recorded and no automatic action replay (AI-058)

#### Scenario: Pending Auto request loses its device or profile
- **WHEN** disconnect, profile change or cancellation retires an accepted assistant session during classification or action generation
- **THEN** the turn worker interrupts provider I/O and cannot execute Home Assistant actions later
- **AND** equipment dispatch rechecks the owning session/profile identity after generation immediately before execution (AI-058)

#### Scenario: Cancel or supersede equipment work queued in the production integration owner
- **WHEN** an accepted assistant action waits behind another Home Assistant integration operation and its turn is cancelled or its owning identity is superseded
- **THEN** interruption crosses the production runtime bridge and the integration owner rechecks the owning identity after acquiring its lock and loading the allowlist, immediately before the equipment call
- **AND** releasing the earlier integration operation produces zero equipment calls for the retired turn (AI-058)

#### Scenario: Concurrent chat cannot replace accepted routing metadata
- **WHEN** another session submits plain chat for the same model while an accepted Auto turn awaits classification
- **THEN** classification and Home Assistant action generation retain that turn's pinned provider profile and routing model
- **AND** mutable shared repository entries cannot change the accepted routing selection (AI-058)

#### Scenario: Typed input with default router enabled
- **WHEN** a default assistant key submits typed text with Use Dekie Agent enabled
- **THEN** text reaches Auto classification and its supported chat/HA route; voice-input settings restrict microphone transcripts independently (AI-053, AI-060)

#### Scenario: Saved custom knob and General default agree with execution
- **WHEN** a direct knob explicitly saves a bounded custom model ID outside the built-in catalog
- **THEN** readiness and runtime pinning both accept it using the selected eligible credentialed row, without requiring duplicate assistant settings
- **WHEN** its model selection changes to General Settings default
- **THEN** directProvider and directModel resolve the new default before saving, never the previous row (AI-005, AI-048, AI-062)

### Requirement: Existing facade owns production meeting transports

Meeting ASR, upload and live translation SHALL compose the existing AiProviderService and AiMeetingAdapter with saved model profiles, credential references and managed meeting audio UUIDs. The meeting-minutes requirements own task expiry, artifacts, cancellation, mono normalization and bounded translation. No account gateway or second credential store SHALL be introduced. Evidence: AI-136, AI-137, AI-269, AI-270, AI-272, AI-278.

#### Scenario: Saved credentials reach real adapters through fake servers

- **WHEN** a saved Qwen or OpenAI profile processes synthetic managed audio through the production meeting facade and loopback HTTP or WebSocket servers
- **THEN** only its selected credential authenticates the expected direct adapter, the resulting transcript feeds the existing summary facade, and all temporary audio and sockets close without hardware or paid requests


### Requirement: Assistant routing and per-key persona pinning
AI-081, AI-088, AI-089 and AI-241 SHALL bind reviewed imported assistant settings to an isolated per-key session and explicit dictation target. Imported payloads SHALL remain inert until explicitly reviewed and saved.

#### Scenario: Capture admission and early release
- **WHEN** a reviewed key starts capture
- **THEN** capture refuses offline or invalid model configuration before microphone acquisition, publishes preparing, and cancels a released preparation without submitting

#### Scenario: Reviewed legacy keys retain independent sessions
- **WHEN** two reviewed keys with different saved models, history settings and wake-window choices are held and released
- **THEN** each uses its own session and pinned settings, stale callbacks cannot select another session, and an early release or offline refusal sends no chat

#### Scenario: Wake dictation and direct submission
- **WHEN** a final transcript arrives for a wake-window key
- **THEN** the selected desktop session receives editable dictation and its pinned settings, with no background inference, while a direct key submits once and preserves its transcript on refusal

### Requirement: Retained Copilot key execution and title migration
AI-117, MGMT-358, MGMT-359 and SETTINGS-110 SHALL execute all six shipped Copilot keys with their per-key Chinese prompts, thinking and search controls. On import and persisted profile read, aiChat keys identified by the six role IDs 128/6/8/93/129/84 or their exact built-in title i18n keys SHALL upgrade an existing false title edit flag to true. The migration SHALL preserve user titles, actions and every other edit flag and SHALL be idempotent.

#### Scenario: Six roles survive title-only editing
- **WHEN** each saved built-in role key is activated after a title-only edit and repeated profile reads
- **THEN** the outbound prompt and controls match the saved key, the title stays edited and unrelated keys and locks stay unchanged

### Requirement: Local legacy prompt catalog
AI-142 and AI-143 SHALL expose a local, provenance-documented prompt catalog with a Default entry. Chinese locale subtags SHALL use the Chinese catalog. Every other locale SHALL use the English catalog, including regional English and locales without their own prompt translation. Only decision 12 NSFW and jailbreak entries SHALL be excluded. Missing or malformed catalog input SHALL return Default alone without execution or network access.

#### Scenario: Locale and corrupt catalog handling
- **WHEN** the loader receives each supported locale or missing/malformed source
- **THEN** it returns the selected retained catalog prefixed by Default or Default alone on failure, with excluded prompts absent

### Requirement: Desktop persona updates apply to subsequent turns
AI-228, AI-229 and AI-230 SHALL offer filterable System Role selection, Custom Role prompt editing, Personality top_p 0..1 and Reply Quality temperature 0..2 with 0.05 steps, defaults 0.7 and 1, and recovered endpoint labels. Update SHALL persist the selection and apply it to subsequent desktop turns. Existing turns and stored history SHALL retain their pinned prompts and models. Excluded roles SHALL fail validation.

#### Scenario: Update during a turn
- **WHEN** a user changes preset/custom role or sampling and presses Update during a running turn, then reloads the controls and sends again
- **THEN** the active request remains unchanged and the next request uses the persisted new persona and sampling

#### Scenario: Update a device-selected desktop session
- **WHEN** a device key selects a desktop session and the user opens the persona controls and presses Update
- **THEN** the controls read that session's settings and the next desktop turn in that session uses the updated prompt and sampling
- **AND** another key's session and an already admitted request remain unchanged


### Requirement: Selected assistant draft isolation
The desktop SHALL bind persona drafts to their selection generation and reject stale updates. Selected-session edits SHALL stay in memory until key reselection or session eviction, without changing the durable ordinary persona. Saved key configuration SHALL remain the source on key reselection and restart.

#### Scenario: Switch keys while reading or updating
- **WHEN** selection changes from key A to key B while an editor read or Update is pending
- **THEN** the editor discards A's late results and the host rejects A's stale Update without changing B or the global persona

### Requirement: Selected assistant connection ownership
Assistant RPC reads, selection, updates and acknowledgement SHALL respect per-connection selected-session ownership. An unowned selected session MAY be claimed by its first consumer.

#### Scenario: Another window requests selected assistant data
- **WHEN** one connection has claimed a selected session and a second connection requests its settings, transcript, Update or acknowledgement
- **THEN** the second connection receives CHAT.INPUT.INVALID and cannot mutate or consume that selection

### Requirement: Persona catalog resolution
Explicit persona model rows SHALL resolve from the editor's default catalog. An unset persona row SHALL retain main-scope fallback.

#### Scenario: Explicit persona under main model override
- **WHEN** the persona selects a default-catalog row absent from main's override
- **THEN** ordinary desktop inference uses that explicit row, and an unset persona row still follows main's default


### Requirement: Desktop conversation navigation retains the intended persona destination
The desktop MUST use the same session route for assistant key selection and dictation. Desktop New chat and history navigation MUST direct persona reads and Update to the opened conversation, retain session-local persona settings when reopening a key conversation, and reject stale navigation and foreign session ownership without changing a newer key selection.

#### Scenario: Typed and dictated turns continue the selected key conversation
- **WHEN** a wake-window key opens a conversation, the user sends a typed turn, dictates with the same key and reselects that key
- **THEN** the same session and prior turn history remain selected, while a changed direct model profile still creates a separate session

#### Scenario: Desktop navigation moves the persona destination
- **WHEN** the user creates a new chat or opens saved history after a key selected another session
- **THEN** persona reads and Update use the opened destination, ordinary chats use the global persona, reopening a key session retains its local persona, and stale requests cannot replace a newer key selection


### Requirement: Effective persona composer readiness
The desktop composer SHALL derive model readiness from the persona for its opened conversation, using the same main-scope or default-catalog selection as host admission. It SHALL keep missing credentials disabled and discard reads from obsolete navigation or catalog revisions.

#### Scenario: Explicit persona overrides a keyless main model
- **WHEN** the global or selected-session persona chooses a credentialed default-catalog row while the main default has no credential
- **THEN** the mounted composer permits editing and submission using that persona without changing the saved main model

#### Scenario: Persona destination or credentials change
- **WHEN** the user updates the persona, opens New chat or history, or receives a catalog update
- **THEN** readiness follows the opened destination and current catalog, and late reads cannot restore obsolete readiness

### Requirement: Speech draft readiness before saving
Speech settings SHALL prevent incomplete active-provider configurations or credentials from reaching Save. The form SHALL explain missing settings or credentials and SHALL reuse stored credentials only when the provider, workspace and region still match. Main-process validation SHALL remain authoritative.

#### Scenario: Incomplete provider selected
- **WHEN** the user selects DashScope with an empty workspace or a provider without usable credentials
- **THEN** Save is disabled and the form explains the missing input
- **AND** no Save IPC request occurs until the draft is valid

#### Scenario: Existing credentials and changed scope
- **WHEN** credentials are already stored and the user edits only speech language or voice
- **THEN** the form permits saving without a new credential
- **AND** changing provider, workspace or region requires new credentials

#### Scenario: Partial XFY credentials
- **WHEN** the user enters only part of the XFY app ID, API key and secret
- **THEN** Save remains disabled until the complete bundle is valid
