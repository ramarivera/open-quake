# Spec Delta

## Purpose

The icon picker and template panel expose local artwork selection and imports. A stable resource contract is needed so editing artwork does not silently claim an unverified emoji-to-device pipeline.

## ADDED Requirements

### Requirement: Stable local artwork catalog

The library SHALL expose built-in and imported artwork with stable resource IDs, name, type, provenance and preview status, support browsing/searching by group/name, and report missing resources without substituting unrelated artwork.

#### Scenario: Library search

- **WHEN** the user searches within imported artwork
- **THEN** only matching imported entries appear and selecting one returns its resource ID

#### Scenario: Missing imported file

- **WHEN** an imported resource's backing file is missing
- **THEN** its preview shows unavailable and existing key assignments retain the ID for repair

### Requirement: Validated file imports

The system SHALL import decoded PNG/JPEG and sanitized static SVG files, cap each file at 20 MiB and raster dimensions at 8192 pixels per axis, and reject malformed, scripted or externally referencing artwork before catalog mutation.

#### Scenario: Valid local import

- **WHEN** a supported image is imported
- **THEN** the file is copied into managed storage and its resource ID remains valid after the original file moves

#### Scenario: Unsafe or oversized import

- **WHEN** a selected SVG includes a script or external resource, or an image exceeds a limit
- **THEN** that file is rejected with a reason and no active catalog entry is created

### Requirement: Batch templates and duplicate handling

Template imports SHALL return a result per selected file, preserve successful imports when another file fails, and require an explicit reuse/rename/replace choice for an existing imported name rather than overwriting it silently.

#### Scenario: Mixed batch

- **WHEN** two valid templates and one malformed file are selected
- **THEN** the valid templates are added, the invalid one is reported and existing templates remain

#### Scenario: Duplicate name

- **WHEN** a template name already exists
- **THEN** the user is offered reuse/rename/replace and cancellation preserves the existing file and ID

### Requirement: Transactional artwork selection

Selecting artwork for a key or wallpaper SHALL update only the explicit target through its owning configuration contract. Cancelling selection or losing that target SHALL leave current assignments intact.

#### Scenario: Choose for one key

- **WHEN** the picker opened for key A applies a resource
- **THEN** A references that resource and key B remains unchanged

#### Scenario: Stale picker target

- **WHEN** the target key is deleted before the picker applies
- **THEN** apply reports target-unavailable and does not update a different key

### Requirement: Resource deletion and ownership

Built-in resources SHALL remain immutable. Deleting an imported resource SHALL require replacement or unlinking of active references and SHALL report backing-file deletion failures.

#### Scenario: Referenced artwork deletion

- **WHEN** the user tries to delete an icon used by a key
- **THEN** deletion identifies the references and requires replacement/unlink before removal

#### Scenario: Unreferenced template deletion

- **WHEN** the user deletes an unreferenced imported template
- **THEN** the catalog and managed file are removed and related views refresh

### Requirement: Display-delivery evidence boundary

The library SHALL distinguish a saved local artwork assignment from device-delivery status and SHALL report unverified or unsupported delivery when the active display adapter lacks a verified conversion/transfer contract.

#### Scenario: Local emoji image selected

- **WHEN** a generated image is assigned while emoji packaging is unresolved
- **THEN** the local preview works and physical delivery remains explicitly unverified

#### Scenario: Delivery failure

- **WHEN** an artwork assignment saves but device transfer fails
- **THEN** the assignment remains saved and the transfer error is shown separately
