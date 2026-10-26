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
- **Tones.** `main/index.ts` passes `toneSinks(createToneRecorder(), …)`.
  The second sink calls hardware-controls' `HardwareSession.playTone`, which
  applies the alert volume and the buzzer switch. The mock bus answers it
  without HID.
- **Runtime.** The mock with `OPEN_QUAKE_MOCK_DEVICE=1`. Otherwise
  `UnavailableRuntimeLive`, so a voice start shows the error countdown
  instead of nothing. knob-push-to-talk's runtime replaces it.
- **Knob.** `registerVoiceSurface(...).knobVoice` is the knob model's `voice`
  binding. Hold starts a `0,1` capture, release releases it, a short press
  interrupts, and a hold while a grid key holds voice is busy ("Previous turn
  still running").

`voice:request` accepts calls only from the app renderer's top-level frame
and rejects anything the Schema does not decode, extra keys included. It
handles:

- `Input`, `Reset`, `SendText`
- `OpenLink` (http/https with a host and no credentials)
- `CopyText`
- `PickFiles` ("Choose file(s) to attach")
- `FocusPanel` (focuses the strip window after 80 ms)
- `ReadAloud`: routes the cached answer to the configured speech controller,
  toggling its serial/key owner. `ReadAloudState` reports thinking, speaking
  and idle independently of capture.
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

## Capture, focus, read-aloud and meeting parity smoke

The parity smoke mounts the built strip in a hidden window. It checks the
100 ms blur timer and ownership cleanup, read-aloud toggle/FX through real
speech IPC, and stages 0–5 from the real meeting pipeline. Capture, synthesis,
output and meeting adapters are fake. Native FocusPanel is intercepted so
this test never activates a window or uses the microphone or speakers.
It saves meter, pill and meeting screenshots plus `parity-evidence.json`.

After `pnpm build`, use an absolute scratch directory for `TMPDIR` and the
final argument:

```sh
pnpm --filter @open-quake/desktop exec electron-vite build --config src/main/voice/parity-smoke.config.ts
TMPDIR=/absolute/scratch env -u ELECTRON_RUN_AS_NODE OPEN_QUAKE_MOCK_DEVICE=1 pnpm --filter @open-quake/desktop exec electron out/voice-parity-smoke/parity-smoke.js /absolute/scratch
```

Effect TestClock regressions live in `main/speech/runtime-levels.test.ts`,
`main/speech/read-aloud.test.ts` and edge's `ai/speech/speech-watchdog.test.ts`.
They check exact emission, VAD and watchdog boundaries independently of native
renderer scheduling. Live providers and physical device behavior remain open.
