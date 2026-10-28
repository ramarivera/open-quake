## ADDED Requirements

### Requirement: Helper copy adds information
The management renderer and panel overlays SHALL omit subtitles, descriptions and hints that only repeat headings, labels or visible actions. Useful constraints, consequences, next steps, setup instructions, units, current status, warnings, empty-state guidance and functional accessibility text SHALL remain.

#### Scenario: A description combines filler and behavior
- **WHEN** the knob group explains configuration and idle rotation
- **THEN** only "Idle rotation selects profiles." remains

#### Scenario: Removed copy has translations
- **WHEN** a helper line is removed
- **THEN** its unused key is removed from every bundled locale containing it and no empty subtitle element or reserved subtitle space remains
