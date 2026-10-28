## ADDED Requirements

### Requirement: Universal key customization

Every key SHALL permit title, icon and move edits regardless of saved basicEditableItems flags, without migrating stored profiles.

#### Scenario: Saved Quick key

- **WHEN** an owner renames, changes artwork, moves to an empty cell or swaps an ordinary key in a saved Quick profile with all edit flags false
- **THEN** the editor and real editing service SHALL permit and persist the edit

### Requirement: Structural protection

Resize and delete restrictions SHALL protect only structural tiles and existing undeletable types. Fixed widget spans SHALL remain enforced. A move SHALL NOT overwrite or displace a structurally protected target.

#### Scenario: Protected target

- **WHEN** a move or replacement intersects a structurally protected tile, including a covered cell
- **THEN** it SHALL fail with locked feedback and preserve the committed profile
