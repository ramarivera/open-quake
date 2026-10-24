## Context

Evidence: dark-encyclopedia `dk-suite-introspeccion/v0.4.95/audit/AUDIT_MAIN.md` MAIN-015,018..026,096; AUDIT_KNOB KNOB-066,067; AUDIT_SETTINGS SETTINGS-021,022,077,078,080..082,085. Main source is `app-resources/background.js`, methods sendTriggerKeyBoard, changeDeviceMicState, changeDeviceLuminance, _playTone, _playSequence, _sendLEDSettings. Renderer is recovered_sources/src/views/Setting/DeviceSettings.vue:39..88,199..216,632..676. Labels are locales/locale-en.json. These are local research inputs, not distributed source.

Firmware `.context/decokee-quake-fw/docs/PROTOCOL.md` confirms set/query framing and version bytes but incorrectly labels 0x06 BUZZER and keyboard modifier byte as id. Prefer the demonstrated main-process call sites. No vendor source is copied.

## Decisions

Reuse the opened QuakeConnection for writes and typed broadcast replies. A hardware conductor owns one serialized query/ack transaction at a time. Generic ack has no originating command ID; timeout or interruption poisons the transaction channel until reconnect, preventing a late ack from confirming another mic change. Every set command consumes its ack, including keyboard, LED and buzzer writes, so their acknowledgments cannot confirm a later mic toggle. Query replies match the expected feature. No speculative writes or retries.

Default hotkey route is device at app launch, with explicit host mode and no silent fallback for unsupported tokens. Map USB HID keyboard usages and eight modifier bits, reject multiple non-modifier keys because the command has one usage byte. Atomic chords hold for 50 ms then release even on interruption. A reusable keyboard adapter drives the existing ActionService.

Use serial-scoped preferences, never HID paths. Defaults: buzzer true, alert volume 84, LED always-on true. Desktop persistence is validated atomic JSON. Session-only keyboard mode is never saved. Mic and brightness snapshots come from queries; mic changes only after success ack 0x90. Screen and LED writes report transport delivery only, never physical confirmation.

Buzzer tone playback serializes sequences. Every step sends its level, waits duration, sends zero, then waits 10 ms, including silent steps. Nonzero levels use the configured alert volume. Cancellation always sends zero. Preview is debounced 300 ms and uses 80/80/80 ms steps. Persist preference changes after 500 ms; flush on scoped teardown.

Settings extend existing theme/layout components with labelled native controls and loading/offline/error states. The mock session is explicitly labelled. No firmware upgrade control is added in this lane.

## Verification

Golden full HID reports, strict invalid command/reply cases, codec properties, real QuakeDevice plus hid-fake, Effect TestClock for ack timeout, chord release, tones and debounce, desktop IPC authorization and native mock screenshots. Real USB keyboard output, mic, luminance, buzzer acoustics, LED and power effects remain unverified.

## Reconstruction discrepancies

The host method sendTriggerKeyBoard and firmware input/report.c:442..510 agree on action/modifier/usage ordering and actions 0/1/2. The reconstruction loops i<7 despite an eight-byte modifier list; the host table sends right_command=128. Keep all eight wire bits and leave physical right-command behavior for lead qualification.

Firmware protocol/quake_protocol.c:140..144 claims uStack_44=0x900055 but reconstructs bytes as 55,90,00. Little-endian 0x900055 is 55,00,90, which agrees with the host handler. The reconstructed C assignments transpose cmd/sub. The typed successful ack follows demonstrated host semantics 55/00/[90].

## Review round 1 concurrency boundaries

Connection teardown stops new hardware writes and drains started native writes before closing the handle. Only native writes resist cancellation; ordinary reply waits remain interruptible. Preview replacement waits for each started buzzer exchange to consume its ack before cancelling the remaining tone steps.

Preference flushes serialize and finish each started atomic store write before another snapshot can commit. Replaced debounces coalesce to the latest preferences, including teardown. The renderer holds desired volume locally and coalesces queued changes while leaving the range enabled whenever the session is available. Successful ready polling clears transient request errors. Device serial display remains intentional inside the local management window, with no logging or network transport.
