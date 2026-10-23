# Design

## Context

This completes the lighting item in inventory section 2 at `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`. Lighting is later-phase scope; first-release knob panel brightness belongs to `knob-configuration`. `RS` means `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion/artifacts/recovered_sources/`. S = recovered source, P = partial evidence, N = names only. No hardware reads or writes were performed.

## Goals / Non-Goals

Expose only supported device lighting controls and distinguish saved preferences from hardware state. Do not implement QMK framing, probe unknown firmware fields, change firmware, or claim individual key LEDs from a generic RGB control.

## Evidence ledger

| Item | Tier | Source and observed behavior | Consequence |
|---|---|---|---|
| Lighting API and value IDs | S | `RS/webpack:__dk-suite_src_views_Setting_services_QMKLightingService.js`: BACKLIGHT_BRIGHTNESS 0x09, EFFECT 0x0a, SPEED 0x0b, COLOR_1 0x0c, COLOR_2 0x0d; RGBLIGHT 0x80..0x83; get/set/batch/save IPC methods | Value IDs are evidence for L1 to qualify, not raw QMK command opcodes or universal firmware support |
| UI controls | S | `RS/webpack:__dk-suite_src_views_Setting_DeviceSettings.vue`, qmkLighting, fetchQMKLighting, updateQMKLighting: brightness, effect, speed, hue/saturation, color hex conversion | Model scalar and color capabilities independently |
| Target selection | S | Same source, refreshQMKDeviceList and handleQMKTargetChanged: enumerate HID paths, select target, read protocol version | A selected target is necessary; choosing the first path is not sufficient proof of identity |
| QMK v3 bindings | P | Same source, v3WritableBindings, ensureV3MenuBindings, fetchQMKLighting; service v3MenuGet/Set and v3BindingsGet | Source has dynamic binding machinery, but this task has no validated hardware binding or safe probing sequence |
| Knob LED preference | S | Same source, created/load path and handleLEDAlwaysOnChanged: dkquake.ledConfig plus serialNumber stores a boolean, default true | Inventory store name does not imply a per-key lighting map or successful immediate device write |
| Individual-key RGB | N | Inventory's per-key description is not supported by the inspected global-value service/editor | Keep unavailable until per-key mapping and transport are independently recovered |
| Save path | P | QMKLightingService.saveLighting, saveCustomMenu; DeviceSettings update/read paths | Expose explicit apply/save results; EEPROM persistence and reboot behavior require hardware tests |

## Decisions

### Approved (Ramiro, 2026-10-23): capability-driven later scope

Implement after first-release profile/grid, screen/clock, and knob brightness work. `packages/device` owns lighting-contracts, lighting-invariants, lighting-service, and interfaces for verified target capabilities and transport. `apps/desktop` supplies serial-scoped preference persistence, settings UI, and decoded IPC. `packages/protocol` / `two-layer-sdk` owns QMK get/set/save codecs and wire IDs. Do not change the existing L1 proposal or put raw commands into a renderer.

Use one Effect conductor, declared dependencies, named `Effect.fn` methods, explicit error types, and shared catalog leaves for LightingTargetUnavailable, LightingValueUnsupported, InvalidLightingValue, LightingApplyFailed, and LightingSaveFailed. Keep HID paths out of public diagnostics; keep original causes privately and expose scrubbed safe details. Future RPC surfaces derive from the same schemas.

A capability snapshot identifies device serial, session, protocol version, supported writable/readable fields, ranges, effect IDs, and binding evidence. UI controls derive from it. Brightness, effect speed, hue, and saturation use byte values 0..255 only when that range is confirmed for the field. Effect IDs come from the device's verified list, not a universal hardcoded list. Expose color1 as hue/saturation; optional color2 requires a distinct capability. Hex is an editor representation, not the wire model. Per-key RGB stays unsupported by default.

### Approved (Ramiro, 2026-10-23): targeting and no speculative probes

Select an identified QUAKE serial/session, then request capabilities/readback before enabling controls. A HID path is a session locator, not durable identity. On detach or target change cancel pending writes, discard stale readback, and resolve the serial to a fresh path. Cached QMK v3 bindings must match firmware/protocol identity and carry verified evidence; a version number alone does not authorize speculative writes. Unknown bindings render unavailable. The alternative, probing arbitrary menu IDs automatically, risks changing unrelated settings and is not justified by the source available here.

### Approved (Ramiro, 2026-10-23): desired, applied, and saved states

Keep desired UI values, last applied/read-back values, and nonvolatile save state distinct. Changing a setting applies only to the selected target through a validated field adapter. On failure retain the desired edit and show the prior known applied value; do not report success. An explicit Save requests the verified nonvolatile operation and reports saved only on the target's qualified completion/readback contract. Reconnect reads actual state before replay is considered; no automatic blind batch replay.

The serial-scoped knobLedAlwaysOn boolean is a local preference with default true. Saving it does not claim a hardware change. Only a separately verified knob LED adapter can mark it applied, and that adapter must not substitute a global backlight or RGB command. This distinction follows the recovered editor's local store write.

## Risks / Trade-offs

- Similar QMK values differ across protocol generations. Require capability evidence keyed to firmware and refuse stale bindings.
- Slider events can create a write backlog. Keep at most one pending desired scalar per target/field and ensure an old response cannot overwrite newer state; exact debounce duration is an implementation choice.
- Save acknowledgments may not prove nonvolatile persistence. Hardware verification must include disconnect/reconnect or reboot readback before claiming persistent parity.

## Migration plan

Import only the known serial-scoped boolean and validated settings through a user-selected export. Preserve unsupported values inertly; never replay them on connect. Back up local preferences before a schema update and restore on validation failure. No DK-Suite store is modified and no EEPROM writes occur in this spec-only change.

## Pending decisions and verification

Approve later-phase placement, capability-gated controls, explicit Save, target identity rules, and separation of the knob preference from applied hardware state. Actual supported QMK fields, value ranges, v3 bindings, per-key RGB, knob LED transport, and persistence after reboot remain unverified. No new dependencies are proposed.
