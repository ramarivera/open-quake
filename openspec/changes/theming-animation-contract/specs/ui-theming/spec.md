# Spec Delta

## Purpose
Contract for theming and motion across the panel and management surfaces of
the open-quake desktop app.

## ADDED Requirements

### Requirement: Shared theme tokens
Panel and management surfaces SHALL take every colour from theme tokens, not
from hardcoded values.

#### Scenario: Theme switch
- **WHEN** the active theme changes from dark to light
- **THEN** both surfaces re-render in the new theme without restarting the app

### Requirement: Reduced motion
Micro-animations SHALL be suppressed or reduced when reduced motion is requested.

#### Scenario: OS reduced-motion enabled
- **WHEN** `prefers-reduced-motion: reduce` matches
- **THEN** no non-essential animation runs on either surface
