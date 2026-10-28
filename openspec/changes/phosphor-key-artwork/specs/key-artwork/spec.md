## ADDED Requirements

### Requirement: Keys icon library opens from the editor
The management Keys editor SHALL open its owned icon library when the user
clicks Icon Library for an editable key.

#### Scenario: Open and choose artwork
- **WHEN** the user clicks Icon Library for a selected editable key
- **THEN** the library opens and offers Phosphor alongside existing icon sets
- **AND** selecting artwork updates the current draft through the existing bridge

#### Scenario: Browse from a locked built-in Quick key
- **WHEN** the selected key locks icon editing and the user clicks Icon Library
- **THEN** the library opens and the editor explains the artwork lock
- **AND** a returned selection cannot change the locked key's draft or saved artwork

### Requirement: Built-in semantic artwork uses Phosphor
The renderer SHALL resolve built-in numeric IDs and type defaults using Phosphor
artwork, preserve custom artwork, and ignore inherited object properties.

#### Scenario: Built-in and library references
- **WHEN** numeric or library references resolve for built-in keys
- **THEN** every built-in profile tile has semantic artwork
- **AND** microphone and buzzer off-state artwork differs from the primary

#### Scenario: Brightness and Discord microphone mute
- **WHEN** panelBrightness or numeric 0-103 artwork resolves
- **THEN** it uses brightness or microphone-mute artwork respectively

#### Scenario: Prototype property names
- **WHEN** an icon or type is named constructor, toString or __proto__
- **THEN** the renderer uses only owned mappings or its fallback without throwing
