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

- **WHEN** DFU command is sent but no bootloader is detected within 90 seconds
- **THEN** status reports awaiting-bootloader timeout and offers recovery guidance without resending automatically

### Requirement: Validated local firmware images

The system SHALL validate UF2 magic, block count/number consistency, payload bounds, non-overlapping flash target ranges and RP2040 family ID 0x1aa143c7 before writing. Write enablement SHALL also require a trusted QUAKE target descriptor tying the image fingerprint to the selected board and its allowed writable flash ranges; family ID alone SHALL NOT authorize a write. Every block SHALL use standard magicStart0 `0x0A324655` (`"UF2\n"`, bytes `55 46 32 0A`), magicStart1 `0x9E5D5157`, and magicEnd `0x0AB16F30`. No compatibility option is required for the standard newline. Recovered QUAKE images start at `0x00012000`; the audited 01.00.19 and 01.00.21 payload range is `0x00012000..0x0006E7FF`. This evidence SHALL inform the trusted descriptor, without authorizing arbitrary RP2040 images. Evidence: `SETTINGS-047`, `SETTINGS-048`; [Microsoft UF2 specification](https://github.com/microsoft/uf2#file-format), accessed 2026-10-24.

#### Scenario: Wrong family or malformed image

- **WHEN** a selected UF2 targets another family or contains inconsistent block metadata
- **THEN** validation fails and no firmware file is written

#### Scenario: Standard newline magic

- **WHEN** an otherwise valid trusted QUAKE image uses `0x0A324655` as its first magic
- **THEN** default structural validation accepts that standard magic without a compatibility selection

#### Scenario: Null-terminated or incomplete magic

- **WHEN** a block begins with `55 46 32 00` or has the wrong second or final magic
- **THEN** validation rejects it without masking the high byte or writing a file

#### Scenario: Compatible family without board evidence

- **WHEN** a structurally valid RP2040 UF2 has no trusted QUAKE target descriptor or writes outside its declared flash ranges
- **THEN** image inspection remains available but write enablement is rejected with a target-validation reason

### Requirement: Boot-volume selection and revalidation

The system SHALL validate a user-selected RP2040 boot volume immediately before write, treat a stored volume bookmark only as a hint and require disambiguation when more than one candidate exists. Discovery SHALL recognize the vendor bootloader volume label `QUAKE DFU`; a matching label alone SHALL NOT authorize writing. Evidence: `SETTINGS-039`, `SETTINGS-048`.

#### Scenario: Stale bookmark

- **WHEN** a remembered path resolves to an ordinary data volume
- **THEN** it is rejected and no update file is copied

#### Scenario: Multiple boot volumes

- **WHEN** two compatible bootloader volumes are mounted
- **THEN** the UI shows each recognizable drive letter or mount path, asks the user to choose one, repeats the selected drive identity and intended serial in write confirmation, and does not select the first automatically

### Requirement: Exclusive write lifecycle

The firmware workflow SHALL expose validating, awaiting-bootloader, ready-to-write, writing, written-unverified, verifying, completed, failed and needs-recovery states. It SHALL require explicit write confirmation and SHALL NOT offer a false rollback once writing has started.

#### Scenario: Session persistence fails

- **WHEN** saving the initial start, recovery or write transition fails
- **THEN** memory retains the last committed state, no worker or copy starts, and the same action can be retried after storage recovers

#### Scenario: Worker persistence fails

- **WHEN** saving a worker transition fails, including after copying
- **THEN** the session reaches failed or needs-recovery even if saving that terminal state also fails, and never retries a copy automatically

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

#### Scenario: Bootloader without a live firmware session

- **WHEN** the user selects a trusted local image, enters the intended device serial and confirms recovery for a device already in its bootloader
- **THEN** discovery and explicit volume selection work without a normal HID/version session or another DFU command, writing still requires separate confirmation and full image/mount revalidation, and success still requires a fresh expected-version read from that exact serial

### Requirement: Manual version row and recoverable four-step dialog

The system SHALL show the selected serial's version from the typed [2E] query, unknown as `--`, and an Upgrade action only for a newer trusted local image. It SHALL never auto-enter DFU. The 520px dialog SHALL show Enter download mode, Wait for USB drive, Write firmware, Verify version using recovered English strings. Closing SHALL leave the main-owned session running; Settings SHALL reconcile every 1000ms and restore the session. A closed terminal dialog SHALL produce a 6000ms toast. Terminal snapshots SHALL expire after 600000ms. Evidence: SETTINGS-020, SETTINGS-034 through SETTINGS-046.

#### Scenario: Close while upgrading

- **WHEN** the dialog closes during volume discovery or copying
- **THEN** the operation continues, the row shows Upgrading…, and reopening restores its progress

#### Scenario: Re-read completion

- **WHEN** copying finishes
- **THEN** the intended serial is queried every 2000ms with a 3000ms query limit for up to 90000ms; only the expected version completes the update

### Requirement: Conservative volume and copy adapters

Discovery SHALL poll at 500ms for 90000ms and recognize QUAKE DFU on supported platforms. It SHALL validate mount identity and bootloader evidence, settle for 2500ms, and revalidate immediately before an exclusive write. Multiple volumes SHALL require explicit selection. A source image SHALL be rehashed against the trusted descriptor immediately before copying. Partial copy SHALL require recovery with no automatic retries or alternate-volume copy. A macOS user-selected security bookmark SHALL be treated only as a hint. Evidence: SETTINGS-039, SETTINGS-040, SETTINGS-045, SETTINGS-047, SETTINGS-048. Deliberate safety difference: do not reproduce overwriting copy fallbacks or automatic retry after a potentially partial flash.

#### Scenario: Replaced volume or image

- **WHEN** a selected volume identity or inspected image changes before final confirmation
- **THEN** no file is written and fresh inspection is required

#### Scenario: Restart after entry

- **WHEN** a persisted nonterminal record is loaded
- **THEN** the application reports needs-recovery and performs no DFU or write operation


#### Scenario: Bounded descriptor source

- **WHEN** an image path becomes a symlink, a non-file, or grows beyond the size bound during inspection or copy
- **THEN** one no-follow opened descriptor supplies metadata and bounded bytes, the handle is closed, and no untrusted image is copied

#### Scenario: Transient discovery failure

- **WHEN** an optional Windows discovery probe times out or returns malformed data
- **THEN** that poll reports no optional candidates and polling can recover, while copy still requires successful fresh target validation

#### Scenario: Parent replaced before destination open

- **WHEN** a volume path changes between validation and exclusive destination open
- **THEN** opened-file device, resolved containment and parent identity are checked before writing, a changed target is rejected without firmware bytes, and cleanup never deletes an unrelated replacement

#### Scenario: Generic DFU send

- **WHEN** a caller submits DFU through generic hardware send
- **THEN** it is rejected before I/O without poisoning the session, and only the locked enterDfu transition can send DFU without waiting for an acknowledgement
