## Why

Physical device and speech tests currently rely on console messages that don't reliably retain the original failure or identify the affected request. Ramiro requested usable local Effect logs, spans and error traces before his live acceptance.

## What changes

- Extend the existing Effect logger and native tracer with a bounded private local NDJSON destination.
- Preserve catalog error identities, safe source error codes and nested cause topology without recording conversation content or credentials.
- Inject the same diagnostics destination into every production runtime, including acquisition and shutdown, and assign main-owned request correlation.
- Verify actual connection, voice and HTTP failures before recovery, plus retention, asynchronous correlation and shutdown flushing.
- Document local retrieval and export for physical test diagnosis.

## Capabilities

### New capabilities

- `desktop-local-diagnostics`: private local Effect logging, tracing, correlation, safe failure projection and lifecycle ownership.

### Modified capabilities

None.

## Impact

Desktop main composition and interpreter boundaries gain explicit diagnostics injection. No new dependencies, remote collector, IPC trace schema, provider requests or unattended microphone recording. Existing diagnostic files rotate within fixed limits.
