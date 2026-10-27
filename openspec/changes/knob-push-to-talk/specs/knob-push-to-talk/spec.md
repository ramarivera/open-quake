# Knob push-to-talk

## Purpose

Connect logical knob voice gestures to one correlated capture and response with explicit route configuration and migration.

## ADDED Requirements

### Requirement: Validated voice route variants

The system SHALL define versioned direct, dkclaw, and legacyAssistant variants for logical key `0,1`. Direct SHALL require provider profile ID and model ID; dkclaw SHALL require agent ID and model reference; legacyAssistant SHALL preserve its payload with migration status. Runnable configurations SHALL contain only route-allowed fields and no credentials. Unknown routes SHALL fail validation. First release SHALL enable direct only.

#### Scenario: Agent route unavailable
- **WHEN** a knob configuration selects dkclaw before agent-runtime is enabled
- **THEN** triggering it returns `VOICE.KNOB.ROUTE_UNAVAILABLE` before microphone or provider access and does not fall back to direct

### Requirement: Explicit idempotent legacy migration

The importer SHALL map known aliases, migrate legacy model fields without overriding explicit route fields, and split direct provider/model references at the first slash only. A missing route SHALL become legacyAssistant/needsMigration. Ambiguous profile mappings SHALL become needsConfiguration. Migration SHALL be idempotent and SHALL require preview/save before changing runnable configuration.

#### Scenario: Model ID contains slash
- **WHEN** an explicit direct legacy route contains model `local/org/model-v1`
- **THEN** import resolves provider `local` and model `org/model-v1`, and repeating migration changes nothing

#### Scenario: No route in old assistant data
- **WHEN** imported actions have assistant data but no explicit route
- **THEN** the result preserves that data as legacyAssistant/needsMigration and does not start chat

### Requirement: Snapshot route and correlate input

On hold-start the service SHALL create a capture identity and snapshot device, key, profile revision, and route/provider/model or agent selection. It SHALL consume logical gesture events from the device domain without implementing raw HID decoding. Later route edits SHALL affect subsequent captures only; deleting the active profile SHALL cancel its capture.

#### Scenario: User switches provider during recording
- **WHEN** capture A is listening and the profile route changes from provider X to Y
- **THEN** A dispatches its final transcript to pinned provider X and the next capture uses Y

### Requirement: Release submits one nonempty final transcript

After readiness, hold SHALL capture audio; release SHALL flush once and wait for final transcription. The service SHALL submit exactly one nonempty final transcript to the pinned direct/agent route. Interim text SHALL never dispatch inference. Empty audio or final text SHALL end as empty without a chat request. Duplicate release or STT completion SHALL not create duplicate turns.

#### Scenario: Duplicate release and final callbacks
- **WHEN** one capture receives two release reports and two copies of its final transcript
- **THEN** it sends finish once and creates one response turn

### Requirement: Release before readiness cancels

A release in preparing SHALL latch cancellation and SHALL prevent later mic/provider readiness from starting recording. The UI SHALL distinguish preparing from listening and SHALL not imply that pre-ready speech was captured.

#### Scenario: Slow provider acknowledgement
- **WHEN** hold-start begins setup, release arrives, and task-started arrives later
- **THEN** setup is cleaned up, state stays cancelled, and no audio or transcript is sent

### Requirement: Exclusive capture and re-press

The service SHALL allow one mic owner. Another device SHALL receive `VOICE.KNOB.BUSY`. A new hold-start on the owning device SHALL cancel its old capture/turn and assistant speech, await cleanup for at most two seconds, and then create a fresh capture or fail busy. Input generations SHALL prevent an old release from stopping the new capture.

#### Scenario: Release from previous generation
- **WHEN** capture B starts after cancelling capture A and A's release arrives late
- **THEN** B remains active and only a release matching B's generation can stop it

### Requirement: Bounded capture and lifecycle cleanup

Capture SHALL reuse speech phase deadlines and stop after 60s of listening even without release. A nonempty automatic-stop capture SHALL submit once; its later release SHALL be ignored. Disconnect of the owning device, app shutdown, or profile removal SHALL cancel capture, response, and speech with one terminal outcome. A final transcript accepted by chat SHALL start a separate 60s normal response deadline.

#### Scenario: Device detached while transcribing
- **WHEN** the owning device disconnects before the final transcript
- **THEN** capture ends cancelled, late transcription is discarded, and no response turn starts

#### Scenario: Hold exceeds maximum duration
- **WHEN** listening reaches 60s with nonempty audio
- **THEN** it stops and transcribes once, and a subsequent physical release creates no additional work

### Requirement: Review provider-profile migration

Migration previews SHALL resolve a legacy provider alias to exactly one saved provider profile for its model. Missing or ambiguous matches SHALL be needsConfiguration. Explicit profile IDs SHALL take precedence. Missing agents SHALL never silently become main. Opening a preview SHALL perform no save; confirming a valid direct preview SHALL save only route-allowed references. legacyAssistant replacement UI remains a later task. Audit KNOB-036/037/038/045.

#### Scenario: Ambiguous provider alias
- **WHEN** two saved provider profiles match the imported provider and model
- **THEN** preview preserves the original actions and requires explicit configuration

### Requirement: Pinned direct ownership

The hold-start consumer SHALL read committed profile data and pass its ID, revision and saved direct references into capture. Before microphone access it SHALL resolve a specific saved provider configuration. Route and provider edits SHALL affect only later captures. Removing the pinned profile SHALL cancel capture, response and speech, including a response that has already accepted the transcript. Same-device cancellation SHALL wait at most two seconds; incomplete cleanup SHALL retain ownership and fail busy without opening another microphone. Audit KNOB-038/040/042/043/045/052.

#### Scenario: Stalled cleanup
- **WHEN** same-device cleanup has not finished after two seconds
- **THEN** the next hold fails VOICE.KNOB.BUSY and no successor microphone opens


### Requirement: Saved agent routing before capture
KNOB-032 and KNOB-041 SHALL resolve the committed dkclaw agent/model before microphone permission. Empty model SHALL mean the selected agent default. Unknown saved model options SHALL remain visible without silently selecting a replacement. Ready capture SHALL pin its selected agent/model independently of mutable UI selection and refuse unavailable agents without direct fallback.

#### Scenario: Phase gates and pinned dispatch
- **WHEN** a saved agent knob is held in stopped, starting, disconnected or ready phase
- **THEN** only ready acquires the microphone, uses the saved agent and explicit/default model, and subsequent route edits cannot rewrite that capture
- **AND** stopped, starting and disconnected phases refuse capture with localized phase feedback and one busy tone

### Requirement: Short recognition terminal
KNOB-046 SHALL classify the historical too-short final recognition separately from permission/server failures. For knob captures only, fewer than two Unicode characters, or two characters ending in a period or Chinese full stop, SHALL return idle/empty with exactly one end tone and no chat submission.

#### Scenario: Short speech ends without inference
- **WHEN** a provider returns a short final utterance
- **THEN** capture returns idle/empty, emits one end tone, and submits no chat

#### Scenario: Grid assistant accepts meaningful short speech
- **WHEN** a grid assistant key receives a one-character letter, number or Chinese final utterance
- **THEN** it submits that meaningful text without applying the knob-only historical threshold

### Requirement: Home Assistant knob slot execution
MGMT-213 SHALL preserve the center Home Assistant slot configData through save/import and execute a committed press through the existing validated Home Assistant executor. The unconfigured empty slot SHALL refuse safely. Assistant-routed equipment outcomes SHALL be retained in the response, with no repeated dispatch if later generation fails. Existing admission, identity rechecks and cancellation SHALL remain in force.

#### Scenario: Saved HA press and successful equipment result
- **WHEN** a configured HA center slot is pressed or an admitted assistant turn operates allowed equipment
- **THEN** the saved action executes once and its result remains visible even if response generation is unavailable, while invalid, cancelled or stale work never executes


### Requirement: Assistant route admission consistency
Direct capture SHALL resolve the selected row before choosing its model, use the row model for an empty assistant override, and reconcile known cross-provider models before pinning a followed default. Custom model IDs SHALL remain intact. A changed pinned direct profile SHALL use a separate conversation; an unchanged route SHALL reuse its per-key conversation.

#### Scenario: Changed model or followed provider
- **WHEN** a direct knob changes model or its followed provider changes
- **THEN** capture pins the resolved compatible model and starts a separate session without carrying the previous route's history

### Requirement: Refused capture reservation cleanup
Gateway refusal SHALL terminate the original capture reservation before publishing localized busy feedback.

#### Scenario: Gateway refuses and another key captures
- **WHEN** a gateway refuses a preparing knob capture
- **THEN** no microphone opens for that capture and an unrelated grid key can reserve the released device

### Requirement: Portable equipment assignment validation
Home Assistant assignment validation SHALL use the canonical existing HaKey shape without changing configData bytes.

#### Scenario: Malformed imported equipment assignment
- **WHEN** imported knob configData is valid JSON but fails the canonical HaKey shape
- **THEN** the assignment is rejected before Save or execution and valid configData remains verbatim


### Requirement: Desktop conversation navigation retains the intended persona destination
The desktop MUST use the same session route for assistant key selection and dictation. Desktop New chat and history navigation MUST direct persona reads and Update to the opened conversation, retain session-local persona settings when reopening a key conversation, and reject stale navigation and foreign session ownership without changing a newer key selection.

#### Scenario: Typed and dictated turns continue the selected key conversation
- **WHEN** a wake-window key opens a conversation, the user sends a typed turn, dictates with the same key and reselects that key
- **THEN** the same session and prior turn history remain selected, while a changed direct model profile still creates a separate session

#### Scenario: Desktop navigation moves the persona destination
- **WHEN** the user creates a new chat or opens saved history after a key selected another session
- **THEN** persona reads and Update use the opened destination, ordinary chats use the global persona, reopening a key session retains its local persona, and stale requests cannot replace a newer key selection
