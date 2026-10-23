# Proposal

## Why

Wayfinder grilling ticket `open-quake-2qs.6`: the public API of
`packages/protocol` and `packages/device` is undecided. Today `protocol` has
framing/checksum helpers and `device` is a skeleton `QuakeDevice` service whose
only method frames a keep-alive ping. The desktop app's mock event bus is
waiting on this API before a real node-hid transport can replace it.

## What Changes

- Decide (via grilling) and then implement a two-layer SDK:
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
