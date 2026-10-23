# Tasks

This entire change is later-phase. First-release panel brightness belongs to knob-configuration, not these tasks. The parent creates one epic and one issue per checkbox with this directory and its verification evidence linked.

## 1. Later-phase capability contract

- [ ] 1.1 Record Ramiro's decisions on target identity, explicit Save, no speculative probes, and local-only knob preference semantics; verify design.md retains unknown hardware fields/bindings as unverified.
- [ ] 1.2 Agree supported lighting capabilities and get/set/save completion semantics with L1 without changing codecs here; verify each field has firmware-scoped ranges, effect IDs, binding evidence, and explicit unsupported behavior.
- [ ] 1.3 Add lighting Schemas, invariants, and conductor interfaces in packages/device; verify invalid byte values/effects/color2 reject before transport and catalog failures retain private causes with scrubbed serialization.

## 2. Later-phase target and settings integration

- [ ] 2.1 Add serial/session-based target selection, actual-state reads, stale binding rejection, and cancellation; verify a late response from target A cannot replace target B's state and unknown v3 bindings cause no probe writes.
- [ ] 2.2 Add capability-derived brightness/effect/speed/color controls and desired/applied/saved states in desktop; verify apply-success/save-failure remains applied-but-unsaved, unsupported fields are unavailable, and private HID paths do not leak; document field semantics.
- [ ] 2.3 Add the serial-scoped knobLedAlwaysOn preference with local/applied distinction; verify restart persistence, default true, and no global RGB write when a knob-specific adapter is absent.
- [ ] 2.4 Add latest-desired-value handling and explicit nonvolatile Save through L1; verify old slider responses cannot overwrite newer edits, detach cancels old writes, and reconnect reads without blind batch replay.

## 3. Hardware and integration evidence

- [ ] 3.1 On available hardware, qualify every exposed lighting field, target selection, and save/reboot readback; verify firmware/range/binding and persistence evidence is attached and leave unsupported/per-key/knob-specific behavior unverified until separately proven.
- [ ] 3.2 Run settings-consumer integration scenarios and repository gates; verify OpenSpec validation, catalog diagnostics, capability boundaries, and documented unsupported fields before closing implementation issues.
