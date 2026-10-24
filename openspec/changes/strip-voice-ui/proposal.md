# Proposal

## Why

On the QUAKE, a voice press shows nothing. DK-Suite 0.4.95 covers the strip
with a waveform backdrop, cyan subtitles and a mic bar that follows the real
microphone level. It walks through stage texts, counts errors down 3-2-1, and
beeps and flashes the key. Its AI keys hold-to-talk with timing filters, and
the DKClaw and AI Copilot profiles render conversations on the strip itself.
`knob-push-to-talk` and `voice-stt-tts` specify capture and recognition but
not what the strip shows. The audit ranks this as GAP-MAP cluster 4: AUDIT_KNOB
top gap 3, AUDIT_SCREEN top gaps 5 and 8, AUDIT_AI top gaps 1–3 (bead
`open-quake-lih.5`).

## What Changes

- Add a voice surface contract. The voice runtime publishes stage, level and
  chat events, plus key alerts and toasts. Main dedupes the events, derives
  device feedback and fans them out to the strip.
- Add device feedback for a voice press. DK's buzzer tone patterns play
  through a tone port bound to hardware-controls' `playTone`. The pressed key
  flashes the DisplayEvent alert. The knob model's voice binding drives knob
  captures.
- Add the full-screen voice overlay for the knob voice key `0,1`: waveform
  backdrop, dim, cyan subtitle band, mic mountain bar, stage texts, 3-2-1
  error countdown, busy text, localized in DK's eight locales.
- Add hold-to-talk on `aiChat` keys and on `clawbot` keys with voice input.
  A pure state machine applies the 1000 ms long press, 350 ms release grace,
  280 ms short tap and 150 ms duplicate filter, plus busy rejection and
  tap-to-cancel.
- Add the AI key decorations: cancel indicator, clawbot active dot, strip
  toasts.
- Add the on-strip chat tiles: AI Copilot (`aiChatView`, 5×2), ClawBotView
  (`quakeBot`, 4×2) and ClawBotInput (`quakeBotInput`, 2×2). They render
  ai-chat-core turn state as escaped React text, never HTML.
- Add a scripted mock voice runtime, enabled only by
  `OPEN_QUAKE_MOCK_DEVICE=1`, for development and the native smoke.

## Capabilities

### New Capabilities

- `strip-voice-ui`: voice surface events, device feedback, full-screen overlay,
  mic bar and level meter, hold-to-talk, AI key decorations, the three chat
  tiles, localized strip copy, and the mock runtime.

### Modified Capabilities

None. This change consumes `knob-push-to-talk` (capture identity, release
semantics), `voice-stt-tts` (capture phases), `ai-chat-core` (chunks, turn
reducers, safe content), `strip-key-grid` (tile registry, `tileAt`) and
`strip-touch-input` (strip key events) without editing their requirements.

## Impact

- `packages/edge/src/voice/surface/` is new: contracts, invariants, hold-to-talk
  and the `VoiceSurface` and `GridVoice` services.
- `apps/desktop/src/main/voice/` is new: IPC, preload bridge, tone port and mock
  runtime. `main/index.ts` gains one registration call.
- `apps/desktop/src/renderer/src/strip/overlays/voice/` and
  `strip/tiles/{aiCopilot,clawBot,clawBotInput,voiceKey}/` are new.
- `StripScreen` gains an HTML overlay slot and a per-tile overlay hook, and
  `tileRegistry` gains five entries plus a voice field in the tile context.
- No dependencies are added; property tests use the `FastCheck` module
  re-exported by `effect`.
- Hardware is unverified: real buzzer output, real mic levels and rendering on
  the physical strip.
