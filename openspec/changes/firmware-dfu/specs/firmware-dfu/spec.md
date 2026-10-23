# Spec Delta

## Purpose

The recovered DFU short command and RP2040 UF2 metadata establish an update starting point. Firmware writing requires its own target validation and completion evidence beyond a successful file copy.

## ADDED Requirements

### Requirement: Confirmed selected-device DFU

The system SHALL enter DFU only for the explicitly selected supported QUAKE device after user confirmation, reject concurrent updates and expose command-sent separately from bootloader-detected.

#### Scenario: Cancel DFU

- **WHEN** the user cancels the confirmation
- **THEN** no HID command is written and the device connection remains active

#### Scenario: Target lost

- **WHEN** the selected device disconnects before confirmation is acted on
- **THEN** the request fails as target-unavailable and is not redirected to another device

#### Scenario: Command without boot volume

- **WHEN** DFU command is sent but no bootloader is detected within 30 seconds
- **THEN** status reports awaiting-bootloader timeout and offers recovery guidance without resending automatically

### Requirement: Validated local firmware images

The system SHALL validate UF2 magic, block count/number consistency, payload bounds, non-overlapping flash target ranges and RP2040 family ID 0x1aa143c7 before writing. Write enablement SHALL also require a trusted QUAKE target descriptor tying the image fingerprint to the selected board and its allowed writable flash ranges; family ID alone SHALL NOT authorize a write. A nonstandard first-header variant SHALL require an explicit compatibility selection and its own verified fixture.

#### Scenario: Wrong family or malformed image

- **WHEN** a selected UF2 targets another family or contains inconsistent block metadata
- **THEN** validation fails and no firmware file is written

#### Scenario: Recovered newline header

- **WHEN** an image uses the recovered nonstandard first-header newline variant
- **THEN** default validation rejects it and explicit compatibility mode accepts only the narrowly supported verified variant

#### Scenario: Compatible family without board evidence

- **WHEN** a structurally valid RP2040 UF2 has no trusted QUAKE target descriptor or writes outside its declared flash ranges
- **THEN** image inspection remains available but write enablement is rejected with a target-validation reason

### Requirement: Boot-volume selection and revalidation

The system SHALL validate a user-selected RP2040 boot volume immediately before write, treat a stored volume bookmark only as a hint and require disambiguation when more than one candidate exists.

#### Scenario: Stale bookmark

- **WHEN** a remembered path resolves to an ordinary data volume
- **THEN** it is rejected and no update file is copied

#### Scenario: Multiple boot volumes

- **WHEN** two compatible bootloader volumes are mounted
- **THEN** the UI asks the user to choose one and does not select the first automatically

### Requirement: Exclusive write lifecycle

The firmware workflow SHALL expose validating, awaiting-bootloader, ready-to-write, writing, written-unverified, verifying, completed, failed and needs-recovery states. It SHALL require explicit write confirmation and SHALL NOT offer a false rollback once writing has started.

#### Scenario: Write fails partway

- **WHEN** the boot volume disappears during copying
- **THEN** status reports needs-recovery with the failed stage and does not retry on another volume

#### Scenario: Cancel before write

- **WHEN** the user cancels in ready-to-write
- **THEN** the workflow closes with no copy operation

#### Scenario: Cancel requested during write

- **WHEN** the user requests cancellation after copying has started
- **THEN** the UI explains the irreversible stage and reports the resulting write/recovery status without claiming restoration of previous firmware

### Requirement: Verified update completion

The system SHALL mark an update completed only after the intended device reconnects and its reported firmware identity matches a validated expected identity. Copy completion or boot-volume disappearance alone SHALL yield written-unverified.

#### Scenario: File copied without identity confirmation

- **WHEN** the copy finishes but the device has no readable or expected firmware identity
- **THEN** status remains written-unverified and the UI does not claim a successful update

#### Scenario: Wrong device reconnects

- **WHEN** a different QUAKE reconnects before the selected target
- **THEN** that device does not satisfy verification for the pending update

### Requirement: Recovery and diagnostics

Failures SHALL identify the stage and stable reason without exposing user file paths or volume credentials in diagnostics. Recovery guidance SHALL describe manual bootloader re-entry and selecting a known compatible image, without an automatic reflash.

#### Scenario: Restart during update

- **WHEN** the app restarts with a persisted nonterminal update record
- **THEN** it reports interrupted/unverified work and requires fresh target/image/volume validation

#### Scenario: Recovery chosen

- **WHEN** a user opens recovery guidance after a write failure
- **THEN** instructions are available locally and no firmware operation starts until a new explicit update is confirmed
