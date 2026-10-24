## Why

Cluster 11 lacks the hardware controls DK-Suite 0.4.95 exposes. Source recovery now establishes the keyboard, mic, panel luminance, buzzer, LED, power and version contracts. Monitoring currently misuses DK-Suite's gaming-mode name.

## What Changes

- Add typed command/reply codecs and independent golden fixtures.
- Add scoped controls over the existing device connection, query/ack handling, buzzer timing, serial preferences and explicit keyboard routing.
- Add Device settings for firmware information, Knob LED stays on and Device Alert Volume using recovered English labels.
- Rename the monitoring override to monitoring override; correct lighting and SDK claims that these commands are unknown.
- Verify with mock transport only. Hardware qualification remains with the lead.

## Capabilities

### New Capabilities
- `hardware-controls`: source-backed QUAKE commands and settings.

### Modified Capabilities
- `device-lighting-config`: recovered knob LED adapter and lock behavior.
- `system-monitor-tiles`: monitoring override naming.
- `device-sdk`: typed hardware replies and commands.

## Impact

Protocol and device packages, desktop device bus/preload/settings, related OpenSpec artifacts. No new dependencies, firmware writes, DK-Suite execution or physical device access.
