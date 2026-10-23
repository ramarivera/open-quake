# Spec Delta

## Purpose

DK-Suite has a Home Assistant URL/token editor and entity/service configuration. A local integration needs a testable connection and execution contract that works with a user-controlled HA instance.

## ADDED Requirements

### Requirement: Endpoint configuration and secrets

The system SHALL validate an HTTP(S) Home Assistant origin and token reference, keep token values out of ordinary settings responses and diagnostics, and expose disconnected, connecting, connected and failed states.

#### Scenario: Bad origin

- **WHEN** a user saves a file URL or an HTTP URL without a host
- **THEN** the origin is rejected and no connection is attempted

#### Scenario: Authentication fails

- **WHEN** HA rejects the configured token
- **THEN** status becomes failed with an authentication reason and serialized responses contain no token

### Requirement: Scoped certificate policy

The system SHALL validate TLS certificates by default. An explicitly enabled certificate exception SHALL apply only to its configured HA origin and SHALL remain visible in connection status.

#### Scenario: Untrusted certificate

- **WHEN** HA presents an untrusted certificate with no exception enabled
- **THEN** connection fails with a certificate reason

#### Scenario: Exception isolation

- **WHEN** an exception is enabled for HA and a separate provider makes an HTTPS request
- **THEN** the HA exception does not change that provider's TLS policy

### Requirement: Entity and service configuration

The system SHALL list entities by domain and by available room metadata, expose related services and display fields, and validate configured service data against the selected service fields before saving.

#### Scenario: Select by room

- **WHEN** an entity with room metadata is selected through the room grouping
- **THEN** the saved target contains its stable entity ID rather than its display name

#### Scenario: Invalid service field

- **WHEN** a numeric field exceeds the service's advertised maximum
- **THEN** the configuration is rejected with that field identified and the prior key configuration remains

### Requirement: Shared execution path

The system SHALL execute direct key actions and accepted AI intents through one validated HA action path, returning separate success, rejected and dependency-failure outcomes. Unvalidated natural-language text SHALL NOT execute a service.

#### Scenario: Configured action

- **WHEN** a key targets a currently available entity/service with valid data
- **THEN** exactly one matching service request is sent and its outcome reaches the key and desktop consumers

#### Scenario: Invalid model intent

- **WHEN** an AI response names an unknown entity or service
- **THEN** the action is rejected and no HA service request is sent

### Requirement: Connection loss and retry

The system SHALL mark entity state unavailable when disconnected, allow explicit reconnect, and avoid automatic replay of state-changing requests whose outcome is unknown.

#### Scenario: Disconnect during action

- **WHEN** the connection drops after sending a state-changing request before its result arrives
- **THEN** the caller receives an unknown-outcome failure and reconnect does not resend it

#### Scenario: Reconnect

- **WHEN** a user reconnects after HA becomes available
- **THEN** entities/services are refreshed before connected status permits a new action
