# Spec Delta

## Purpose
How the desktop app picks the QUAKE panel display, which windows it opens, and
how device events reach every renderer surface.

## ADDED Requirements

### Requirement: Panel display selection
The app SHALL place the panel window on the display whose label contains
`DK-QUAKE`, else on a 1920x480 display, else on the primary display.

#### Scenario: Labelled display attached
- **WHEN** a display labelled `DK-QUAKE` is connected
- **THEN** the panel window opens at that display's work-area origin

#### Scenario: No panel hardware
- **WHEN** no display matches by label or size
- **THEN** the panel window opens on the primary display

### Requirement: Stable panel window title
The panel window title SHALL remain `open-quake panel` after the renderer
loads, so window-manager rules matching that title keep applying.

#### Scenario: Renderer loaded
- **WHEN** the panel renderer finishes loading
- **THEN** the window title is still `open-quake panel`

### Requirement: Device events reach both surfaces
Every device event SHALL be delivered to the panel and management renderers
through the `quake:event` IPC channel exposed as `window.openQuake.onQuakeEvent`.

#### Scenario: Knob rotation
- **WHEN** the device bus emits a `rotate` event
- **THEN** both renderers receive it with its `source` field intact

#### Scenario: Window closed
- **WHEN** one window has been destroyed
- **THEN** events are still delivered to the remaining window without error
