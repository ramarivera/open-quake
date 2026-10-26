# Spec Delta

## Purpose

Keep QUAKE knob assignments stable across editing and profile changes, with precise routing for brightness, navigation, and direct voice capture.

This contract implements the recommendations approved by Ramiro on 2026-10-23 in `design.md`; it does not assert a verified firmware direction map or brightness scale.

## ADDED Requirements

### Requirement: Reserved knob and stable slots

Each profile SHALL contain at most one knob with `keyCode:'0,1'` and `config.type:'knob'`. Its config SHALL include a common title, icon string, size `[1,1]`, display boolean, and exactly three subActions positions, center at 0, left at 1, right at 2. A nonempty slot SHALL contain `childrenName` and a config with registered type and validated actions, plus optional common title and icon. Empty slots SHALL use `{childrenName:'',config:{type:'',actions:[]}}`. Saves SHALL NOT compact empty slots, duplicate the knob among page keys, or change unrelated keys.

#### Scenario: Right-only assignment survives save

- **WHEN** only slot 2 has nextPage and the user saves and reloads
- **THEN** slot 0 and slot 1 remain empty and nextPage remains in slot 2

#### Scenario: Invalid knob identity

- **WHEN** a new profile contains two reserved knobs or a page key at 0,1
- **THEN** validation rejects the profile without replacing its saved revision

### Requirement: Profile-scoped knob synchronization

Knob edits SHALL save through the profile's revision contract. Page changes SHALL retain the profile's knob. Profile selection SHALL replace all slot editor state and dispatch state from the newly committed profile snapshot. The system SHALL cancel active old-profile voice work and SHALL NOT dispatch a new-profile action from a late old-session event.

#### Scenario: Independent profiles

- **WHEN** profile A's right slot is edited and profile B is selected
- **THEN** B's saved slots appear unchanged and idle rotation uses only B's current profile menu

#### Scenario: Late release after switch

- **WHEN** profile A starts voice capture, selection switches to B, and A's release arrives
- **THEN** A's capture is cancelled once and B starts no capture or press action

### Requirement: Deterministic rotation and press routing

Physical rotation SHALL follow knob-model parity: focused visible supportKnob key, armed available player volume, ready thumbnail picker, then FunctionWheel profile selection. Idle rotation SHALL NOT execute stored left/right slots or a center assignment. Focused hotkeys SHALL use action 0 for decrease and action 1 for increase. Firmware codes are 1 short, 2 double, 5 hold start and 255 hold release; rotation byte 1 is increase. Physical short press SHALL interrupt voice or confirm an open picker, never execute a stored center shortcut. Audit KNOB-001..012/024, SCREEN-071/072, MAIN-029..033; approved GAP-MAP decision 1 supersedes the earlier slot-routing policy.

#### Scenario: Saved slots remain inert on idle turn

- **WHEN** a profile has left/right assignments and no tile is focused or player volume armed
- **THEN** the detent selects a profile through the picker or ring and no stored slot executes

#### Scenario: Focused hotkey

- **WHEN** a visible hotkey with two validated directional actions is focused
- **THEN** a decrease dispatches action 0 once and an increase action 1 once

### Requirement: Voice route field sets

An assistant slot SHALL use only the route-specific action fields below, each at most once. Values SHALL be strings and duplicate discriminators SHALL reject new saves. A route requiring a missing runtime SHALL remain saved but unavailable. Credentials SHALL NOT appear in these actions.

| voiceRoute | Allowed records and completeness |
|---|---|
| `direct` | voiceRoute direct, nonempty directProvider, nonempty directModel; both are required before capture |
| `dkclaw` | voiceRoute dkclaw, explicit agentId or one unambiguous saved agent, dkclawModel; incomplete imports need configuration and the later runtime is required |
| `legacyAssistant` | voiceRoute legacyAssistant, assistant string allowing empty compatibility value; later runtime required |

#### Scenario: Direct configuration

- **WHEN** direct route has valid provider/model references and a configured voice runtime
- **THEN** the slot is available without a DecoKee account or an agentId field

#### Scenario: Incomplete direct route

- **WHEN** directProvider is set but directModel is empty
- **THEN** the editor identifies directModel as incomplete and holdStart requests no microphone capture

### Requirement: Legacy voice migration

For imported voice actions, absent route and aliases assistant/legacy SHALL normalize to legacyAssistant. With an explicit direct route, legacy model value `provider/model` SHALL split at the first slash and fill only missing directProvider/directModel. With an explicit dkclaw route, legacy model SHALL fill only missing dkclawModel. Migration SHALL remove model and out-of-route fields, preserve originals in compatibility metadata, and be idempotent. Unknown route values SHALL remain unsupported with a diagnostic. Built-in route locks SHALL NOT change new custom profiles' selected routes.

#### Scenario: Explicit field wins

- **WHEN** direct actions contain directProvider custom and legacy model old/model/name with no directModel
- **THEN** migration retains provider custom, sets directModel to model/name, removes model, and produces the same result on a second pass

#### Scenario: Legacy runtime unavailable

- **WHEN** an imported profile without an explicit route normalizes to legacyAssistant while that runtime is absent
- **THEN** the slot stays unavailable and is not redirected to direct or dkclaw

### Requirement: Voice capture handoff and cleanup

One normalized holdStart on the reserved knob SHALL invoke the available voice service once with device/session identity, profile ID, revision, and route references. Release SHALL end that capture once. Repeated holdStart for the same active hold SHALL NOT duplicate capture. Disconnect, cancellation, profile change, or capture-start failure SHALL release the session and any microphone resources through the voice service. A hold consumed by voice SHALL NOT also activate the center short-press action.

#### Scenario: Hold and release

- **WHEN** one holdStart, a duplicate holdStart, and release arrive for the same knob session
- **THEN** the voice service sees one start and one end, with no additional center action

### Requirement: Ambiguous compact slot imports

An imported compact slot list whose original left/right positions cannot be determined SHALL remain preserved and unavailable until the user explicitly assigns its slots. Known center-only presets SHALL import at center; explicit empty positions SHALL remain in place.

#### Scenario: Lost slot position

- **WHEN** a two-entry compact legacy array has no reliable slot metadata
- **THEN** import reports ambiguous positions and cannot silently assign the second entry to left or right

### Requirement: Profile-owned desktop knob drafts

The Keys editor SHALL expose independent center, left and right slots for the selected profile. Saving SHALL validate the knob domain, use the expected committed profile revision, and replace only profile.knob. Page selection SHALL retain the knob draft; profile selection SHALL discard it. Idle detents SHALL continue to select profiles and SHALL NOT execute stored slots. Audit KNOB-024/027/035.

#### Scenario: Save a right-only assignment
- **WHEN** a user saves a right assignment with the center and left empty
- **THEN** all three positions persist and all unrelated pages, keys and metadata survive unchanged

#### Scenario: Direct capture readiness
- **WHEN** the saved direct route lacks a model, references a missing provider profile or contains fields belonging to another route
- **THEN** capture is unavailable before microphone access and the editor shows the incomplete selection without adding credentials to actions

### Requirement: Explicit assistant migration and agent selection

The knob editor SHALL assign Assistant with its complete default record and recording/processing/idle preview. Preserved legacy assistant JSON SHALL be visible read-only, including malformed JSON, and SHALL never execute. An explicit migration preview SHALL show the selected supported direct replacement, with cancel leaving the saved profile unchanged and Save committing the replacement idempotently. DK Claw SHALL offer saved agent and model choices including Default Agent and retain an unknown saved model as an unavailable option. Unavailable routes SHALL explain their runtime restriction (AI-041, AI-065, KNOB-034, MGMT-212, MGMT-308).

#### Scenario: Malformed legacy configuration and reviewed replacement
- **WHEN** malformed assistant JSON is opened
- **THEN** its original value remains visible and no runtime starts
- **WHEN** a supported replacement is previewed then cancelled
- **THEN** no write occurs
- **WHEN** the replacement is explicitly accepted and saved twice
- **THEN** the same canonical direct route persists without legacy credentials

#### Scenario: Agent model retention
- **WHEN** an agent is selected or an unavailable saved model is reopened
- **THEN** the local agent/model catalog is offered, unknown saved IDs survive until changed, and Save persists the explicit choice
