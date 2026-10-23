# Spec Delta

## Purpose

The desktop needs a usable local first-run path and one validated settings model. The recovered app mixes QUAKE, ARIS-68 and account/runtime setup, so parity boundaries must be explicit.

## ADDED Requirements

### Requirement: Resumable local first run

The system SHALL present first-run setup until a local completion record is durably saved. Closing an incomplete wizard SHALL leave it eligible to resume; replaying a completed wizard SHALL require an explicit action and preserve existing configuration.

#### Scenario: First launch

- **WHEN** the application has no completion record
- **THEN** the wizard opens and displays Welcome, locale/region, display, profiles and completion with runtime steps included only when supported

#### Scenario: Close before completion

- **WHEN** the user closes setup after locale selection
- **THEN** the selected locale is retained and the next launch resumes incomplete setup without a completion marker

#### Scenario: Completed replay

- **WHEN** a user reopens setup after completion
- **THEN** existing profiles/settings are loaded and no duplicate profiles are created

### Requirement: Wizard prerequisite handling

The wizard SHALL validate locale, display selection and at least one usable profile before completion, support an explicit desktop-preview choice when QUAKE is absent, and permit supported optional runtime steps to be skipped without blocking local use.

#### Scenario: No device

- **WHEN** no QUAKE is connected during the display step
- **THEN** the user can select desktop preview and continue with a visible hardware-unverified status

#### Scenario: Runtime skipped

- **WHEN** a supported runtime step is skipped
- **THEN** setup continues and completion records that runtime as skipped without installing it

#### Scenario: Completion write fails

- **WHEN** the settings repository cannot save the completion record
- **THEN** the wizard reports persistence failure and stays incomplete

### Requirement: Locale and region choices

The system SHALL offer only translated locales, seed an initial suggestion once from OS locale and an explicitly chosen region, fall back to English when needed, and preserve subsequent user choices. Locale changes SHALL update management and panel views without restart.

#### Scenario: Unsupported OS locale

- **WHEN** first launch reports an untranslated OS locale
- **THEN** English is selected as a fallback and the user can choose another available translation

#### Scenario: User choice survives reseed

- **WHEN** the user selects German and a provider, then region metadata changes
- **THEN** the chosen locale/provider remain and no network geo lookup is required

#### Scenario: Change language

- **WHEN** the user saves an available language
- **THEN** management and panel labels update and restart retains the selection

### Requirement: General preferences

The system SHALL persist launch-at-login, start-hidden and window-size preferences as separate validated values, report unsupported/denied OS changes, and keep a reachable management entry when starting hidden.

#### Scenario: OS rejects login item

- **WHEN** the user enables launch-at-login but the OS adapter refuses
- **THEN** the control reports failure and does not claim the OS setting was enabled

#### Scenario: Stored window off-screen

- **WHEN** a saved window rectangle no longer intersects a connected display
- **THEN** the management window is clamped to a visible display

#### Scenario: Hidden startup

- **WHEN** start-hidden is enabled and the app starts
- **THEN** the management entry remains reachable through its available tray/menu or equivalent application action

### Requirement: Provider configuration

Settings SHALL store provider ID, endpoint, model, temperature and topP with a protected secret reference; validate temperature within 0–2 and topP within 0–1 plus advertised provider constraints; and preserve credentials for other providers when switching.

#### Scenario: Invalid sampling

- **WHEN** the user saves temperature 2.1 or topP below zero
- **THEN** the save identifies the invalid field and preserves the last valid provider configuration

#### Scenario: Provider switch

- **WHEN** a user switches from configured provider A to B and back
- **THEN** A's model/secret reference remain available and no secret value appears in ordinary settings responses

#### Scenario: Unavailable provider

- **WHEN** a saved provider adapter is absent
- **THEN** settings show that configuration as unavailable and require explicit selection rather than silently sending to another provider

### Requirement: Selected-device settings

Device settings SHALL show selected device identity, firmware information and supported controls, apply brightness/backlight/LED changes only through advertised capabilities, and reject invalid values before hardware writes. Read-only, disconnected and pending-confirmation states SHALL be distinct.

#### Scenario: Target changes during save

- **WHEN** device A disconnects and device B becomes selected before A's brightness save completes
- **THEN** the pending write is not redirected to B and A's result is shown as interrupted or unverified

#### Scenario: Unsupported LED mode

- **WHEN** the selected device does not advertise a requested lighting mode
- **THEN** the control reports unsupported and no guessed command is sent

#### Scenario: Write succeeds without readback

- **WHEN** a supported brightness write is accepted but its readback is unavailable
- **THEN** the UI reports requested/unverified rather than confirmed hardware state

### Requirement: Device-specific calibration gate

The system SHALL expose a calibration write only for a selected device with a verified device-specific calibration capability; generic calibration IPC names SHALL NOT authorize a QUAKE calibration operation.

#### Scenario: QUAKE without verified calibration

- **WHEN** QUAKE is selected and no QUAKE-specific calibration contract exists
- **THEN** calibration is unavailable with an explanation and no ARIS-68 command is sent

#### Scenario: Unsupported device family

- **WHEN** an ARIS-68 device is discovered under the proposed QUAKE-only scope
- **THEN** it is shown as unsupported and QUAKE configuration is not applied to it

### Requirement: Settings delegation and local guide

Settings SHALL route wallpaper interval/fill/play controls, monitoring, artwork selection and firmware actions to their owning capabilities and SHALL provide a reopenable local QUAKE guide. Unavailable capabilities SHALL have explicit unavailable states.

#### Scenario: Colorful-screen settings

- **WHEN** the user saves wallpaper fill mode and interval for the selected serial number
- **THEN** the wallpaper capability validates and persists that device's settings without changing another device

#### Scenario: Offline guide

- **WHEN** the user opens the QUAKE guide without network access
- **THEN** bundled usage guidance is readable and can be reopened after closing

#### Scenario: Firmware entry unavailable

- **WHEN** firmware support has not passed its verification gate
- **THEN** settings show an unavailable update action and start no DFU operation
