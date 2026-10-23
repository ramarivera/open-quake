# Design

## Context

Settled by the wayfinder map (`open-quake-2qs`): Effect devs first, non-Effect
devs covered; protocol layer uses Effect Schema only; governing skills are
`effect-conductor`, `open-quake-errors`, `effect-best-practices`.

## Open decisions (grill before implementing)

1. Naming of the public modules and exports.
2. Error catalog integration: which `Schema.TaggedError` leaves the protocol and device layers expose.
3. Event subscription shape: `Stream`, `PubSub`, or callback for the plain-JS layer.
4. Keep-alive lifecycle ownership: device service fiber vs. caller-managed scope.
5. Plain-JS entry point form: Promise facade, `ManagedRuntime`, or both.

Requirements in `specs/device-sdk/spec.md` cover only what is already settled;
add the rest once these are answered.
