# Spec Delta

## Purpose

Define later-phase QUAKE lighting settings that apply only verified controls to an identified device and distinguish local preference saves from hardware persistence.

All behavior is later-phase and follows the decisions Approved (Ramiro, 2026-10-23) in `design.md`; it does not block the first-release logical grid or static wallpaper work.

## ADDED Requirements

### Requirement: Lighting capabilities identify a target

Lighting operations SHALL require a selected identified QUAKE device serial and current connection session. The capability result SHALL declare protocol/firmware identity, readable and writable fields, verified ranges/effect IDs, and binding evidence. Controls SHALL be disabled or unavailable when their capability is absent. A HID path SHALL NOT be persisted as the sole device identity. Panel brightness and RGB/backlight lighting SHALL remain distinct controls.

#### Scenario: Multiple HID interfaces

- **WHEN** enumeration returns several HID paths and only one resolves to the selected serial/session
- **THEN** lighting reads and writes use only that target and no unrelated keyboard receives a command

### Requirement: Validated field values

Supported brightness, effectSpeed, hue, and saturation fields SHALL accept integers within their verified ranges, limited to 0..255 for qualified byte-valued fields. Effect SHALL accept only a verified supported effect ID. Color1 SHALL contain hue and saturation values; color2 SHALL require an independent capability. Noninteger, out-of-range, unsupported effect, and unsupported field writes SHALL fail before transport. A color hex editor SHALL convert to the same validated color model rather than sending the string as a raw command.

#### Scenario: Invalid brightness

- **WHEN** a byte-valued brightness control receives 256 or 1.5
- **THEN** validation reports the field error and the transport receives no write

#### Scenario: Missing second color

- **WHEN** the target supports color1 but not color2
- **THEN** color1 remains editable and a color2 request reports unsupported without a guessed command

### Requirement: Explicit apply and nonvolatile save states

The UI SHALL distinguish desired, applied, and saved-to-device values. Applying SHALL call only verified field operations and update applied state only under the target's qualified completion/readback rule. Saving SHALL use an explicit verified save operation. Apply failure and save failure SHALL retain the user's desired configuration and expose different stable failure codes. A successful local preference write SHALL NOT imply EEPROM persistence.

#### Scenario: Apply succeeds and save fails

- **WHEN** the target accepts a lighting value but rejects its nonvolatile save
- **THEN** the UI reports applied but unsaved, retains the value, and offers an explicit retry of save

### Requirement: Knob LED always-on is a separate preference

The system SHALL persist knobLedAlwaysOn as a boolean per device serial, default true. The preference SHALL remain distinct from global lighting values and hardware-applied state. The recovered knob command is `0xA3`, opcode `1`, cmd `0x06`, payload `[0]` off / `[1]` on (`SETTINGS-021`); the hardware-controls-parity adapter SHALL send off on OS lock and on at unlock only when knobLedAlwaysOn is false. True SHALL send nothing. Evidence MAIN-025 and SETTINGS-021,085. Without a qualified knob-specific adapter, its state SHALL be saved-locally and hardware application SHALL remain unavailable.

#### Scenario: Lock with serial preference

- **WHEN** the selected serial has knobLedAlwaysOn false and the OS locks then unlocks
- **THEN** the adapter sends LED off then on, without a global RGB write; true produces no LED write

### Requirement: Session isolation and reconnect

Detach or target switch SHALL cancel old-session writes and discard stale readback. Reconnect SHALL discover the new session and read verified actual values before allowing further writes. It SHALL NOT blindly replay a saved lighting batch. Pending scalar edits for one field SHALL retain the latest desired value without allowing an older response to overwrite it.

#### Scenario: Target changes during read

- **WHEN** target A's read completes after target B is selected
- **THEN** A's response cannot replace B's settings or cause a write to either target

### Requirement: Unsupported bindings and per-key RGB remain unavailable

Unknown QMK v3 bindings SHALL NOT be discovered through speculative writes as part of normal settings usage. Cached bindings SHALL require matching firmware/protocol evidence. Per-key RGB SHALL remain unavailable until an independently verified per-key mapping and transport are registered. Failure responses SHALL carry stable reason codes and exclude raw HID paths and original cause objects from renderer diagnostics.

#### Scenario: Protocol version without bindings

- **WHEN** a device advertises a newer protocol version but no qualified writable binding
- **THEN** the control reports unsupported and no menu-ID probe writes occur
