# Spec Delta

## Purpose
How the desktop app picks the QUAKE panel display, which windows it opens, and
how device events reach every renderer surface.

## ADDED Requirements

### Requirement: Panel display selection
The app SHALL prefer a confirmed screen-off/on binding, then a unique physical size match, then a unique case-insensitive DK-QUAKE label. Physical pixels SHALL be rounded logical size times scaleFactor, with both dimensions strictly less than 10 pixels from 1920x480 or 480x1920. Ambiguous candidates SHALL remain unbound pending discovery. The strip SHALL use full bounds, above the menu bar, with a stable frameless panel and a logical 1920x480 canvas rotated 90 degrees for portrait. A fallback SHALL fit the primary work area up to 1920x480, remain unrotated, and be visible only in development by default. Sources: MAIN-042, MAIN-050, MAIN-052; approved GAP-MAP decision 7; open-quake-l86.13.

#### Scenario: Scaled strip display
- **WHEN** logical size is 960x240 at scaleFactor 2
- **THEN** it is a physical 1920x480 strip candidate and covers its full logical bounds

#### Scenario: Native portrait strip
- **WHEN** the strip reports 480x1920 physical pixels
- **THEN** the panel canvas rotates 90 degrees

#### Scenario: Tolerance boundary
- **WHEN** a dimension differs by exactly ten physical pixels
- **THEN** size matching rejects it, while a label may still identify a resolution mismatch

#### Scenario: No panel hardware
- **WHEN** no display matches
- **THEN** development can show the primary fallback and release hides it by default

### Requirement: Panel follows display topology
The app SHALL observe add/remove/metrics changes, hide immediately when its bound display disappears, and reuse its existing window during the 3000 ms USB disconnect grace. It SHALL relocate on bounds changes, reload only on rotation changes, recreate destroyed windows, and remove listeners and interrupt recovery on quit. Release SHALL keep an absent strip hidden; development SHALL offer the primary fallback after grace. Sources: MAIN-011, MAIN-012, MAIN-045, MAIN-050, MAIN-053, MAIN-060.

#### Scenario: Brief disconnect
- **WHEN** the device returns within 3000 ms
- **THEN** the existing strip window is reused

#### Scenario: Panel display removed
- **WHEN** the selected strip disappears
- **THEN** its panel hides immediately and a release build does not show it on the primary display

#### Scenario: Strip moved or rotated
- **WHEN** strip bounds or orientation change
- **THEN** the panel follows and reloads only if canvas rotation changed

#### Scenario: Closed panel recreated
- **WHEN** topology changes after the panel was destroyed
- **THEN** a new panel receives subsequent device events

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
