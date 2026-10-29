# Spec Delta

## Purpose

Keep the QUAKE device experience responsive and understandable, with complete design coverage, stable product wording and truthful host metrics.

## ADDED Requirements

### Requirement: Device recovery preserves access
Device actions SHALL NOT leave the main event loop blocked by an unowned native dialog. Recovery SHALL preserve saved profiles and report errors through existing scrubbed diagnostics.

#### Scenario: Audio capture cannot start
- **WHEN** an input action cannot acquire its configured audio source
- **THEN** the failure or explicit fallback remains reachable while device and management input continue to work

### Requirement: Stable current product wording
All default profile names supplied to the device selector SHALL use localized current product wording. The selected profile card SHALL retain a single Apply action, with current state shown separately.

#### Scenario: Installed legacy Agent profile
- **WHEN** the knob selector is built from a saved default DK claw profile
- **THEN** it displays Agent without rewriting the saved identifier or a custom user name

#### Scenario: Browse current and inactive profiles
- **WHEN** the selection moves between the active and an inactive profile
- **THEN** the primary action remains Apply and the Current badge identifies the live profile

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
