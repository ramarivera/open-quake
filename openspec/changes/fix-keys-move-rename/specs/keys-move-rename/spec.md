## ADDED Requirements

### Requirement: Selector movement persists and previews the destination

The Move / swap selector SHALL move a key to an empty cell or swap equal-size occupied cells when saved. It SHALL preserve both configurations and reflect the result in the panel preview.

#### Scenario: Move to an empty cell
- **WHEN** a user selects an empty destination and saves
- **THEN** the key persists at that destination and the old cell is empty in the preview

#### Scenario: Swap occupied cells
- **WHEN** a user selects an occupied equal-size destination and saves
- **THEN** the keys exchange coordinates and retain their complete configurations

#### Scenario: Covered destination of a wide tile
- **WHEN** a user moves a wide tile onto a cell covered by an equal-size tile
- **THEN** the editor resolves that tile's anchor, swaps the keys and keeps the moved key selected for subsequent saves

### Requirement: Explain deliberate title restrictions

The editor SHALL explain why a title field is locked by a built-in profile policy. Editable Luminance keys SHALL retain ordinary title editing and persistence.

#### Scenario: Quick Luminance has a title lock
- **WHEN** the selected Luminance key explicitly forbids title editing
- **THEN** the disabled title field has an accessible explanation of the built-in profile restriction

#### Scenario: Editable Luminance title
- **WHEN** a Luminance key permits title editing and a user renames and saves it
- **THEN** the custom title persists and renders in the preview
