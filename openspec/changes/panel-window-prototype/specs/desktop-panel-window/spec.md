# Spec Delta

## Purpose
How the desktop app picks the QUAKE panel display, which windows it opens, and
how device events reach every renderer surface.

## ADDED Requirements

### Requirement: Panel display selection
The app SHALL place the panel window on the display whose label contains
`DK-QUAKE` case-insensitively, else on a 1920x480 display, else on the primary
display. Label matches SHALL take precedence over size matches. The window
SHALL use the selected display's work-area origin and fit within its work
area, up to 1920x480.

#### Scenario: Labelled display attached
- **WHEN** a display labelled `DK-QUAKE` is connected
- **THEN** the panel window opens at that display's work-area origin

#### Scenario: Mixed-case label and competing size match
- **WHEN** one display is labelled `dK-qUaKe` and an earlier display has size 1920x480
- **THEN** the panel window selects the labelled display

#### Scenario: Size match without a matching label
- **WHEN** no display label contains `DK-QUAKE` and a display has size 1920x480
- **THEN** the panel window selects the 1920x480 display

#### Scenario: No panel hardware
- **WHEN** no display matches by label or size
- **THEN** the panel window opens on the primary display

### Requirement: Panel follows display topology
The app SHALL reselect the panel display after Electron `display-added`,
`display-removed`, and `display-metrics-changed` events. It SHALL move and
resize the existing panel window, or recreate it if it has been destroyed.
It SHALL remove display listeners before quitting.

#### Scenario: Panel display attached after startup
- **WHEN** the app starts on the primary display and a DK-QUAKE display is added
- **THEN** the existing panel window moves to the DK-QUAKE display's work area

#### Scenario: Panel display removed
- **WHEN** the selected DK-QUAKE display is removed and no other display matches
- **THEN** the panel window moves to the current primary display

#### Scenario: Selected display work area changes
- **WHEN** the selected display's work area becomes 1600x400 at a new origin
- **THEN** the panel window moves to that origin and resizes to 1600x400

#### Scenario: Closed panel recreated on topology change
- **WHEN** the panel window has been destroyed and a display is added or removed
- **THEN** a new panel window opens on the selected display and receives subsequent device events

### Requirement: Stable panel window title
The panel window title SHALL remain `open-quake panel` after the renderer
loads, so window-manager rules matching that title keep applying.

#### Scenario: Renderer loaded
- **WHEN** the panel renderer finishes loading
- **THEN** the window title is still `open-quake panel`

#### Scenario: Renderer requests another title
- **WHEN** the panel renderer triggers a page-title update
- **THEN** the app prevents that update from replacing `open-quake panel`

### Requirement: Device events reach both surfaces
Every device event SHALL be delivered to the panel and management renderers
through the `quake:event` IPC channel exposed as `window.openQuake.onQuakeEvent`.

#### Scenario: Knob rotation
- **WHEN** the device bus emits a `rotate` event
- **THEN** both renderers receive it with its `source` field intact

#### Scenario: Window closed
- **WHEN** one window has been destroyed
- **THEN** events are still delivered to the remaining window without error

#### Scenario: Windows reopened on activation
- **WHEN** all windows have been destroyed and the app is activated on macOS
- **THEN** panel and management windows are recreated and subsequent events reach both new windows

### Requirement: Shared typed preload contract
Main and preload SHALL use one discriminated `QuakeEvent` union. The preload
bridge SHALL expose a typed `onQuakeEvent` subscription that returns an
unsubscribe function. Event payloads SHALL preserve `source`, `kind`, and
kind-specific fields without an `unknown` passthrough where a type exists.
The contract SHALL be exported for renderer adoption.

#### Scenario: Typed rotation subscription
- **WHEN** preload delivers a rotation event to a subscriber
- **THEN** the subscriber receives a `QuakeEvent` with `direction` restricted to 1 or -1

#### Scenario: Unsubscribe
- **WHEN** a subscriber invokes the returned unsubscribe function
- **THEN** the corresponding `quake:event` listener is removed

### Requirement: Mock event lifecycle
The prototype mock bus SHALL emit rotation events every 1500 milliseconds,
keepalive events every 3000 milliseconds with an increasing sequence starting
at 1, and press events every 6000 milliseconds. Every emitted event SHALL
carry `source: "mock"`. `stop()` SHALL clear all timers and listeners and be
safe to call repeatedly.

#### Scenario: Mock cadence
- **WHEN** a subscribed mock bus runs for 6000 milliseconds
- **THEN** it emits four rotation events, two keepalive events with sequence 1 and 2, and one press event

#### Scenario: Stop the mock bus
- **WHEN** `stop()` is called and another 12000 milliseconds elapse
- **THEN** no timers or event listeners remain and the subscriber receives no more events

#### Scenario: Remove one subscription
- **WHEN** one of two mock bus subscribers unsubscribes
- **THEN** only the remaining subscriber receives subsequent events
