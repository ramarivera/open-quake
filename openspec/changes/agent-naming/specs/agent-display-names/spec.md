## ADDED Requirements

### Requirement: Localized runtime-neutral agent labels
The application SHALL use localized Agent labels for the agent profile, key type, knob route and panel in all eight supported locales. Shared runtime connection and failure messages SHALL refer to the agent runtime. OpenClaw-specific setup and local process controls SHALL retain the program name.

#### Scenario: Runtime-independent labels
- **WHEN** the user selects the agent profile, key type or knob route in any supported locale
- **THEN** its label uses the localized Agent name and contains neither DK-Claw nor DK Claw
- **AND** no label implies that a runtime executes on QUAKE

### Requirement: Saved profile compatibility
Display naming SHALL preserve profile IDs, key types, route values and saved data. Persisted built-in default names SHALL resolve to the current localized catalog name, while explicit custom names SHALL remain visible without a migration.

#### Scenario: Persisted legacy default
- **WHEN** a saved built-in profile has a legacy DK Claw, DK-Claw or DK龙虾 name
- **THEN** the UI shows the current localized Agent name without rewriting the saved profile

#### Scenario: Custom name
- **WHEN** a profile has a user-chosen name
- **THEN** the UI preserves that name across locale changes
