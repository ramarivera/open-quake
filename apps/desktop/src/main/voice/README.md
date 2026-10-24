# Voice surface (main)

Implements `openspec/changes/strip-voice-ui` in the main process. The domain
lives in `packages/edge/src/voice/surface/`:

- `voice-surface-contracts.ts` defines the `VoiceSurfaceEvent` union that main
  publishes on `voice:surface`, and the `VoiceSurfaceRequest` union that the
  strip sends on `voice:request`.
- `voice-surface-invariants.ts` holds the pure rules: the feedback table, tile
  status mapping, hold-to-talk classifier, level meter and link validation.
- `hold-to-talk.ts` is the pure reducer for the 1000 ms long press, 350 ms
  grace, 280 ms short tap and 150 ms release guard, plus busy and
  tap-to-cancel.
- `VoiceSurface` dedupes stages per device and capture, derives tones and key
  alerts, tracks the running flow and fans events out.
- `GridVoice` drives the reducer with Clock deadlines and calls the
  `GridVoiceRuntime` port.
- `MockVoiceRuntimeLive` is the scripted runtime. It calls no provider, and
  its replies start with "(mock)".

`index.ts` binds the ports:

- **Publisher.** `BrowserWindow` broadcast, Schema-encoded.
- **Tones.** `createToneRecorder()`. It logs tones and writes no HID.
  hardware-controls (PR #22) exposes
  `HardwareControls.playTone("start"|"end"|"error"|"busy")` with the same
  names; wiring it means passing a `VoiceToneSink` that calls it.
- **Runtime.** The mock in development with `OPEN_QUAKE_MOCK_DEVICE=1`.
  Otherwise `UnavailableRuntimeLive`, so a voice start shows the error
  countdown instead of nothing. knob-push-to-talk's runtime replaces it.

`voice:request` accepts calls only from the app renderer's top-level frame
and rejects anything the Schema does not decode, extra keys included. It
handles:

- `Input`, `Reset`, `SendText`
- `OpenLink` (http/https with a host and no credentials)
- `CopyText`
- `PickFiles` ("Choose file(s) to attach")
- `FocusPanel` (focuses the strip window after 80 ms)
- `ReadAloud`: rejected, because voice-stt-tts owns TTS
- `Hello`: answers with the agent status

## Native smoke

Hidden windows, the built renderer and preload, real IPC, the mock runtime and
mock mic levels; no HID. Captures every overlay stage and the chat tiles at
1920×480:

```sh
pnpm build
pnpm --filter @open-quake/desktop exec electron-vite build --config src/main/voice/smoke.config.ts
OPEN_QUAKE_MOCK_DEVICE=1 env -u ELECTRON_RUN_AS_NODE pnpm --filter @open-quake/desktop exec electron out/voice-smoke/smoke.js /absolute/screenshot/dir
```

Never run it while DK-Suite or another open-quake instance holds the QUAKE.
Real buzzer output, real mic levels and rendering on the physical strip
remain unverified.
