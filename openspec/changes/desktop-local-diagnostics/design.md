## Context

Production domains already use named Effect functions and catalog errors. Default console logging doesn't provide bounded durable evidence. Multiple ManagedRuntime instances and bare interpreter boundaries require one explicit process-owned diagnostics dependency. No remote collector is required.

## Goals / non-goals

Deliver useful local traces for device, voice, runtime and speech acceptance while protecting user content. Preserve existing service ownership and user-facing error handling. This change doesn't implement a remote telemetry backend or establish physical microphone, hearing or device behavior.

## Decisions

Use the existing Effect Logger and native-delegating Tracer with no new dependencies. A single main-process instance owns a private diagnostics directory beneath Electron userData. Each runtime provides its layer using provideMerge so acquisition and finalizers use the same destination. A typed interpreter wrapper adds a fixed allowlisted boundary operation without changing runtime identity or disposal.

Instrument before recovery and IPC projection. Generate opaque request identifiers in main, use native child spans for Effect fibers, and carry only identifiers through Promise and delayed callback context. Renderer input never supplies trace identifiers or operation names.

Project catalog codes, safe source errno/status and bounded cause topology. Discard arbitrary messages, annotations, span attributes and request data. Source frames retain known basename and location only. Four files of 2 MiB and a 512 KiB queue are defaults with hard upper bounds. Directory and files use 0700 and 0600. Persist shutdown health counters; storage failure never changes the application result.

## Risks / tradeoffs

Finite retention can discard old evidence. Export promptly after a test and check loss counters. Unknown source identities are deliberately redacted until added to the allowlist. Multiple runtime instances remain existing architecture; this change unifies diagnostics ownership without consolidating the service graph.

## Validation

Drive actual HTTP, connection IPC and GridVoice failure paths, inspect written records and prove private values absent. Cover acquisition/finalizers, native child spans, Promise boundaries, delayed callbacks, concurrent requests, interruption, bounded storage and idempotent close. Production desktop E2E provides separate live wiring evidence; microphone and hearing remain user acceptance.
