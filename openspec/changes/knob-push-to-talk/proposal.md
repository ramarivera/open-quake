# Proposal

## Why

DK-Suite binds knob key `0,1` to three voice routes and contains fixes for release-before-ready races. Open-quake needs one correlated press-to-answer lifecycle before hardware timing can be tested.

## What Changes

- Define direct, dkclaw, and legacyAssistant configuration variants, validation, and explicit legacy migration outcomes.
- Ship the direct route first, pinning profile/provider/model at press time and submitting exactly one final transcript on release.
- Specify duplicate input handling, early release, disconnect, re-press, cancellation, and later agent routing.
- Keep device gesture recognition and raw HID outside the voice conductor.

## Capabilities

### New Capabilities

- `knob-push-to-talk`: knob voice action schema, capture ownership, route dispatch, and migration.

### Modified Capabilities

None.

## Impact

Depends on `voice-stt-tts`, `ai-chat-core`, `ai-provider-facade`, and the device event contract from `two-layer-sdk`. Proposed future owners are `packages/edge/src/voice/knob/`, device/profile event adapters, and desktop route configuration. `agent-runtime` enables dkclaw later. Spec-only; no HID or hardware access. macOS day 1, Linux day 2.
