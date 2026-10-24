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

The serial-scoped knobLedAlwaysOn boolean is a local preference with default true. Saving it does not claim a hardware change. Only a separately verified knob LED adapter can mark it applied, and that adapter must not substitute a global backlight or RGB command. The editor saves locally; the 0.4.95 main process also has a recovered hardware command: `0xA3`, opcode `1`, cmd `0x06`, payload `[0]` off / `[1]` on (`SETTINGS-021`). The hardware-controls-parity adapter sends off on OS lock and on at unlock only when knobLedAlwaysOn is false; true sends nothing (MAIN-025, SETTINGS-021,085). A known command and its protocol acknowledgment do not prove physical LED acceptance.

## Risks / Trade-offs

- Similar QMK values differ across protocol generations. Require capability evidence keyed to firmware and refuse stale bindings.
- Slider events can create a write backlog. Keep at most one pending desired scalar per target/field and ensure an old response cannot overwrite newer state; exact debounce duration is an implementation choice.
- Save acknowledgments may not prove nonvolatile persistence. Hardware verification must include disconnect/reconnect or reboot readback before claiming persistent parity.

## Migration plan

Import only the known serial-scoped boolean and validated settings through a user-selected export. Preserve unsupported values inertly; never replay them on connect. Back up local preferences before a schema update and restore on validation failure. No DK-Suite store is modified. W5 verification uses hid-fake; hardware EEPROM behavior remains unverified.

## Approved decisions and remaining verification

Approved (Ramiro, 2026-10-23): all recommendations above, including later-phase placement, capability-gated controls, explicit Save, target identity rules, and separation of the knob preference from applied hardware state. Actual supported QMK fields, value ranges, v3 bindings, per-key RGB, physical knob LED acceptance, and persistence after reboot remain unverified. The knob LED command itself is known (`SETTINGS-021`), and is not an unknown QMK binding. No new dependencies are proposed.

## L1 lighting contract

Read-only inputs: `/Users/ramarivera/dev/open-quake/.context/decokee-quake-fw/docs/PROTOCOL.md`, its superseding `REVERSE_ENGINEERING.md` command table, recovered `QMKLightingService.js` and `DeviceSettings.vue` cited above, and `packages/protocol/src/qmk.ts`.

The firmware reference describes A3 panel brightness, not a global RGB setter. Its superseding reference says the ring uses the QMK RGB-matrix secondary channel. Never substitute A3 commands 2, 5, 6, or the factory RGB reset for this lighting contract.

| Field | Recovered legacy value IDs | Codec payload | Qualification required |
|---|---|---|---|
| brightness | backlight 0x09 or RGBLight 0x80 | one byte | explicit firmware-scoped integer range within 0..255 |
| effect | backlight 0x0a or RGBLight 0x81 | one byte | explicit firmware-scoped effect ID list, no universal list |
| effectSpeed | backlight 0x0b or RGBLight 0x82 | one byte | explicit firmware-scoped integer range within 0..255 |
| color1 | backlight 0x0c or RGBLight 0x83 | hue, saturation | independently qualified hue/saturation byte ranges |
| color2 | backlight 0x0d | hue, saturation | separate capability and qualified hue/saturation ranges |

These are candidate IDs from recovered source, not claims of support on QUAKE hardware. The device module has no default hardware capabilities. An injected session registry must resolve a selected serial/session to its current private HID locator and a capability snapshot. Every field and Save operation carries evidence matching the selected firmware and protocol identity. Read-only fields are allowed; write-only fields are unavailable because this implementation requires readback. Duplicate fields or wire bindings, mismatched evidence, malformed ranges, and unsupported IDs fail before opening HID.

`packages/protocol` already owns legacy QMK command 8 get, command 7 set, and command 9 save. Get completes only on a matching decoded response of the requested length and validated field value. Set completes on a matching echo followed by matching actual-value readback; an echo alone is insufficient. Save is explicit, waits for pending edits, then requires a matching save echo and readback of the applied snapshot. This reports completion of the qualified save contract, not proof of persistence across reboot. Initial reads do not establish saved state. No automatic Save, retries, or reconnect replay occurs.

Recovered source treats protocol versions >=11 as v3. L1 has no qualified v3 channel/command-byte get/set codec or firmware binding registry. Those sessions expose an unavailable capability snapshot and perform no lighting probes or writes. Follow-up for the parent: add L1 v3 menu codecs and firmware-qualified bindings with get/set/save completion evidence before exposing v3 fields. Per-key RGB remains unavailable. Knob on/off uses the separate hardware-controls-parity cmd 0x06 adapter, outside QMK RGB fields.

The conductor keeps desired values, confirmed applied values, and an optional explicitly saved snapshot. It retains one pending latest value per field and serializes requests. A transport failure leaves desired edits intact; Save failure leaves applied values intact and unsaved. Session changes, detach, cancellation, and response timeout invalidate pending work. Reconnect requires selection of the new session and actual reads. The protocol has no request sequence ID, so abandoning a sent request invalidates its connection rather than reusing it for another matching request.
