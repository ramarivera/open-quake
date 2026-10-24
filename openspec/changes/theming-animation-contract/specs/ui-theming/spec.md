# Spec Delta

## Purpose
Contract for theming and motion across the panel and management
surfaces. All five design decisions were approved by Ramiro on 2026-10-23.

## ADDED Requirements

### Requirement: Shared theme tokens
Panel and management surfaces SHALL take every authored UI colour from semantic
theme tokens. A typed TypeScript token object SHALL generate the document-root
`--quake-*` CSS custom properties. Built-in dark and light palettes SHALL define
the same complete token set, including readable foreground/background pairs,
muted text, borders, accent/accent text, success, and warning. Exception: the
strip key grid (`strip-key-grid`) reproduces DK-Suite's fixed device palette,
which does not follow the app theme. That palette is one typed object of
recovered colours. Status overlays on the panel keep using theme tokens.

#### Scenario: Theme switch
- **WHEN** the active theme changes from dark to light
- **THEN** both surfaces re-render in the new theme without restarting the app

#### Scenario: Strip grid under the light theme
- **WHEN** the light theme is active and the panel shows a key grid
- **THEN** the grid keeps DK-Suite's black canvas and slot colours while status overlays use light tokens

#### Scenario: Token generation
- **WHEN** a built-in or validated custom palette is applied
- **THEN** each semantic token produces exactly one CSS custom property and neither surface retains the previous palette's values

### Requirement: Validated custom themes
The management surface SHALL accept a JSON theme with `version: 1`, a trimmed
name of 1 to 60 characters, a `dark` or `light` base, and a nonempty `colors`
object of known semantic token overrides. Values SHALL be opaque six-digit hex
colours. Missing overrides SHALL inherit from the base. Unknown keys, versions,
invalid values, malformed JSON, and files larger than 16 KiB SHALL be rejected
before changing the active theme or persisted preference. Imported content SHALL
never be interpreted as CSS, HTML, or a URL. Validation SHALL use `unknown`
narrowing without an explicit `any` type.

#### Scenario: Valid partial custom theme
- **WHEN** the user imports a version-1 theme with a light base and an accent override
- **THEN** the app fills omitted tokens from light, makes Custom selectable, and applies the theme to both surfaces immediately

#### Scenario: Invalid custom theme
- **WHEN** an import contains an unsupported version, unknown token, CSS expression, invalid colour, or malformed JSON
- **THEN** the management view shows a readable validation message and leaves the previous theme and saved preferences intact

#### Scenario: Oversized import
- **WHEN** the selected file exceeds 16384 bytes
- **THEN** the renderer rejects it without reading the file contents

### Requirement: Renderer appearance persistence and synchronization
Theme selection, validated custom theme, and motion preference SHALL be stored
as one versioned localStorage entry under `open-quake.appearance.v1`. Both
renderers SHALL react to storage/BroadcastChannel updates and validate received
preferences. Changes SHALL apply without reload. Invalid persisted data SHALL
fall back to the dark/system defaults. Storage failures SHALL retain a usable
current session with visible feedback and SHALL NOT expose raw causes.

#### Scenario: Restart and cross-window update
- **WHEN** management selects light or imports a valid custom theme
- **THEN** the open panel updates live and a newly opened renderer restores the saved selection

#### Scenario: Broken storage
- **WHEN** the saved entry is malformed or browser storage is unavailable
- **THEN** the renderer remains usable and management explains that defaults were restored or preferences could not be saved

#### Scenario: Preferences become invalid while windows are open
- **WHEN** a storage event supplies malformed or invalid preferences to an already-open renderer
- **THEN** it restores dark/system defaults and shows safe feedback, matching a newly opened renderer

#### Scenario: Invalid broadcast
- **WHEN** a BroadcastChannel message contains invalid appearance preferences
- **THEN** the renderer ignores it and keeps its current appearance

### Requirement: Product surfaces remain truthful
The panel SHALL preserve its stable `open-quake panel` title, knob/touch/keep-alive
statistics, and mock-source indication. Management SHALL retain event diagnostics
and expose theme selection, custom import feedback, and motion preferences.
Future wallpaper/binding/display-event views from inventory section 2 and
settings/wizard/device-management views from section 9 SHALL consume this same
token and motion contract. This change SHALL NOT represent unimplemented
hardware/cloud functions as working controls.

#### Scenario: Prototype without hardware
- **WHEN** the existing mock device stream feeds either renderer
- **THEN** themed statistics remain visible and the UI identifies the source as mock

### Requirement: Cumulative renderer diagnostics
Rotation, press, and received-event totals SHALL accumulate for the lifetime of
the renderer subscription. The renderer SHALL retain at most the latest 100
diagnostic events without decreasing totals or discarding its last keep-alive
sequence when older events leave the log.

#### Scenario: Diagnostic events evicted
- **WHEN** a renderer receives more than 100 events, including rotations, presses, and keep-alives
- **THEN** its log contains only the latest 100 events while totals and the latest keep-alive sequence reflect the entire subscription

### Requirement: Bounded micro-animations
Both surfaces SHALL provide CSS-only micro-animations on changed statistics or
interactive controls when motion is allowed. In the management window and in
status overlays on the panel, motion SHALL use only opacity or transform, last at
most 160 ms, travel at most 4 px, and have no infinite loops or JavaScript
animation loop. The strip key grid and its tiles SHALL instead use DK-Suite's
recovered strip motion (approved parity decision 3, Ramiro 2026-10-23): the 0.3 s
`ease` press that scales a slot to 0.8 with a white glow (SCREEN-034), and, for
later strip widgets, DK's recovered loops and crossfades such as the 4 s dial
tick sweep (SCREEN-044) and the 0.8 s wallpaper crossfade (SCREEN-105). Strip
motion SHALL still be CSS transitions or keyframes and SHALL obey reduced motion.
Keep-alive updates and theme changes SHALL apply immediately without animation.
The panel design target SHALL be 60 Hz with a 16.7 ms frame budget at 1920x480;
hardware timing SHALL be measured separately before claiming that target is met.

#### Scenario: Knob feedback
- **WHEN** a rotation or press changes a visible counter with motion allowed
- **THEN** only that changed value receives a finite opacity/transform animation without moving adjacent layout

#### Scenario: Strip tile press
- **WHEN** a tile on the strip is pressed with motion allowed
- **THEN** its slot scales to 0.8 over 0.3 s while management controls keep the 160 ms budget

#### Scenario: Keep-alive traffic
- **WHEN** a new keep-alive sequence arrives
- **THEN** the status updates without recurring decorative animation

### Requirement: Reduced motion
The app SHALL suppress nonessential animation and transitions when either the
OS requests reduced motion or the in-app Reduce motion override is selected.
The OS preference SHALL be observed live and SHALL take precedence over the
System selection. The override SHALL persist and synchronize between windows.
A CSS `prefers-reduced-motion` rule SHALL also suppress motion.

#### Scenario: OS reduced-motion enabled
- **WHEN** `prefers-reduced-motion: reduce` matches
- **THEN** no non-essential animation runs on either surface

#### Scenario: In-app override
- **WHEN** the OS allows motion and the user selects Reduce motion
- **THEN** both windows suppress animation and transitions immediately and restore the override after reload

#### Scenario: OS setting changes while open
- **WHEN** the OS starts requesting reduced motion while the app is running
- **THEN** both windows stop nonessential motion without reload even when the in-app preference is System
