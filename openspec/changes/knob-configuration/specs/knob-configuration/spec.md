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
- **THEN** B's saved slots appear unchanged and rotating right uses only B's committed assignment

#### Scenario: Late release after switch

- **WHEN** profile A starts voice capture, selection switches to B, and A's release arrives
- **THEN** A's capture is cancelled once and B starts no capture or press action

### Requirement: Deterministic rotation and press routing

The system SHALL consume normalized device events without guessing wire values. Counterclockwise SHALL select left and clockwise right. Each detent SHALL use one snapshot and route to a validated focused visible key with supportKnob first, then the directional profile slot, then a rotation-capable center assignment. Focused two-key hotkeys SHALL use action 0 for counterclockwise and action 1 for clockwise. One detent SHALL NOT activate multiple routes. A press SHALL activate only a press-capable center assignment; rotation SHALL NOT start voice capture. When short press and hold share center, the short action SHALL wait until release is classified short; raw press SHALL NOT dispatch it before a possible hold.

#### Scenario: Focused key takes precedence

- **WHEN** a supported focused hotkey and a right-slot navigation action both exist and one clockwise detent arrives
- **THEN** only the focused key's second chord executes

#### Scenario: No selected operation

- **WHEN** no focused supported key, no directional slot, and no rotation-capable center exist
- **THEN** a detent changes neither page nor brightness and executes no host key

### Requirement: First-release panel brightness mode

A center panelBrightness assignment SHALL contain exactly `{type:'stepPercent',value:positive integer from 1 through 100}`, default 5. One clockwise detent SHALL increase the verified current logical panel brightness by the step, one counterclockwise detent SHALL decrease it, and results SHALL clamp to `0..100`. The adapter SHALL convert to its verified native range. Unknown current brightness or missing verified target support SHALL return unavailable without a write. This action SHALL NOT change RGB lighting or an unrelated host monitor. Pressing this mode SHALL NOT change brightness.

#### Scenario: Brightness upper bound

- **WHEN** current panel brightness is 98 and one clockwise detent uses step 5
- **THEN** the panel adapter receives logical value 100 exactly once

#### Scenario: Target unverified

- **WHEN** a recovered brightness preset has no verified panel-target mapping
- **THEN** it remains inactive compatibility data and sends no guessed QMK command

### Requirement: First-release knob page navigation

Navigation assignments SHALL use previousPage or nextPage with no actions, or goToPage with exactly `{type:'page',value:positive integer}`. They SHALL call the active profile's page-selection contract and obey its boundaries. Imported pageUp/pageDown SHALL normalize to previousPage/nextPage only when the import identifies a navigation assignment.

#### Scenario: Right detent at last page

- **WHEN** nextPage is assigned right and the last page is active
- **THEN** the page remains selected and no profile switch occurs

### Requirement: Voice route field sets

An assistant slot SHALL use only the route-specific action fields below, each at most once. Values SHALL be strings and duplicate discriminators SHALL reject new saves. A route requiring a missing runtime SHALL remain saved but unavailable. Credentials SHALL NOT appear in these actions.

| voiceRoute | Allowed records and completeness |
|---|---|
| `direct` | voiceRoute direct, nonempty directProvider, nonempty directModel; both are required before capture |
| `dkclaw` | voiceRoute dkclaw, agentId default main, optional dkclawModel; later runtime required |
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
