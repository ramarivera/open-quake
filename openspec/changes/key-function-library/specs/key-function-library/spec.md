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
| `text` | `{type:'text',value:string}` with at most 500 Unicode code points, followed optionally by a supported keyboard chord or media token in `{type:'key',value:string}`; text must be nonempty to execute |
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

#### Scenario: Text follow-up uses its owning adapter

- **WHEN** saved text includes an optional supported keyboard chord or media token
- **THEN** its owning adapter capability is checked before insertion, exact text inserts first, and the follow-up dispatches only after insertion succeeds
- **AND** an unavailable follow-up prevents insertion without falling back to another command

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

#### Scenario: Selected device changes without a saved profile
- **WHEN** the Keys editor receives a different device serial without an active profile or page
- **THEN** the editor uses the same first visible profile and first page as the strip, replacing the previous device's profile and page together
- **AND** changing devices discards the previous device's unsaved key even when both devices use the same effective page
- **AND** returning to the previous device or removing its active selection recalculates its effective selection

### Requirement: Saved native runtime actions
The saved-key consumer SHALL dispatch close, cmd, managementCenter, screenshot and lock through typed native boundaries. MAIN-066, MAIN-068, MAIN-069, MAIN-070, MAIN-071, MAIN-072, MAIN-082, MAIN-097, MGMT-158, MGMT-196 and MGMT-210 apply.

#### Scenario: Saved actions use their real host owners
- **WHEN** an authorized committed key activates a native action or sequence step
- **THEN** its decoded parameters reach the host boundary once, cancelled approval performs no launch, and errors produce scoped INVALID feedback without changing the saved key
- **AND** Clipboard paste SHALL preserve rich supported formats, wait 50 ms, restore only when the clipboard still belongs to the paste, then execute the saved optional second chord.
- **AND** Website templates SHALL substitute the key title without evaluation, add http:// for missing schemes and reject unsafe schemes.
- **AND** Close SHALL match exact executable identity and recheck the PID before termination.
- **AND** Cmd SHALL use the profile command approval owner, bind approval to exact saved content and require approval again after edits.
- **AND** Opening an existing app SHALL focus it without another launch.
- **AND** Screenshot SHALL capture all displays to Pictures with collision-resistant screenshot-<ms>-<capture>-<i>.png names and exclusive creation; Windows command+l SHALL call LockWorkStation.

### Requirement: Ordered saved composite execution
MAIN-076, MGMT-163, MGMT-206 and MGMT-210 sequences SHALL accept subActions-only imports, validate every step before execution, await native and plugin completion in order, apply each gap with default 100 ms, and stop on cancellation or the first failure.

#### Scenario: Nested plugin action completes before the next native action
- **WHEN** a saved sequence contains delay, plugin and native steps
- **THEN** TestClock-controlled delay and awaited plugin completion precede the last native effect, progress follows completed steps, and cancellation or plugin failure prevents remaining effects
- **AND** Close, playAudioLegacy, stopAudio and cmd SHALL enter their existing owners.
- **AND** A typed plugin port SHALL receive the committed parent activation plus plugin id, action and step index.
- **AND** Until the plugins lane registers a runtime, it SHALL fail with typed KeyFunctionUnavailable, code QUAKE.ACTION.UNAVAILABLE and reason plugin-runtime.
- **AND** MAIN-066 plugin inventory and MAIN-076 remain partial until that registration lands.

#### Scenario: Audio validation precedes every sequence host effect
- **WHEN** text precedes malformed playAudioLegacy in a saved sequence
- **THEN** soundboard-owned configuration validation rejects the sequence before text insertion or playback
- **AND** valid playback and payload-free stopAudio preserve the sequence order through their existing owner

### Requirement: Scoped timer completion and feedback
MAIN-075, MAIN-081, MGMT-138 and MGMT-404 timers SHALL store an absolute endAt scoped to device, profile, page, revision and key.

#### Scenario: Expiry, clear and restart preserve timer ownership
- **WHEN** TestClock advances a saved timer to zero, the user clears it and then activates it again outside the debounce window
- **THEN** zero persists through the first activation, the clear emits no host operation, the next activation starts a new endAt, and obsolete profile/page/revision completion cannot alert or callback
- **AND** Expiry SHALL retain zero until one activation clears it without restarting.
- **AND** Duplicate timer activation within 600 ms SHALL be ignored.
- **AND** The saved callback=1 SHALL emit exactly one typed completion for a still-active matching timer; callback=0, cancellation, revision replacement and disconnection SHALL emit none.
- **AND** Inactive timers SHALL retain zero for return without late alarm/audio/callback.
- **AND** STOP=0 clears alerts, INVALID=1 expires after 2000 ms, ALARM=2 retains zero without an alarm icon and CHECKMARK=3 remains until cleared.
- **AND** Progress below zero hides, progress 100 expires after 1000 ms, and changed incomplete progress expires after 5000 ms.

### Requirement: Saved folder and profile navigation
MAIN-077, MAIN-078, MGMT-142 and MGMT-170 SHALL reuse allocated profile pages for folder/createFolder and Back, retain nested return contexts, and restore the prior profile/page after emojiBack. Invalid or stale destinations SHALL not select a fallback. switchProfile SHALL honor profile/page, -1 next, -2 previous and 0 default, skip empty or hidden groups and wrap in numeric profile order. Slides 0/1/2/3 SHALL use previous page/next page/previous group/next group.

#### Scenario: Nested folders and default profile use the committed selection
- **WHEN** saved folder and Back keys navigate nested allocated pages, or a slide or switchProfile key changes selection
- **THEN** the existing selection owner commits the target once, restores its runtime state, and leaves selection unchanged for stale destinations

### Requirement: Native action recovery and ownership
Native actions SHALL preserve clipboard data on failed setup and interruption, canonicalize application filesystem identity before matching, and keep command approval bound to the current saved revision and device session.

#### Scenario: Failed paste setup preserves data
- **WHEN** clipboard clear or temporary write fails after a snapshot, or paste work is interrupted
- **THEN** cleanup restores the snapshot while the clipboard still belongs to that paste and returns typed scrubbed failures
- **AND** concurrent clipboard edits remain intact

#### Scenario: Saved command revision replaces approval
- **WHEN** a command is edited away and back, imported or restored into a replacement revision, or activated in a different device session
- **THEN** the shared direct and sequence command owner requires confirmation again
- **AND** repeated activations within the same approved saved revision and session reuse approval

#### Scenario: Canonical applications and explicit Linux focus limits
- **WHEN** Open or Close targets a symlink or a differently cased path on a case-insensitive volume
- **THEN** matching uses filesystem identity and rechecks the exact PID before focus or termination
- **AND** distinct identities on case-sensitive volumes remain distinct
- **AND** Linux focus reports unsupported outside X11 or without xdotool and never launches a duplicate as fallback

#### Scenario: Sequence normalization and replacement cleanup
- **WHEN** a sequence includes a website template or an edited timer revision replaces running work
- **THEN** website steps normalize against the parent title before any host effect, unsafe schemes reject the entire sequence, and the first activation starts the new timer
- **AND** clearing expired zero retires pending alarm work so the next activation starts a timer
