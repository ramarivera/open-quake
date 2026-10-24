# Proposal

## Why

The clock has empty weather and music slots, and DK-Player has no turntable renderer. Cluster 6 of the 0.4.95 audit records the missing weather service, system session contract and visible controls.

## What Changes

- Add typed weather adapters, manual city verification, opt-in IP lookup, open-meteo forecasts with wttr.in fallback, units, cache and refresh.
- Fill the clock cards and render the full-strip DK-Player from one system-media snapshot and intent controls.
- Specify macOS MediaRemote and Windows SMTC boundaries. Ship explicit unavailable platform stubs. Ramiro approved a separate follow-up to vendor a reviewed MediaRemote helper, tracked in open-quake-lih.7.1.6. Do not install or vendor a native dependency in this PR.
- Expose session/progress/capability state and a volume-overlay insertion point for the knob lane.

## Capabilities

### New Capabilities

- `weather-media`: Weather settings, providers and clock cards; shared system-media state and DK-Player presentation.

### Modified Capabilities

None. Local soundboard sessions remain owned by `soundboard-player`; knob volume remains owned by `knob-model-parity`.

## Impact

Desktop shared Schemas, main-process services and IPC, preload, clock slots, strip registry and Screen settings. No new dependencies, live test calls, local servers or device access. Epic: `open-quake-lih.7.1`, child of `open-quake-lih.7`.
