## Purpose

Retain useful private local failure evidence from desktop and physical-device acceptance without retaining conversation content, audio or credentials.

## ADDED Requirements

### Requirement: Correlated production operations

The desktop MUST retain locally correlated operation spans and application log events for startup, requests, background work and shutdown. Correlation identifiers MUST originate in the main process. Failures MUST remain observable before the operation converts them into a safe user-facing reply. Delayed asynchronous work MUST retain only the correlation metadata it needs.

#### Scenario: Runtime request fails before safe rejection

- **WHEN** a configured runtime connection operation fails and the desktop returns a safe rejection
- **THEN** local diagnostics retain the original operation failure, stable catalog identity, safe source error identity and generated request and trace identifiers
- **AND** the user-facing reply excludes private original causes

#### Scenario: Production lifecycle owns the destination

- **WHEN** production services acquire resources, process work and finish shutdown
- **THEN** they share the process-owned diagnostics destination
- **AND** shutdown drains accepted records after service finalizers finish

### Requirement: Private bounded storage

Diagnostic storage MUST have finite retention and queue limits and private filesystem permissions. It MUST omit prompt and transcript text, raw audio, credentials, headers, provider URLs, arbitrary exception messages and full source paths. Projection MUST tolerate hostile or malformed values. Storage failures and dropped records MUST be observable without replacing the application result.

#### Scenario: Provider failure contains private data

- **WHEN** a failure contains a provider URL, request content, credential or nested private source message
- **THEN** saved records contain only allowlisted identities, numeric status, bounded cause topology and allowlisted source basenames and locations
- **AND** saved records omit the private values

#### Scenario: Destination is full or unavailable

- **WHEN** the queue reaches its bound or the destination rejects writes
- **THEN** diagnostics bound their memory and disk usage and report loss counters
- **AND** the original application operation retains its own success or failure

### Requirement: Retrievable acceptance evidence

The desktop MUST document how to locate, flush, inspect and locally export an acceptance session's records. The evidence MUST distinguish successful, failed and interrupted operations and identify retention or storage loss.

#### Scenario: Investigate a physical test

- **WHEN** the user finishes a physical test and the application flushes or stops normally
- **THEN** an investigator can locate the private diagnostics directory and follow a generated request through its nested spans and error causes
- **AND** the investigator can detect reported record loss before treating missing evidence as proof
