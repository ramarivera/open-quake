# Spec Delta

## Purpose

Give users a consistent function library for configuring QUAKE keys and ensure only validated, available functions execute on explicit input.

These requirements record the recommendations approved by Ramiro on 2026-10-23 in `design.md`. Later-phase requirements apply only when their capability is enabled.

## ADDED Requirements

### Requirement: Catalog metadata and availability

Every function SHALL have one stable catalog ID, submenu, legacy aliases, input schema, default key configuration, support flags, edit policy, availability state, permission classification, autonomy policy, and required runtime capabilities. Autonomy SHALL default to never. Editors and dispatch SHALL use the same declaration. Availability SHALL distinguish available, unsupported-on-platform, later-phase, and unresolved. New assignments SHALL deep-copy templates.

#### Scenario: Two instances of one function

- **WHEN** the user assigns two website tiles and changes one URL
- **THEN** the second tile and catalog default retain their original values

#### Scenario: Later function selected

- **WHEN** the user browses a camera or Home Assistant entry without its runtime
- **THEN** the library explains its missing capability and cannot create an executable assignment

### Requirement: First-release leaf action schemas

New leaf keys SHALL use the common schema from `profiles-key-grid` and one of these exact action lists. Unlisted action types or invalid values SHALL reject an executable save. Drafts with empty required values SHALL remain visibly incomplete and SHALL NOT execute.

| Catalog ID and config.type | Ordered config.actions |
|---|---|
| `website` | Exactly `{type:'url',value:string}` containing an absolute http or https URL |
| `hotkey`, supportKnob false | Exactly `{type:'key',value:chord}` |
| `hotkey`, supportKnob true | Exactly two `{type:'key',value:chord}` records, interpreted by the focused knob capability, not as a toggle |
| `text` | `{type:'text',value:string}` with at most 500 Unicode code points, followed optionally by `{type:'key',value:'enter'}`; text must be nonempty to execute |
| `open` | Exactly `{type:'path',value:string}` containing a nonempty selected application reference or absolute application path supported by the host adapter |
| `playPause` | Exactly `{type:'key',value:'audio_play'}` |
| `stopPlay` | Exactly `{type:'key',value:'audio_stop'}` |
| `skipBackward` | Exactly `{type:'key',value:'audio_prev'}` |
| `skipForward` | Exactly `{type:'key',value:'audio_next'}` |
| `fastBackward` | Exactly `{type:'key',value:'audio_rewind'}` |
| `fastForward` | Exactly `{type:'key',value:'audio_forward'}` |
| `repeatPlay` | Exactly `{type:'key',value:'audio_repeat'}` |
| `randomPlay` | Exactly `{type:'key',value:'audio_random'}` |

A chord SHALL be a plus-separated sequence of distinct supported modifier names followed by exactly one supported non-modifier key name. Names SHALL be lowercase machine tokens. The platform adapter SHALL declare supported tokens and reject unsupported ones. A new text key SHALL default to no enter action. Open-app SHALL launch the selected app without interpreting its path as a shell command.

#### Scenario: Text submission option

- **WHEN** a text key containing a line break executes with no enter action
- **THEN** the exact text is inserted once and no additional enter is sent

#### Scenario: Explicit submit

- **WHEN** the same text key has an enter action after the text action
- **THEN** the text inserts first and one enter follows only after insertion succeeds

#### Scenario: Invalid target

- **WHEN** a website action uses a javascript URL, a hotkey contains a capture placeholder, or an open-app action has an empty path
- **THEN** save reports the offending action field and no host operation runs

### Requirement: Media identity and platform support

Media functions SHALL dispatch the validated media action value once. An imported skipForward entry with config.type skipBackward SHALL normalize to skipForward only when childrenName is skipForward and its sole key value is audio_next. An unsupported platform command SHALL report unavailable without falling back to a different media action.

#### Scenario: Recovered next-track alias

- **WHEN** a recovered skipForward tile declares type skipBackward and key audio_next
- **THEN** import retains the original metadata, presents next track, and new canonical saves use config.type skipForward

#### Scenario: Unsupported random play

- **WHEN** randomPlay activates on a platform adapter without audio_random
- **THEN** it reports unsupported and sends no play/pause or random keyboard chord

### Requirement: Explicit input dispatch

Only an available function in the committed active profile/page revision SHALL execute on an explicit logical activation or verified mapped physical activation. A normal key press SHALL dispatch once; release SHALL NOT dispatch a second leaf action. Browsing, rendering previews, importing, saving, moving a tile, or receiving a duplicate publication SHALL execute no host action. Unknown repeated/long-press policies SHALL remain disabled.

#### Scenario: Press and release

- **WHEN** one website key receives a normalized press followed by release
- **THEN** the URL opens once and release opens no URL

#### Scenario: Preview and save

- **WHEN** the user previews an open-app tile and saves its title
- **THEN** no application launches

### Requirement: Host failures preserve configuration and safe diagnostics

Action failures SHALL carry a stable per-reason code and a recoverability state. Unavailable permissions, missing applications, invalid actions, and adapter failures SHALL remain distinguishable. A failed host action SHALL NOT erase the tile or retry an external side effect automatically. Diagnostics sent to renderers or logs SHALL omit configured text, full URLs, private file paths, and original cause objects.

#### Scenario: Application disappears

- **WHEN** a saved app path is no longer available at activation time
- **THEN** the system reports application unavailable, preserves the saved tile, and does not substitute a shell command

### Requirement: Artwork and alternate states

The library SHALL allow an editable key's artwork to reference app-owned assets or a validated user-selected local import. Both windows SHALL show the same reference and missing-artwork fallback. Alternate title/icon SHALL render only for functions with an explicit two-state contract. Changing visuals SHALL NOT change action values. Live function views SHALL require their own available runtime.

#### Scenario: Missing icon

- **WHEN** a local icon becomes unreadable
- **THEN** both windows show a labeled fallback and the saved action payload remains unchanged

### Requirement: hotkeySwitch alternates per press

hotkeySwitch SHALL require exactly two validated key actions. The first committed press SHALL send chord[0], and each subsequent press SHALL alternate between chord[1] and chord[0]. Held duplicates and releases SHALL send no additional chord. Alternate artwork SHALL follow the next state. State SHALL be scoped to the device session and key identity and reset on disconnect. Imported two-chord actions and alternate visuals SHALL survive unrelated saves. Source: MAIN-067; scope approved in the key-library lane on 2026-10-24.

#### Scenario: Imported switch tile

- **WHEN** a hotkeySwitch tile with two valid key actions is imported and receives press, release and press
- **THEN** chord[0] then chord[1] execute once each, and alternate title/icon follows the runtime state

### Requirement: Later catalog coverage

The library SHALL retain an explicit later-phase catalog for luminance/brightness/vol/mute, buzzer, mic, folder, switchProfile/pageNo, close, audio playback, AI and agent views, Home Assistant, camera/printer views, cmd, and system-monitor tiles. Each SHALL declare its owning runtime and remain unavailable until that runtime validates its schema and proves dispatch. Active navigation, panel brightness, and knob voice entries SHALL delegate to their owning first-release capabilities rather than duplicate dispatch.

#### Scenario: Missing monitor backend

- **WHEN** cpuInfo metadata exists but no monitor runtime is installed
- **THEN** the library marks the entry later-phase and shows no fabricated CPU reading

### Requirement: Sequential composite actions

multiActions SHALL contain an ordered non-recursive subActions list of validated available leaf functions and delay steps. A delay SHALL use config.type delay and exactly `{type:'time',value:nonnegative integer milliseconds}`. The runner SHALL execute sequentially, stop on the first failure or cancellation, release held host input, and never replay after reconnect.

#### Scenario: Sequence failure

- **WHEN** a sequence inserts text, waits 1000 ms, fails to open an app, then contains a website action
- **THEN** text and delay complete in order, the app failure is reported, and the website never opens
