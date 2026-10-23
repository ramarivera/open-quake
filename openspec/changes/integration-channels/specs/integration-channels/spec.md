# Spec Delta

## Purpose

The recovered channels hub renders a dynamic catalog and setup drawer, but its complete catalog is missing. The replacement must represent available adapters without claiming unverified channel support.

## ADDED Requirements

### Requirement: Verified dynamic catalog

The hub SHALL list only registered channel descriptors with stable ID, label, setup type, required runtime and availability. It SHALL support an empty catalog without inventing entries from integration names.

#### Scenario: No adapters

- **WHEN** no channel adapter is registered
- **THEN** the hub shows an empty state and offers no unsupported setup action

#### Scenario: Unavailable runtime

- **WHEN** an adapter requires a runtime that is not ready
- **THEN** its card reports unavailable with a runtime reason and setup does not start the runtime installation

### Requirement: Descriptor-driven setup

The system SHALL render only setup fields and modes declared by the selected adapter, validate required fields before submission, and keep credentials out of catalog and status responses.

#### Scenario: Missing required token

- **WHEN** a bot-token descriptor is selected and the token is blank
- **THEN** continue/save identifies the missing token and no setup request is sent

#### Scenario: Unsupported setup type

- **WHEN** a descriptor advertises an unsupported setup type
- **THEN** the card reports unsupported setup and no generic credential form is substituted

### Requirement: QR session lifecycle

QR setup SHALL use a distinct session ID with pending, ready, confirmed, expired, cancelled and failed states. Sessions SHALL expire within five minutes or an earlier adapter deadline and SHALL NOT expose QR data after expiry or cancellation.

#### Scenario: Cancel a QR session

- **WHEN** the drawer closes before confirmation
- **THEN** the session is cancelled, its QR disappears and subscriptions are released

#### Scenario: Late progress

- **WHEN** a confirmed event arrives for a replaced or expired session ID
- **THEN** the event is ignored and the current channel is not marked connected

### Requirement: Connection status and configuration

The hub SHALL distinguish configured, connecting, connected, disabled and failed channels. Saving credentials or obtaining a QR image SHALL NOT by itself mark a channel connected.

#### Scenario: Credentials saved without connection

- **WHEN** setup saves valid configuration but the adapter has not verified a connection
- **THEN** the card shows configured or connecting, then connected only after verified adapter status

#### Scenario: Disable then restart

- **WHEN** a channel is disabled and the application restarts
- **THEN** it remains disabled and does not reconnect automatically

### Requirement: Channel removal

The system SHALL require explicit channel removal, release its connection and setup sessions, delete its stored credential reference, and retain unrelated channel state.

#### Scenario: Remove one channel

- **WHEN** a user confirms removal of channel A while channel B is connected
- **THEN** A's local configuration and credentials are removed, A stops, and B remains connected

#### Scenario: Removal fails

- **WHEN** the credential store refuses deletion
- **THEN** the hub reports incomplete removal and permits retry without claiming all credentials were removed
