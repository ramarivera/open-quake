# Spec Delta

## Purpose

The recovered DK-Desktop-Clock profile supports a configurable 12/24-hour widget. Its time and lifecycle rules can be specified independently of reverse-engineering new device commands.

## ADDED Requirements

### Requirement: Local time and hour format

The clock SHALL show host-local hours, minutes and date with persisted 24h or 12h format, defaulting to 24h. Twelve-hour display SHALL include AM/PM and display hour 12 at midnight and noon.

#### Scenario: Midnight

- **WHEN** host-local time is 00:05 in 12h format
- **THEN** the clock shows 12:05 AM with the current local date

#### Scenario: Noon and 24h

- **WHEN** host-local time is 12:05 and the user switches between 12h and 24h
- **THEN** the clock shows 12:05 PM in 12h and 12:05 without AM/PM in 24h

### Requirement: Clock profile configuration

The system SHALL offer a DK-Desktop-Clock preset through the profile catalog and save hour-format changes through the profile settings contract without overwriting unrelated key configuration.

#### Scenario: Save and reopen

- **WHEN** a user saves 12h on a clock key and restarts the app
- **THEN** that key retains 12h while other profile fields retain their previous values

#### Scenario: Invalid format

- **WHEN** an imported clock key specifies an unknown hour format
- **THEN** validation identifies the field and rejects that update without changing the active clock

### Requirement: Wall-clock synchronization

Visible clock instances SHALL derive their display from current host wall-clock time on each minute boundary, activation, system resume and timezone change.

#### Scenario: Resume across a date boundary

- **WHEN** the host resumes after midnight with a clock view visible
- **THEN** the first refreshed frame shows the new local date and current minute without replaying elapsed ticks

#### Scenario: Timezone change

- **WHEN** the system timezone changes while management and panel clocks are visible
- **THEN** both show the new local time on their next refresh

### Requirement: Clock lifecycle and motion

The clock SHALL release its schedule when the last clock view closes and SHALL preserve readable time when reduced motion is requested.

#### Scenario: Close all clock views

- **WHEN** the last clock view unmounts
- **THEN** no clock update timer remains active

#### Scenario: Reduced motion

- **WHEN** reduced motion is enabled during a minute transition
- **THEN** the displayed minute changes without a flip animation
