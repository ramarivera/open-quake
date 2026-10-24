# Design

## Context

Sources are read-only. `V` = `~/dev/dark-encyclopedia/dk-suite-introspeccion/v0.4.95/`,
`RS` = `V/recovered_sources/src/`, `BG@N` = character offset N in
`V/app-resources/background.js`.

Abbreviations:

| Short | File |
|---|---|
| QSV | `RS/views/DKQuake/QuakeScreenView.vue` |
| QSC | `RS/views/Components/QuakeShortCutView.vue` |
| AED | `RS/views/Components/AIAudioEventDisplay.vue` |
| WFV | `RS/views/Components/WaveformView.vue` |
| SMB | `RS/views/Components/SttVoiceMountainBar.vue` |
| ACV | `RS/views/Components/AIChatIconView.vue` |
| GEO | `RS/views/Components/GlowEnergyOrb.vue` |
| QBV | `RS/views/Components/QuakeBotIconView.vue` |
| QBI | `RS/views/Components/QuakeBotInputIconView.vue` |
| DEV | `RS/views/DKQuake/DisplayEvent.vue` |

Audit rows come from `V/audit/AUDIT_AI.md`, `AUDIT_KNOB.md`, `AUDIT_SCREEN.md`
and `AUDIT_MAIN.md`. Strings come from `V/locales/locale-*.json`. Nothing here
ran DK-Suite or touched the QUAKE.

## Goals / Non-Goals

Goals:

- Everything the strip shows during a voice press.
- The device feedback that accompanies it.
- Hold-to-talk on AI keys.
- The three on-strip chat tiles.

Non-goals, each owned elsewhere:

- Capture, STT and TTS providers (`voice-stt-tts`).
- The knob voice route and its capture lifecycle (`knob-push-to-talk`).
- Chat sessions and history (`ai-chat-core`).
- The agent runtime and its connection state (`agent-runtime`).
- Touch decoding and sub-element gestures (`strip-touch-input`, PR #20).
- The knob dial and FunctionWheel (knob model, PR #24).
- Buzzer HID writes and the alert volume setting (hardware-controls, PR #22).
- The meeting pipeline and meeting tiles (cluster 15).

This change defines the seams those owners plug into.

## Voice surface events

DK sends `aiAssistStageChange {stage, status, data, keyCode}`,
`aiAssistAudioSpectrum {keyCode, rms, speaking}` and `aiChatResponse` over the
device socket (AI-077, KNOB-054, SCREEN-116). open-quake replaces the numeric
codes with one Schema union, `VoiceSurfaceEvent`, published by main to every
window over `voice:surface`:

| Tag | Fields | DK origin |
|---|---|---|
| `Stage` | serial, keyCode, captureId, stage | `aiAssistStageChange` |
| `Level` | serial, keyCode, captureId, rms ∈ [0,1], speaking | `aiAssistAudioSpectrum` |
| `TurnStarted` | serial, keyCode, sessionId, turnId, prompt, source voice/typed, agent | `aiChatView:userOutgoingMessage`, voice snapshot |
| `Chunk` | serial, keyCode, ai-chat-core `ChatChunk` | `aiChatResponse` status 1/2/−1 |
| `Tool` | serial, keyCode, turnId, toolCallId, name, phase, args, output | `chunkKind:'tool'` |
| `KeyPress` | serial, keyCode, action down/up | `aiChatView:keyPress` |
| `KeyAlert` | serial, keyCode, alert invalid/checkmark/stop | `showDeviceAlert` → DisplayEvent `showAlert` |
| `Toast` | serial, messageKey, name? | `DeviceData showToast` (KNOB-064) |
| `AgentStatus` | state checking/noService/connecting/connected/disconnected | `openclaw-runtime-status` |
| `MeetingStage` | serial, keyCode, meetingId, stage 0–5, status 0–2 | `mmStageChange` (AI-267) |

`stage` maps DK's stage/status pairs:

| open-quake | DK | Meaning |
|---|---|---|
| `recording/preparing` | 1/2 | mic or session preparing |
| `recording/listening` | 1/0 | STT ready, no speech yet |
| `recording/speaking` | 1/1 | VAD reports speech |
| `recording/recording` | 1/3 | recording, renderer side |
| `processing` (+ final transcript) | 2 | recognition finished |
| `failed` (reason, errorCode, message) | 3 (errType 0–4) | error |
| `busy` (message) | 4 | another task holds the voice slot |
| `idle` (outcome completed/empty/cancelled) | 0 | session over |

`captureId` is knob-push-to-talk's capture identity. DK has none, so a stale
stage can bleed into the next press. DK also keeps `aiAssistCurrentStage` at
3 after an error countdown, which blocks the next press's stage-1 text
(QSV:2042, 2140-2156). Keying the overlay on `captureId` fixes both.
`idle.outcome` replaces DK's two different end paths (`setAssistantProcessDone`
and too-short STT, KNOB-046) with one explicit field.

`KeyCode` is the profile coordinate `row,col` or the logical knob voice key
`0,1` (KNOB_VOICE_KEY_CODE, QSV:2002).

## Device feedback (AI-075, AI-076, KNOB-066, MAIN-022, SCREEN-046)

`VoiceSurface` derives feedback from consecutive stages of one capture:

| Transition | Tone | Key alert |
|---|---|---|
| first `recording/listening` of a capture | `start` [80,100],[0,10],[80,100] | none |
| `idle` completed or empty | `end` [50,100],[0,1],[50,100],[0,1],[50,100] | none |
| `idle` cancelled | none | none |
| `failed` | `error` [90,200] | `invalid` on a grid key |
| `busy` | `busy` [60,60],[0,40],[60,60],[0,40],[60,60] | `invalid` on a grid key |

The patterns are `[level, ms]` steps. Every non-zero level is replaced by the
alert volume, a zero follows each step, and steps are 10 ms apart. The
buzzer setting gates playback (MAIN-021, MAIN-023). Those rules belong to
hardware-controls' `HardwareControls.playTone("start"|"end"|"error"|"busy")`
in PR #22. This change defines `VoiceTonePort.play(serial, name)` with the
same four names. Desktop main binds it to `HardwareSession.playTone`; the
mock bus answers without HID.

The knob model's `voice` binding (`KnobVoiceInput`: holdStart, release,
interrupt, cancel) drives `0,1` captures through the same runtime port. A
hold while another key holds voice is busy, with DK's "Previous turn still
running" toast (KNOB-042). A hold while the knob's own turn runs cancels
that turn first (knob-push-to-talk "Exclusive capture and re-press").

The knob voice key `0,1` has no tile, so it gets no alert. That matches DK's
`showDeviceAlert` guard, which needs a keyCode on the device (AIManager.js:1402).

The key alert is DK's DisplayEvent `showAlert` (DEV:7-9, 143-167, 375-377): a
50×50 icon on an `rgb(255,255,100)` block centred on the tile, z above the
tile, no pointer events. `invalid` (type 1) shows an exclamation and hides
after 2000 ms. `checkmark` (3) and `stop` (0) stay until replaced. Glyphs are
drawn as SVG here; DK's PNGs are not copied.

## Full-screen overlay (AI-200–AI-204, KNOB-057–KNOB-062, SCREEN-111–SCREEN-115)

Stages with keyCode `0,1`, or with no keyCode, drive the backdrop (QSV:1998-2007).
It sits above the grid and every tile overlay and takes no pointer events
(QSV:441-460, z 100000).

Layers, bottom to top:

1. **Waveform (WFV).** Every frame clears the canvas, fills `#050807` at 85 %
   (`D9`), and draws 200–300 random 1×1 `rgba(255,255,255,.02)` dots. It then
   draws five sine waves over 240 samples with quadratic smoothing, sorted by
   thickness × opacity, descending:

   | Wave | amp × H | freq | speed | thickness | opacity | glow | phase |
   |---|---|---|---|---|---|---|---|
   | main | 0.18 | 1.2 | 0.45 | 4.0 | 0.95 | 22 | 0 |
   | upper | 0.26 | 0.9 | 0.38 | 2.5 | 0.55 | 14 | 0.35π |
   | lower | 0.22 | 1.05 | 0.42 | 2.0 | 0.50 | 12 | 0.70π |
   | far 1 | 0.32 | 0.7 | 0.33 | 1.6 | 0.35 | 10 | 1.10π |
   | far 2 | 0.14 | 1.7 | 0.52 | 1.2 | 0.30 | 8 | 1.70π |

   Each wave is drawn twice with the horizontal gradient `#b8fff6 → #17f1d1 → #7ffff0`
   and shadow `#17f1d1`. The glow pass uses width ×1.8, blur = glow and
   alpha ×0.8. The core pass uses width ×1, blur ×0.4 and alpha ×0.9.
   Baseline y = H/2 + sin(0.18·t + phase)·0.015·H. y = baseline +
   amp·H·sin(2π(x/W·freq + t·speed) + phase). t advances 0.016 per frame.
   Intensity stays 1.0: the waves do not follow the mic (KNOB-062). The
   wrapper adds inset glows `rgba(23,241,209,.1)` 20 px and `.05` 30 px,
   radius 12.
2. **Dim.** `rgba(0,0,0,.55)` over the full canvas.
3. **Subtitle band (AED:296-311, 451-487).** Absolute left/right 0, height
   96 px, bottom 72 px while the mic bar shows (else 0). Padding `0 32px 12px`,
   background `linear-gradient(180deg, transparent, rgba(0,0,0,.72))`. Text:
   Inter 300, 40/48 px, `#00FFFF`, centred, one line, ellipsis. When the line
   overflows, a marquee runs `translateX(100%) → translateX(-100%)` over 10 s,
   linear, looping.
4. **Mic bar** (below).

### Stage texts (QSV:1931-2157)

| Stage | Text |
|---|---|
| `recording/preparing` | knob: "Preparing to record…"; grid: "Preparing microphone…" |
| `recording/listening` | the partial transcript, else "You can speak now" |
| `recording/speaking`, `recording/recording` | the partial transcript; else the current text if it is not a placeholder; else "Recording..." |
| `processing` | final transcript, else "Processing..." |
| `failed` | `message` (or the localized text for `errorCode`), else "Processing error, please retry", followed by " (3S)", " (2S)", " (1S)" at 1 s steps, then the overlay closes |
| `busy` | `message`, else "System busy, please try again later" |
| `idle` | overlay closes, text clears |

Late recording events after `processing` in the same capture are ignored
(QSV:2042). DK's knob fallback for speaking without a partial reverts to
"Preparing to record…" while the user talks. Here it shows "Recording...".
The idle placeholder is localized; DK hard-codes "等待语音输入..." (AI-201,
AI-208).

### Mic bar (SMB, AI-203, KNOB-061, SCREEN-113)

The bar shows only while a stage is `recording`, for the knob key and grid
keys alike (QSV:1840-1858). It is fixed bottom-left, full width, above the
backdrop, with no pointer events. Its column holds:

- An optional transcript row, only when the backdrop is hidden (grid voice):
  min-height 52 px, padding `0 32px 4px`, gradient transparent →
  `rgba(0,0,0,.45)`. The text is Inter 300 40/48 `#00ffff` with glow
  `0 0 12px rgba(0,255,255,.35)`, and a 12 s marquee on overflow.
- A 1920×72 canvas (height max(48, 72)).

The canvas, each frame, with W = 1920, H = 72, centre (960, 36):

- `target = speaking ? rms : rms·0.2`
- `display += (target − display)·0.28`; a non-speaking display below 0.004
  snaps to 0
- `phase += 0.11 + display·0.08`
- orb radius `r = min(0.36H, 0.03W)` = 25.92
- `energy = clamp(display, 0, 1)`
- `spread = 0.4r + energy·0.19W`
- `maxAmp = 0.08H + energy·0.42H`

Then:

- **Background.** A vertical gradient: transparent, `rgba(4,10,28,.35)` at
  0.55, `rgba(0,0,0,.55)` at 1. Grid lines every 28 px in
  `rgba(0,180,255,.06)`; the verticals start at `cx mod 28`. Three ripple
  ellipses centred (cx, cy + 0.55r), with `t = i/3`:
  rx = r(1.15 + 1.6t), ry = r(0.22 + 0.18t), stroke
  `rgba(0,220,255, .22 − .06t)`, 1 px.
- **Spikes.** Two sides from x = cx ± r, each with a 1 px spine
  (`rgba(0,230,255,.55)` left, `rgba(220,100,255,.55)` right). Spikes every
  5 px, `count = max(1, floor(spread/5))`. At step i, with t = i/count:
  - `envelope = sin(πt)`
  - `wobble = 0.5 + 0.5·sin(2.4·phase + 0.92i + (left ? 0 : 2.1))`
  - `amp = envelope·maxAmp·wobble·(0.25 + 0.75·energy)`; amp < 0.6 is skipped
  - colours: `rgba(120,255,255)` / `rgba(0,200,255)` left,
    `rgba(255,140,255)` / `rgba(200,80,255)` right, alpha ×(1 − 0.35t)
  - glow 4 + 4·energy; width max(1, 1.4 − 0.6t)
- **Hollow orb.** 72 arc segments. Each segment's hue is
  185 + 115·(cos(mid) + 1)/2, stroked `hsla(h,96%,62%,.95)` at width
  max(2.5, 0.17r), glow 7 + 9·energy. An inner ring at 0.86r, white 28 % at
  50 % alpha.

Levels apply only when their keyCode matches the bar's (QSV:1819-1835). The
bar draws real levels only; DK's level simulation stays an empty stub
(QSV:2121-2131).

### Reduced motion

On the strip DK motion is the default (parity decision 3). When the app's
motion preference is reduced, the waveform and orb draw one static frame per
state change. The marquee is replaced by the ellipsis. The mic bar still
redraws on every level event, because that motion carries information.

## Level meter (KNOB-050, KNOB-054)

The capture side owns metering. This change supplies the pure functions so
the mic bar's input is defined:

- `rms = clamp(analyserRms·3.5, 0, 1)`.
- `speaking = rms > 0.05 || peak > 15 %`.
- A non-speaking level is scaled by 0.35.
- Emission is throttled to one event per 50 ms while speaking and one per
  180 ms while silent.
- Voice activity is detected when the peak exceeds 15 %. It clears after
  15 consecutive buffers below 15 %. Silence never stops capture.

## Hold-to-talk (AI-205, SCREEN-058, SCREEN-059, AI-193, AI-169)

DK splits this between the renderer (350 ms grace, 280 ms short tap, 150 ms
dedupe, QSC:2121-2173, 2885-2922, QSV:2895-2957) and main (1000 ms long press,
280 ms orphan up, busy and tap-to-cancel, BG@994936, BG@1104082, BG@1109198).
open-quake runs one pure reducer in main (`GridVoice`). Its inputs are the
renderer's raw events for hold-to-talk keys only.

A key is hold-to-talk when its type is `aiChat`, or `clawbot` with a truthy
`voiceInput` action (QSC:1758-1767, BG@1099686).

| Input | Rule |
|---|---|
| down on a key whose own flow is active | cancel that flow (tap-to-cancel, BG `tryCancelAiChatGridFlowOnTap`) |
| down while another key holds the reservation or an active flow | `busy`: stage busy with message key STILL_PROCESSING, busy tone, key alert (BG `Zo`); the press is swallowed |
| down, otherwise | select the key (clawbot active dot, agent info), reserve it, arm the long press at +1000 ms |
| down on a pressed key with a pending grace | cancel the grace (finger still down) |
| down on a pressed key, no grace | duplicate, ignored |
| long press due | start capture with a new generation |
| touch end | arm the release grace at +350 ms (re-arming replaces it) |
| touch cancel | ignored, never a release |
| up without the touch-end flag | ignored |
| release whose touch lasted < 280 ms, no long press | short tap: disarm, release the reservation, emit `KeyPress up`; no voice release |
| release before the long press, ≥ 280 ms | release the reservation; no capture was started |
| release while capturing | `release(generation)` once |
| profile change or disconnect | disarm everything; cancel a capturing key |

The 280 ms short tap is measured from down to the touch end. DK measures it
when the up reaches the renderer and main, which is after the 350 ms grace,
so its check can never fire on the touch path (QSC:2141-2153, QSV:2934).

DK's 150 ms duplicate-up filter (QSV:2940) merged two delivery paths for one
release. Here one release per press is structural, and a property test
proves that no key gets two releases within 150 ms.

## Tile routing (AI-200, AI-204)

Grid stage events are remapped to tile statuses (QSV:1837-1929):

| Stage | Status |
|---|---|
| `recording/preparing` | 0 Initializing |
| other `recording` | 3 Start Recording |
| `processing` | final transcript to the tiles |
| `failed` | −1 |
| `busy` | 5 |
| `idle` | 2 |

Chunks map to tile status 1 while streaming and 2 at `end` with
`completed`. Other `end` outcomes map to −1 with the end's errorCode.

Knob (`0,1`) chat goes to the ClawBot conversation only and never reopens
the overlay (KNOB-044, SCREEN-115). aiChat keys feed the AI Copilot view;
clawbot keys and the knob feed ClawBotView.

## AI Copilot view (`aiChatView`, 5×2; ACV, AI-190–AI-199)

At 1180×460, base = min(w, h) = 460:

- gap = clamp(0.015·base, 4, 20) = 6.9
- textFs = clamp(0.05·base, 10, 20) = 20
- smallFs = clamp(0.035·base, 8, 16) = 16
- toolbar = 20 % of the height (92); content = 368, split 1:4 (236 | 944)

Elements:

- **Root.** Transparent, border clamp(0.15·gap, .5, 2) px
  `rgba(200,200,200,.3)`, the slot radius.
- **Toolbar.** Padding 0 gap, inset shadow, bottom border clamp(0.2·gap, 1, 3)
  `rgba(255,255,255,.1)`. Left: "AI Copilot Chat", 2·smallFs bold, .8 alpha,
  padding-left 2 % of the width. Centre: the status text, 2·smallFs/500, .9
  alpha. Right: the copy icon, 40×40 (rx 6 `rgba(0,0,0,.5)`, two 16×20 rects
  `rgba(117,117,117,.85)`), shown only on the strip and only with text.
- **Left panel.** Padding gap, inner shadow, right border; the orb in a 1:2
  box (177×354).
- **Right panel.** The text column: font 2·textFs, line height ×1.5, .9
  alpha, half-character side padding, pre-wrap.
- **Push-to-talk hint (idle on the strip).** 1.5·textFs, .6 alpha,
  normal letter spacing, centred inline characters with natural word wrapping
  and emergency wrapping for an overlong word. One character turns `#00FFFF`
  per 100 ms, looping. Recovered ACV:1394–1405 uses −0.12em and nowrap;
  mounted Range/ink measurements reproduce overlapping letters with that
  tracking, including with DK's inline spans. We improve this AI-196 defect
  without changing the hint's font size, area, orb or timing.
- **Cancel hint (status 1 with no text).** "Press {title} button to cancel",
  with the title in `#00FFFF` ("the active" when there is none),
  letter-spacing .04em.

Status machine (ACV:818-1033):

- **Down.** While no key is active: claim the key, status 0, clear the text.
  On the claimed key: mark it pressed. On another key: ignore.
- **Up.** On an aiChat key: 3 → 1, 0 → cancelled (null). On a clawbot key:
  3 or 0 → 1. Any other status resets.
- **Responses.** Status 3 is ignored unless the current status is 0. Status 2
  without a keyCode ends a knob session only while processing. Status 5 shows
  "System busy" unless another key is active. Responses for a non-active key
  are ignored. Status 2 adds a
  newline. Status −1 shows "Error code: {code}" or "Error".
- **Timeout.** "Time out" 330 000 ms after the status leaves null.

Orb speed by status: null 1, 0 → 3, 3 or 4 → 6, 1 → 10, 2 → 1. The copy icon
copies the trimmed text through main and toasts "Copied to system clipboard",
or "Copy to system clipboard failed".

## Energy orb (GEO, AI-194, SCREEN-119)

SVG viewBox 187×193:

- **Core.** Circle (95.1, 91.1) r 75, fill `#00FFFF`.
- **Clouds.** Three ellipses under Gaussian blur σ 12:
  - left (69.1, 97.1) 48×57, gradient `#00DDFF` .75 → `#0088FF`, opacity .6
  - right A (119.969, 124.719) 32.3341×51.5, rotated −136.713°, `#AA00FF`
    .25 → .85
  - right B (109.629, 62.3873) 31.807×51.5, rotated 122.047°, `#00AAFF`
    .25 → `#88FF00` .9
- **Gloss.** Three white → 5 % ellipses:
  - A (65.6, 91.1) 34.5×51
  - B (116.202, 68.7383) 30.5×49.0075, rotated −35.0199°
  - C (109.1, 116.6) 46×35.5, rotated −21.0194°

Animations, each divided by the speed:

- core-breathe 3 s (scale .98 ↔ 1.02)
- core-hue 6.7 s (brightness 1.15, saturate 1.2, hue 0 → −6°)
- orbits 17.3 s clockwise, 12 s and 8 s counter-clockwise
- cloud fades 3.7, 2.8 and 2.4 s
- gloss sweeps 4.3, 5.2 and 6.1 s, delayed 0.5, 1.1 and 1.6 s

Paused removes the animations (pose resets). Reduced motion pauses the orb.

## ClawBotView (`quakeBot`, 4×2; QBV, AI-150–AI-171)

Scale `s` = h/440 when w/h ≥ 2, else w/880, clamped 0.4–2.5. On the strip
940×460 gives s = 1.0455.

- **Card.** `rgba(28,28,30,.65)`, backdrop blur 40 px with saturate 180 %, 1 px
  `rgba(255,255,255,.08)` border, shadow `0 8px 32px rgba(0,0,0,.4)`, SF Pro
  stack, white. While the FunctionWheel is open: alpha .94, no blur, overflow
  visible (AI-207).
- **Header.** 64s tall, padding 0 24s, 1 px divider. On the left, a 36s
  orange-gradient square (`#FF9500 → #FFB340`, radius 10s, "💬" 18s), a
  10s gap, then "Interaction History" at 20s/600.
- **Connection pill.** Min-height 32s, padding 6s/16s, radius 20s, 1 px
  `rgba(120,200,255,.35)`, a 135° blue gradient, shimmer 4.5 s. It holds an
  FX slot and the badge: dot 8s plus label 14s/600. Dot colours:
  - connected: `#30D158`, pulse 2 s
  - checking or connecting: `#FF9F0A`, pulse
  - otherwise: `rgba(142,142,147,.95)`, static
- **Messages.** Padding 20s, gap 16s, vertical scroll, hidden scrollbar. Each
  turn row has a 44s avatar (radius 12s), a 14s gap, then a column with an 8s
  gap. The header line is sender 16s/600 plus time 13s at .4 alpha, HH:mm
  24 h.
- **Bubble.** Padding 12s/16s, radius 8s 20s 20s 8s (the last bubble gets 20s
  bottom corners), body 22s, line height 1.6, pre-wrap. Variants:
  - normal `rgba(255,255,255,.05)`
  - system hint `rgba(120,200,255,.12)` with 1 px `rgba(120,200,255,.22)`
  - voice `rgba(48,209,88,.08)` with a 3 px left border `rgba(48,209,88,.5)`
- **Entry.** 0.3 s ease from opacity 0 and translateY 10 px, delay
  index·0.05 s; removed under reduced motion.
- **Auto-scroll.** Follow only within clamp(8s, 5, 15) px of the bottom.

Avatar gradients by agent icon type:

| Type | Gradient |
|---|---|
| 0 | `#FF9500 → #FFB340` |
| 1 | `#0A84FF → #64D2FF` |
| 2 | `#5E5CE6 → #BF5AF2` |
| 3 | `#30D158 → #64D2FF` |
| 4 | `#FF375F → #FF9F0A` |

Avatar emoji: system ℹ️ on gray, user ✏️ on orange, live voice 🎤 on green,
agent by id (weather ☀️, code 💻, chat 💬, assistant 🤖, default 🤖).

Conversation model:

- A new group starts per turn, even for the same agent.
- The live voice row is "🎤 Voice Input · {agent}". It merges partials by
  QBV:1488-1574: shorter or longer prefix replaces; a punctuation-stripped
  prefix replaces; a short tail after a break (previous ≥ 18 chars, small
  common prefix) appends on a new line; a full-hypothesis refresh
  (prefix ≥ max(6, 50 %)) replaces; anything else appends raw. A final
  transcript replaces the row. On the next turn the row moves into that
  agent's group as a voice message.
- System hints dedupe identical text within 5000 ms (AI-168).
- Error copy follows AI-167. 2009–2014 render as system hints. 4001, 4003
  and 2014 are DecoKee account errors (out of scope) and fall back to the
  generic chat error.
- Outside the strip panel (management preview) the messages area is not
  rendered (AI-171).
- A profile change clears the live row and the active key (AI-170).

The read-aloud pill shows the TTS FX states: idle dots, thinking dots, a
speaking wave. Toggling TTS is voice-stt-tts's job, so the tap emits an
intent and nothing else (AI-155 stays partial).

## Rich text (AI-172–AI-177)

Markdown is detected when any line starts with `#{1,6} `, `- `, `* `, `+ `,
`\d+. ` or `> `, or the text contains a code fence, `**x**` or `__x__`.
Otherwise the text renders as plain pre-wrap.

Blocks:

- headings h1–h6 at 1.15/1.1/1.02em, weight 700, line height 1.35
- paragraphs
- ul (disc) and ol (decimal), margin .15em 0 .25em, padding-left 1.35em,
  li spacing .28em, marker .55 alpha
- blockquote with a 3 px `rgba(100,210,255,.45)` bar at .88 alpha
- fenced code: `rgba(0,0,0,.28)`, radius 8, monospace .88em, line height 1.45

Inline: bold (700) and code (.9em, padding .08/.35em, radius 4,
`rgba(255,255,255,.1)`).

Everything renders as React elements; nothing is passed as HTML.

HTTP(S) URLs become link chips:

- min-height max(66s, 44), padding 10s/14s, radius 10s
- `rgba(74,159,255,.14)` with a .32 border, text `#b8e0ff`
- 🔗 21s, label 18s: host + path, ellipsis at 48
- press scale 1.02

Activation sends the URL to main, which opens only `http:`/`https:` URLs with
a host and no credentials. File paths stay text, as ai-chat-core requires.

## Tool card (AI-178, AI-179)

Tool events upsert by toolCallId. Each card has:

- a 10s dot: running `#4a9fff` pulsing 1.2 s, done `#30d158`, error `#ff375f`
- "Command" at 19.5s/600, the monospace name, and the phase
  (Running/Done/Failed)

Exec-kind tools (exec, bash, shell, run, `*_exec`; args command, cmd, script,
input) and web_search-kind tools (web_search, websearch, brave_search,
search; args query, q, input, search, text) expand into a `<pre>` (max height
160s) on tap. agent-runtime produces these events; nothing does yet.

## ClawBotInput (`quakeBotInput`, 2×2; QBI, AI-180–AI-189)

S = clamp(h/440, 0.4, 2.0)·1.25 = 1.307 at 460×460.

- **Header.** 52S: "✏️" 28S, then "Command Input · {agentName}" at 15S/600.
- **Textarea.** Min-height 120S, font 16S, line height 1.6, radius 16S,
  placeholder "Click to enter command...". The focus ring is
  `rgba(255,149,0,.5)` plus a 3 px `rgba(255,149,0,.1)` halo. Enter inserts
  a newline.
- **Buttons.** "📤 Send" and "📎 File Attach", gap 12S, min-height 48S, radius
  20S, 14S/500 at .7 alpha, pressed scale .97.
- **Warning bubble.** Top 8S, max-width 300S, `#FFF3D6` on dark amber, fades
  up over 0.18 s, hides after 1800 ms.

Behaviour:

- Voice partials merge into the box like the live row; a final replaces it;
  a new session clears it.
- Send needs a tapped clawbot key ("Please tap an AI assistant first!") and
  an agent ("Please select your assistant!").
- File Attach asks main for a file dialog ("Choose file(s) to attach") and
  appends the paths as text.
- A tap on the textarea asks main to focus the strip window before focusing
  the box.
- "Open WebChat" is not built. It opens the OpenClaw gateway with its token
  in the URL (AI-186, "Don't copy").

## AI key decorations

- **Cancel indicator (QSC:173-236, SCREEN-045, AI-197).** A 120×120 SVG
  (viewBox 240) on the active aiChat/clawbot key while the AI Copilot status
  is 1:
  - a ring r 100, white, 1.5 px at .8
  - a disc r 92, white .3, with a 100×100 rx 16 hole
  - a square 92×92 rx 12 `#8B0000` at .8
  - centred, shifted down 20 px
  The key's icon is hidden. A profile change clears it.
- **Clawbot active dot (SCREEN-040).** 20 px at left 24, bottom 24.
  Gradient 145° `#3ee66a → #28a745 → #1e7b35`, inset highlights, shadow
  `3px 3px 6px rgba(0,0,0,.35)`. It marks the last selected clawbot key.
- **Strip toasts (AI-169, AI-199, SCREEN-120, KNOB-064).** A warning toast,
  24 px text with a 28 px icon, 3000 ms. Messages:
  - `aiIconViewTxt.busyToast` "System busy, please try later"
  - `aiAudio.prevTurnBusy`
  - `aiAudio.openClawGatewayNotRunning`
  - `aiAudio.openClawGatewayStarting`
  - `aiAudio.openClawNotReady`
  - `aiAudio.busyOnGrid` (with name)

## Localization (AI-208)

The overlay, tile and toast strings are bundled verbatim from DK's eight
locales (en, zh, de, es, fr, it, ja, ko). The strip picks one from the
renderer's language and falls back to English. The app has no locale
setting yet; when settings adds one, it replaces the language lookup.

## Mock runtime

With `OPEN_QUAKE_MOCK_DEVICE=1` (the device mock's switch, honoured in built
apps too) and in the native smoke, main binds the runtime port to a scripted
runtime. A grid long press or knob hold runs:

1. preparing for 300 ms
2. listening (start tone)
3. levels every 50 ms from a deterministic envelope, with partial transcripts
4. on release: processing with the final transcript
5. `TurnStarted` and answer chunks every 60 ms
6. `end` completed, then `idle` completed (end tone)

Typed sends skip to step 5. The script is labelled mock in its events, calls
no provider, and is tested with TestClock. Without mock mode and without a
real runtime, a voice start publishes `failed` with reason `unavailable`.
The user sees the error countdown instead of silence.

## Decisions where we differ from DK

- Overlay sessions key on `captureId`, which fixes DK's stuck stage
  (QSV:2042) and stale events.
- `idle.outcome` decides the end tone explicitly.
- The knob speaking fallback says "Recording...", not "Preparing to record…".
- The placeholder and busy toast are localized (AI-201, AI-169, AI-208).
- An up without the touch-end flag never leaves a capture running, unlike
  DK's renderer-only reset (QSV:2920-2932).
- Reduced motion is honoured on the strip for decorative loops only.
- The idle Copilot hint uses normal tracking and wraps locale text within
  its panel; recovered negative tracking overlaps glyphs (AI-196).
- Account error codes (4001, 4003, 2014) map to generic copy.
- Another key's busy rejection leaves the running AI Copilot turn alone; DK
  resets it (ACV:840-844). The busy toast still shows.
- Open WebChat is omitted.
- Links open only validated HTTP(S); files are never opened (AI-177).

## Risks

- Tone timing and loudness on the real buzzer are unverified until the lead
  runs the hardware checklist; the tests use hardware-controls' fake
  transport.
- Real mic levels arrive only once voice-stt-tts's capture adapter calls the
  level meter; until then only the mock runtime drives the bar.
- `StripScreen`, `tileRegistry.tsx` and `main/index.ts` are shared with other
  lanes, so the edits stay additive to keep merges small.

## PR #28 review round 1

Busy knob rejection expires locally after 3000 ms, matching the busy toast lifetime.
A new stage clears the previous expiry. This avoids waiting for a terminal
event from a rejected capture. Typed-only clawbot presses carry `voiceInput:
false` through the existing input contract and select an assistant without
entering the hold reducer. Typed delivery preserves the runtime error through
GridVoice to the IPC edge, which returns `rejected`; the input clears only its
submitted draft after `ok`. Profile reset increments the input revision to clear
the mounted textarea even when coordinates are reused. Mock capture release
and cancellation match both owning key and generation where supplied. Copilot
appends every nonempty delta, including whitespace. These fixes refine the
existing AI-184, AI-187, AI-193, AI-170, KNOB-042 and SCREEN-111 scenarios.

## PR #28 review round 2

A voice-enabled ClawBot selection tap clears Copilot's initializing state on
key up. Only a recording status advances release to processing; a foreign
key up cannot release the pending Copilot key.

Main consumes the real DeviceBus status before forwarding it to renderers.
Link loss immediately gates new input and knob starts, then calls GridVoice
reset with reason disconnected. Reset takes priority over overdue deadlines,
cancels held capture or the remaining active flow, and publishes a typed
Reset event after cancellation. The renderer clears overlay/countdown,
watchdog, alerts, live transcript, input revision and selection. Touch teardown
on disconnect cancels delayed releases and emits no voiceTouchEnd. Reconnect
permits new holds. An unknown link still permits the development fallback.

The transcript merger records the prefix preceding the current hypothesis.
Growing, shrinking and corrected hypotheses replace only that suffix.
Final transcripts remain authoritative full replacements, as in recovered
QuakeBotIconView.vue:1494-1507 and QuakeBotInputIconView.vue:388 onward.
This fixes the recovered partial-merging defect under AI-164 and AI-187.

Conversation capture identity and agent are separate from typed assistant
selection. Selecting B cannot filter A's remaining recording events. Voice
TurnStarted uses its authoritative prompt and event agent, falling back to
the capture's agent when absent. Typed turns do not consume a live voice row.

Renderer dispatch reads key maps only after a layout-effect commit. Requests
use an Effect boundary with the catalog-tagged VoiceSurfaceRequestFailed and
return its stable rejection code. The original cause remains private and
diagnostics use the existing scrubber. History message bodies memoize their
message identity; link callbacks depend on the stable request function and
Intl formatters cache per supported locale. Code fences retain their opener's
marker and length and reject closing lines with trailing non-whitespace.

Grid and knob operations share the GridVoice lock. Before calling a capture
adapter, they reserve its key and capture ID in VoiceSurface, since the first
stage can arrive after startCapture returns. Unavailable starts publish their
existing failed stage, which releases that reservation. Deferred-adapter tests
cover both start orders without publishing a stage; taking the lock alone
does not close the reservation gap.

## PR #28 review round 3

Copilot's idle hint keeps the recovered 30/45 px text and centred content
area, with normal spacing and a shared inline text run for per-character
highlights. Real spaces permit locale word wrapping; an overlong word can
wrap within the panel. Reduced motion still removes the highlight loop and
orb animations.

ClawBot input selection retains the key's optional configured assistant ID.
The synthetic default used for conversation display stays at that display
boundary. Missing, empty and whitespace-only IDs therefore reach the AI-184
missing-assistant warning, preserve the draft and issue no SendText.
