# Device input correctness and independent design directions

## Why
Ramiro reports inverted Y clicks, an unwanted on-device click marker, remaining DK claw text, and a device UI too close to DK-Suite. He asks what the rotating ring does and wants three comparable redesign proposals from three Opus5.5 CLIProxyAPI agents before choosing.

## What changes
Fix input-coordinate consistency and unwanted pointer feedback, replace visible legacy product names while preserving persisted identifiers, and add device-first automated regressions plus structured Effect/Pino diagnostics. Produce three different proposals for the same device home, device knob overlay and management key editor. Ramiro selected Instrument Console for device home and Management Studio, with Scene Rail for the profile selector and knob overlay. Implement that hybrid in production, preserving saved profiles and real actions.

## Impact
Device renderer input, feedback, user-facing branding, existing logging/test routes and a comparison artifact. Physical acceptance remains distinct from synthetic tests.
