# Spec Delta

## Purpose

Plugin management source and local server names suggest Stream Deck interoperability, but no complete plugin wire protocol has been established. Compatibility needs an explicit evidence gate before real plugins can execute host actions.

## ADDED Requirements

### Requirement: Declared compatibility subset

The system SHALL expose enabled Stream Deck compatibility only when a versioned compatibility descriptor and passing fixture cover manifest parsing, registration, key down/up, action context, settings and feedback. Unverified APIs SHALL report unsupported.

#### Scenario: No verified descriptor

- **WHEN** plugin compatibility has not passed its fixture
- **THEN** the UI reports compatibility unavailable and no plugin process or listener starts

#### Scenario: Unsupported API

- **WHEN** a registered fixture plugin requests an API outside the supported descriptor
- **THEN** the request is rejected as unsupported without mutating key configuration

### Requirement: Local plugin inventory

The system SHALL validate a local plugin manifest before inventory changes, show plugin ID/name/author/version, and support explicit enable, disable, visibility and removal. Plugin visibility SHALL NOT grant execution permission.

#### Scenario: Invalid archive

- **WHEN** an archive lacks its manifest or contains paths escaping its installation directory
- **THEN** installation fails and no files outside the installation root are written

#### Scenario: Hide a plugin

- **WHEN** an enabled plugin is hidden from the key library
- **THEN** its configured runtime policy stays unchanged and visibility alone neither launches nor authorizes it

### Requirement: Loopback listeners and registration

Compatibility listeners SHALL bind only loopback addresses, publish their actual allocated ports and require a launch-specific registration credential tied to an enabled plugin ID. Listener startup SHALL report port conflicts without terminating other processes.

#### Scenario: Bad registration

- **WHEN** a connection provides an unknown plugin ID or invalid launch credential
- **THEN** registration is rejected and no action events are delivered

#### Scenario: Port conflict

- **WHEN** the configured compatibility port is occupied
- **THEN** startup reports the conflict or a newly selected advertised port, and the existing process remains untouched

### Requirement: Action context isolation

The system SHALL route key down/up and feedback by registered plugin, action and context ID, and SHALL reject events or image/settings updates for another plugin's context.

#### Scenario: Key action routing

- **WHEN** a configured key for plugin A receives down then up
- **THEN** only A receives those events with the key's action context

#### Scenario: Cross-context update

- **WHEN** plugin B attempts to set the image on A's context
- **THEN** the update is rejected and A's image remains unchanged

### Requirement: Plugin teardown and protocol separation

Disabling or removing a plugin SHALL stop owned processes, close its sessions and release its contexts. VIA and hardware-remote sockets SHALL NOT become enabled through the Stream Deck compatibility switch.

#### Scenario: Disable plugin

- **WHEN** a user disables a plugin with active contexts
- **THEN** its process/session stops and subsequent key events cannot reach it

#### Scenario: Enable compatibility

- **WHEN** a user enables verified Stream Deck support
- **THEN** no viaPluginPort or hardware-remote listener is opened as a side effect
