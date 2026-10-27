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

#### Scenario: Application supplies its own tracer

- **WHEN** the application layer installs a tracer before the desktop runtime is assembled
- **THEN** that tracer retains its native span IDs and parent relationships, diagnostics records each completed span once, and the default tracer logger cannot copy raw messages into span events

#### Scenario: Stdout accepts writes without acknowledging them

- **WHEN** stdout accepts writes but never invokes their callbacks
- **THEN** accepted bytes stay within the configured hard cap, excess stdout copies count as dropped, private file output continues, and close returns within the stdout deadline with truthful pending and timeout status
