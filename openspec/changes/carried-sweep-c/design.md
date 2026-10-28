## Context
Use existing weather results, unavailable runtime guidance, hardware labels and touch cancellation paths. Keep the installer recovery in the smoke script and a testable script helper.

## Goals / Non-Goals
Fix the five reported behaviors with regressions. Do not change CI structure or touch real hardware or owner application state.

## Decisions
Treat weather empty results separately from in-flight loading. Validate local executable files before returning an adapter. Retain CPU fallback with a hardware label. Use the existing controller cancellation semantics for takeover. Bound Windows installer retries and wait for relevant prior installer processes without killing unrelated processes.

## Risks / Trade-offs
Windows native install remains CI-only on this Mac. Mocked process tests verify retry, wait and failure propagation. CPU fallback remains useful but must not claim to be a graphics unit.
