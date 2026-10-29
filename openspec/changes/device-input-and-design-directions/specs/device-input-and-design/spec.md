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
