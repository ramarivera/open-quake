# Proposal

## Why

The first-release voice loop needs independent STT and TTS adapters with reliable stop, empty-capture, and playback completion behavior. Recovered DK-Suite source and the realtime voice research describe different transports that must share lifecycle rules without conflating their wire protocols.

## What Changes

- Define a capture/transcription state machine, typed phase failures, bounded audio flow, and playback ownership.
- Ship BYO-key DashScope streaming STT and HTTP/SSE TTS against current Model Studio routes (`AI-094`, `AI-101`, `AI-108`), plus an independently selected OpenAI TTS adapter (`AI-105`).
- Define later Qwen realtime TTS, OpenAI transcription/realtime, XFY and Azure adapter gates, and the shipped Meet AI live translation contract (`AI-136/292`).
- Adopt injected clocks/transports/recorders, terminal-event idempotence, privacy-scrubbed diagnostics, and mock-default verification.

## Capabilities

### New Capabilities

- `voice-stt-tts`: audio capture, provider-independent recognition/synthesis, speech wire protocols, and output lifecycle.

### Modified Capabilities

None.

## Impact

Proposed future ownership is `packages/edge/src/voice/` and desktop microphone/player adapters. Credentials reuse `ai-provider-facade`; transcript delivery uses `ai-chat-core`. Knob routing is in `knob-push-to-talk`; soundboard and meeting minutes remain separate. Future transport dependencies need exact catalog pins if essential. This change is spec-only. macOS permissions/audio are day 1; Linux audio integration is day 2.
