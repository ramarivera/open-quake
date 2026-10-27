## ADDED Requirements

### Requirement: Retained hardware failure evidence

The application SHALL retain named operation spans and privacy-safe catalog error facts for hardware/input requests and deferred work before recovery. The request SHALL retain its actual trace parent chain and log correlation.

#### Scenario: Hardware action fails after dispatch

- **WHEN** a real hardware consumer using a fake transport fails or is interrupted
- **THEN** private local records identify the operation, actual outcome, safe cause identity and actual trace/span correlation without changing the product result or replaying the action

### Requirement: Process-owned logger delivery

The runtime root SHALL own logger delivery, privacy projection and bounded storage. Approved Pino integration SHALL preserve safe record correlation and retention. Failed optional telemetry SHALL preserve product behavior and expose bounded degradation; shutdown SHALL report its actual drain outcome.

#### Scenario: Inspect an acceptance session

- **WHEN** the hardware test finishes and the application flushes or stops
- **THEN** retained NDJSON connects approved operation facts through actual trace/span IDs, omits private payloads, and reports storage loss or flush failure
