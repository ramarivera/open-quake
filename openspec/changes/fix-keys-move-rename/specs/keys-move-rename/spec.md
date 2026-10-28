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

### Requirement: Titles remain editable and structural rejections remain explained

The editor SHALL allow title customization despite legacy template flags, including Quick Luminance. Structural replacement and swap restrictions SHALL keep the same explanation during preview and Save.

#### Scenario: Quick Luminance title
- **WHEN** a Luminance key has a legacy title restriction and the user renames and saves it
- **THEN** the custom title persists and renders in the preview

#### Scenario: Protected swap
- **WHEN** a move would replace or displace a protected tile
- **THEN** preview and Save both explain the structural protection without changing persisted keys

### Requirement: Hidden-key moves preserve identity

A hidden key SHALL retain its saved identity and selection after a move, and SHALL NOT move into another displayed key's footprint.

#### Scenario: Hidden move into a covered cell
- **WHEN** a hidden one-cell key moves into a cell covered by a displayed wide key
- **THEN** the move is rejected and both saved configurations remain unchanged

### Requirement: Editor drafts retain valid value types and revisions

The editor SHALL preserve generic action value types and SHALL advance a knob draft over key-only saves without accepting concurrent knob changes.

#### Scenario: Legacy blank force flag
- **WHEN** a user changes a blank force flag to 1 and saves a configured close action
- **THEN** the saved force value is numeric and domain validation succeeds

#### Scenario: Key-only revision
- **WHEN** a key save changes the shared profile revision and serializes unchanged knob fields in a different order
- **THEN** the knob save uses the newer revision and preserves its draft

#### Scenario: Page creation introduces an inherited knob
- **WHEN** page creation materializes a default knob while the knob editor is clean
- **THEN** the editor follows the committed knob and revision, while an unsaved knob draft retains conflict protection

### Requirement: Native management exercise targets exposed controls

The management exerciser SHALL exclude descendants of closed disclosures and explicitly open the function-library and JSON import disclosures before checking their controls.

#### Scenario: Emoji navigation and JSON restoration
- **WHEN** the exerciser opens each disclosure and sends native window input to the Emoji button and JSON textarea
- **THEN** Emoji navigation succeeds and the JSON value changes and restores without an obstructed click

### Requirement: Enlarged titles leave room for artwork

Generic tile artwork SHALL reserve two rendered title lines at the configured font size and a gap between the artwork and title.

#### Scenario: Size-12 two-line title
- **WHEN** an ordinary 216 by 216 tile displays a two-line title at explicit size 12
- **THEN** artwork and the top or bottom title block do not overlap
