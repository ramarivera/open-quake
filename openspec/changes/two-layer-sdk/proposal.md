# Proposal

## Why

Wayfinder ticket `open-quake-2qs.6` opened this change to define the public API
of `packages/protocol` and `packages/device`. Ramiro approved the five SDK design
decisions on 2026-10-23. The protocol kernel and scoped device conductor now share
one set of codecs and errors. Desktop mock replacement and live hardware
acceptance still depend on this API.

## What Changes

- Implement the approved two-layer SDK:
  - `packages/protocol`: pure encode/decode plus Effect Schema definitions for
    QMK Raw HID reports (33-byte framing, `0xA1` JSON / `0xA2` resource /
    `0xA3` short command), no I/O.
  - `packages/device`: conductor wrapper service owning transport, event
    subscription and keep-alive lifecycle, with plain-JS entry points for
    non-Effect consumers.
- Errors follow the `open-quake-errors` catalog convention.

## Capabilities

### New Capabilities
- `device-sdk`: protocol kernel and device conductor public surface.

### Modified Capabilities

## Impact

`packages/protocol`, `packages/device`, later `apps/desktop/src/main/deviceBus.ts`.
Inputs: `.context/decokee-quake-fw/`, `.context/research/dk-suite-feature-inventory.md` section 1.
Beads: epic for this change, `open-quake-2qs.6`.
