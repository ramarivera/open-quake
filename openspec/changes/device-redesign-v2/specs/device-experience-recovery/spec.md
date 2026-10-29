# Spec Delta

## Purpose

Keep the QUAKE device experience responsive and understandable, with complete design coverage, stable product wording and truthful host metrics.

## ADDED Requirements

### Requirement: Device recovery preserves access
Device actions SHALL NOT leave the main event loop blocked by an unowned native dialog. Recovery SHALL preserve saved profiles and report errors through existing scrubbed diagnostics.

#### Scenario: Audio capture cannot start

- **WHEN** an input action cannot acquire its configured audio source
- **THEN** the failure or explicit fallback remains reachable while device and management input continue to work

#### Scenario: Maintenance dialog has no management owner

- **WHEN** a maintenance confirmation, error report, import picker or export picker has no live management window
- **THEN** it cancels without an unowned native dialog or destructive continuation
- **AND** owned message prompts have a 60-second abort limit and accept earlier caller cancellation

### Requirement: Stable current product wording
All default profile names supplied to the device selector SHALL use localized current product wording. The selected profile card SHALL retain a single Apply action, with current state shown separately.

#### Scenario: Installed legacy Agent profile

- **WHEN** the knob selector is built from a saved default DK claw profile
- **THEN** it displays Agent without rewriting the saved identifier or a custom user name

#### Scenario: Browse current and inactive profiles

- **WHEN** the selection moves between the active and an inactive profile
- **THEN** the primary action remains Apply and the Current badge identifies the live profile

### Requirement: Default labels use consistent current wording
English device and Studio labels SHALL use sentence case, correct spelling and current product names while preserving proper names, translated locales, stable lookup keys and explicitly customized titles. Recording status SHALL describe the active state separately from start and stop actions.

#### Scenario: Active meeting and default function labels

- **WHEN** an English meeting view is recording or the user opens default key, media, profile, connection or setup controls
- **THEN** the active status reads Recording and default labels use consistent wording without legacy DK, Dekie or Vivid product names
- **AND** saved custom names and language-specific translations remain unchanged

#### Scenario: Previously saved English default titles

- **WHEN** a saved built-in key still has its pre-rename English default title and a localized thumbnail is requested
- **THEN** its known legacy title resolves through the current locale catalog
- **AND** explicitly edited titles and persisted source data remain unchanged

### Requirement: Host metrics explain unavailable data
Monitoring SHALL start and deliver supported readings when requested. Unavailable or unsupported fields SHALL display an explicit reason without fabricated data or blank unexplained fields.

#### Scenario: macOS temperature unsupported by native collector

- **WHEN** the collector has no supported temperature source
- **THEN** the UI explains the source limitation while independently supported load/memory readings remain usable

### Requirement: Every device screen appears in redesign comparisons
Two Opus5.5 proposals SHALL cover the same full 22-screen inventory, state variants and replacement wallpaper name/backgrounds. Human selection SHALL precede applying a new visual direction.

#### Scenario: Compare complete proposals

- **WHEN** Ramiro opens the previews
- **THEN** both offer all device screens and recovery/unavailable states, at the real device ratio without nested frames


### Requirement: Signal Deck appearance preserves user layouts
All device renderers, overlays and Management Studio SHALL use the selected Signal Deck visual language and coordinated theme roles. Styling SHALL NOT move existing key hit regions, change profile actions, replace custom artwork, or rewrite saved profiles.

#### Scenario: Change between dark and light editor palettes

- **WHEN** the user chooses a Catppuccin, GitHub, Superhuman, Codex, Linear or Notion inspired theme
- **THEN** device and Studio use the coordinated palette with readable text and distinct selection/state colors while stored geometry remains unchanged

### Requirement: Ambient expands the existing background feature
Ambient SHALL retain existing media import, playlist and playback behavior. Additional procedural and music-reactive backgrounds SHALL be additive. A reactive background SHALL use the explicitly enabled background video audio source and SHALL explain absence of that source rather than simulate music as a live measurement.

#### Scenario: Existing background playlist

- **WHEN** a saved Vivid background profile loads after the rename
- **THEN** its default display name is Ambient and its media and actions remain unchanged

### Requirement: Quick actions follow the current host
Untouched built-in shortcut actions SHALL use the current host's platform defaults. Explicitly customized commands, labels, artwork and geometry SHALL remain unchanged. Quick labels SHALL use correct spelling and sentence case except proper product names.

#### Scenario: A default Mac shortcut profile opens on Windows or Linux

- **WHEN** a saved default shortcut still matches its recovered platform template
- **THEN** its action and default label use the current host's counterpart without executing a macOS command on another host

### Requirement: Device controls remain understandable and recoverable
Device brightness SHALL retain its label and explain its knob interaction. A macOS overview opened from the device SHALL be dismissible from the device without executing an unrelated tile. A crashed renderer SHALL reload its existing panel document with bounded retries, without acquiring another hardware owner or changing saved profiles.

#### Scenario: Device panel renderer crashes

- **WHEN** Electron reports an unexpected renderer exit
- **THEN** the same panel reloads and its controls become usable again, while intentional destruction does not restart it

#### Scenario: Host dismisses a witnessed macOS overlay

- **WHEN** Mission Control, Exposé, Apps, Search, Force Quit or screenshot mode opened by the device has a supported visible native window and that window subsequently disappears
- **THEN** the next device input reaches its intended control without sending an unrelated Escape
- **AND** each device observes its own overlay mode and unrelated overlays do not hold cancellation armed
- **AND** failed native reads, modes with no supported visibility signal and unwitnessed openings retain cancellation ownership without a guessed expiry
- **AND** switching directly between Apps and Search clears ownership of the mode that ended without dismissing its replacement
- **AND** a device cancellation consumes its full contact even when dismissal removes the native window before touch release

### Requirement: Studio brightness reflects the selected device
Overview, key-grid and selected-key previews SHALL display the selected physical QUAKE's live brightness readback. Synthetic editor identities SHALL NOT be used as hardware serials. Host brightness SHALL explain the tap-and-turn interaction and unsupported host displays without fabricating percentages.

#### Scenario: Preview and device share a connected QUAKE

- **WHEN** its confirmed display brightness is 100 percent
- **THEN** Studio previews and the device show the same value, and disconnecting clears the live value

#### Scenario: Host brightness readback and tile spacing

- **WHEN** the active connected host exposes a confirmed brightness percentage
- **THEN** its tile displays that percentage in a dedicated value region and places its interaction hint at the bottom
- **AND** failed or unsupported readings clear the previous percentage to Unavailable

### Requirement: Control notices expire
A control-error notice SHALL expire three seconds after the latest failure and fade out over 240 milliseconds, with the transition disabled for reduced motion. Native failures SHALL remain available in diagnostics.

#### Scenario: Repeated unavailable control

- **WHEN** a second failure occurs before the first notice expires
- **THEN** expiry restarts from the new failure and unrelated snapshot updates do not keep the notice visible
