# Spec Delta

## Purpose

Hotkey recording, selected-text actions, and PC-operation actions depend on host input hooks. These need one lifecycle and permission contract so a focused hotkey field cannot leave a global hook running.

## ADDED Requirements

### Requirement: Focused hotkey recording

The system SHALL start hotkey recording only for the focused recorder field, normalize modifiers and main key into a chord, and stop on blur, cancellation or window close. Recorded key events SHALL NOT execute configured actions.

#### Scenario: Record a chord

- **WHEN** a focused recorder receives left-Control plus K then the keys are released
- **THEN** the field shows the normalized Control+K chord and no global action executes

#### Scenario: Lose focus

- **WHEN** the recording field loses focus while a modifier is held
- **THEN** recording ends, transient key state clears, and subsequent host keys are not delivered to that recorder

### Requirement: Explicit global shortcut bindings

The system SHALL register only explicitly enabled bindings and report OS registration conflicts without replacing the previous binding. Repeated keydown events from a held key SHALL invoke a binding at most once until keyup.

#### Scenario: Binding conflict

- **WHEN** the OS refuses a requested global chord
- **THEN** the binding reports unavailable and the previously working binding remains registered

#### Scenario: Held key

- **WHEN** a global chord emits an initial keydown, repeated keydowns and a keyup
- **THEN** its action is invoked once

### Requirement: Permission-aware host operations

The system SHALL report host permission availability separately for recording, selection reading and input injection, and SHALL reject unsupported or denied operations before executing them.

#### Scenario: Permission denied

- **WHEN** a caller requests input injection without the required OS permission
- **THEN** the caller receives a stable permission-denied result and no injection is attempted

#### Scenario: Permission revoked

- **WHEN** a permission is revoked during a recording session
- **THEN** the session ends and its listeners are released

### Requirement: Selected-text requests

The system SHALL read selected text only for an explicit selection action, return an empty-selection result when appropriate, and avoid storing unrelated clipboard content. A temporary clipboard replacement SHALL be restored only if the clipboard has not changed since that replacement.

#### Scenario: No selection

- **WHEN** a selection action runs with no selected text
- **THEN** the caller receives empty-selection and no previous clipboard text is substituted

#### Scenario: Clipboard changes during capture

- **WHEN** another application updates the clipboard after a temporary copy operation
- **THEN** the new clipboard content is preserved and is not overwritten by restoration

### Requirement: Scoped input resources

The system SHALL release owned hooks and bindings on disable, window teardown or application shutdown and SHALL route authorized host actions through the same capability permissions used by desktop controls.

#### Scenario: Recorder repeatedly opened

- **WHEN** the same recorder is opened and closed ten times
- **THEN** only the current recorder receives events and no prior listeners remain

#### Scenario: Unauthorized action

- **WHEN** an automation consumer requests an unpermitted host action
- **THEN** the action is rejected before the host adapter is called
