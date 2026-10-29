## ADDED Requirements

### Requirement: Consistent device input coordinates
Pointer and vendor touch inputs SHALL target the same visible logical location at supported rotations and scales, without an inverted Y click. Ordinary device UI SHALL omit an unintended diagnostic click marker while retaining meaningful pressed and selected states.

#### Scenario: Click maps to its visible target
- **WHEN** a user presses and releases a visible device tile
- **THEN** the corresponding logical tile receives exactly one interaction without a vertical reflection

### Requirement: Independent product wording
Visible product labels SHALL use open-quake or Agent terminology instead of DK claw, preserving compatible stored route identifiers and explicit user content.

#### Scenario: Agent route selection
- **WHEN** a user opens an Agent route or shipped profile
- **THEN** visible default wording uses the current product names while existing data remains usable

### Requirement: Comparable redesign choices
Three independent Opus5.5 CLIProxyAPI agents SHALL produce materially different proposals for the same device home, device knob overlay and management key editor scenes. Human selection SHALL precede a final redesign implementation.

#### Scenario: Compare directions
- **WHEN** Ramiro opens the comparison
- **THEN** all three directions expose all three scenes with equivalent representative content

### Requirement: Device-first tests and safe diagnostics
Automated tests SHALL exercise the mounted device input and feedback paths before management coverage. Structured diagnostics SHALL reuse the existing Effect/Pino pipeline and privacy projection.

#### Scenario: Diagnose routed input safely
- **WHEN** a tested device input is accepted, suppressed or mapped
- **THEN** bounded routing diagnostics can explain the outcome without serials, raw frames, credentials or user text


### Requirement: Selected hybrid production design
The device home and Management Studio SHALL use the selected Instrument Console direction. The profile selector and knob overlay SHALL use the selected Scene Rail direction. Real saved profiles, action execution, localized labels and editor persistence SHALL remain usable.

#### Scenario: Browse scenes without changing the active profile
- **WHEN** the user rotates through available profiles
- **THEN** previous, selected and next destinations are readable, the active profile stays explicitly marked, and existing confirmation behavior controls activation

#### Scenario: Edit an actual key
- **WHEN** a user chooses a key in the Studio mirror or key table
- **THEN** the inspector edits that real key and saves through the existing profile contract


#### Scenario: Preserve explicitly styled key headings
- **WHEN** a saved generic key uses an explicitly styled top, middle or bottom heading
- **THEN** artwork leaves room for its two-line heading at device size and in a scaled Studio preview

#### Scenario: Match page buttons and touch targets
- **WHEN** the Scene Rail spans more than one page
- **THEN** rendered navigation buttons and physical hit tests use the same rectangles and the model and renderer use the same page size


#### Scenario: Hide a saved heading without moving artwork
- **WHEN** a generic key hides its saved heading
- **THEN** heading position and style do not change the default artwork size or placement
