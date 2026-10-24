# Spec Delta

## Purpose

Show voice presses and AI conversations on the QUAKE strip the way DK-Suite
0.4.95 does, with the device feedback that goes with them. Geometry, timings,
colours and strings are the recovered values cited in `design.md`.

## ADDED Requirements

### Requirement: Voice surface events

Main SHALL publish one Schema-decoded `VoiceSurfaceEvent` union to every app window: Stage, Level, TurnStarted, Chunk, Tool, KeyPress, KeyAlert, Toast, AgentStatus and MeetingStage. Stage SHALL carry serial, keyCode, captureId and one of `recording` (preparing, listening, speaking, recording, with an optional partial transcript), `processing` (optional final transcript), `failed` (reason generic, noMic, server, processing, timeout or unavailable, optional errorCode and message), `busy` (optional message) or `idle` (outcome completed, empty or cancelled). Level SHALL carry an rms clamped to [0,1] and a speaking flag. Main SHALL drop a stage identical to the previous stage for the same device. Undecodable input SHALL be rejected, never forwarded. KeyCode `0,1` and stages without a key SHALL target the full-screen overlay; every other keyCode SHALL target tiles. Covers AI-077, AI-200, AI-267 (device push contract), KNOB-057, KNOB-065, SCREEN-114, SCREEN-116.

#### Scenario: Duplicate stage from the runtime

- **WHEN** the runtime publishes the same `recording/listening` stage twice for one device
- **THEN** windows receive it once

#### Scenario: Malformed renderer or runtime payload

- **WHEN** a payload has an rms of 3, an unknown stage phase or an unexpected extra field
- **THEN** it is rejected without reaching any window or the voice runtime

### Requirement: Device feedback during a voice press

Main SHALL derive device feedback from consecutive stages of one capture. The first `recording/listening` SHALL play tone `start`. `idle` completed or empty SHALL play `end`. `idle` cancelled SHALL play nothing. `failed` SHALL play `error` and raise key alert `invalid` on a grid key. `busy` SHALL play `busy` and raise `invalid` on a grid key. The knob key `0,1` SHALL get no key alert. Tones SHALL go through a `VoiceTonePort` that desktop main binds to hardware-controls' `playTone`, so the alert volume and buzzer switch apply. A knob hold while another key holds voice SHALL publish `busy` for `0,1` with the "Previous turn still running — try again shortly" toast. Covers AI-075, AI-076, KNOB-042, KNOB-066, MAIN-022.

#### Scenario: Successful knob turn

- **WHEN** a knob capture goes preparing → listening → speaking → processing → idle completed
- **THEN** exactly one `start` and one `end` tone play, and no key alert is raised

#### Scenario: Grid key error

- **WHEN** a capture on key `1,6` fails
- **THEN** one `error` tone plays and key `1,6` receives one `invalid` alert

#### Scenario: Cancelled press

- **WHEN** a capture ends idle cancelled
- **THEN** no tone plays

### Requirement: Key alert flash

A KeyAlert SHALL draw a 50×50 glyph on an `rgb(255,255,100)` block centred on the target tile, above the tile, with no pointer events. `invalid` SHALL show an exclamation and hide after 2000 ms; a new alert on the same key SHALL restart that timer. `checkmark` and `stop` SHALL stay until replaced. Alerts for keys without a visible tile SHALL draw nothing. Covers SCREEN-046 (alert), AI-075.

#### Scenario: Invalid alert expires

- **WHEN** key `1,6` receives `invalid` and 2000 ms pass with no new alert
- **THEN** the block is shown during that time and removed afterwards

### Requirement: Full-screen voice overlay layout

While a knob-key stage is active, the strip SHALL draw from the bottom up:

- the five-wave waveform (amplitudes, frequencies, speeds, thicknesses, opacities, glows and phases from design.md) on `#050807` at 85 % with 200–300 noise dots per frame, at fixed intensity 1.0
- a `rgba(0,0,0,.55)` dim
- a 96 px subtitle band, bottom 72 px while the mic bar shows, else 0; padding `0 32px 12px`, gradient to `rgba(0,0,0,.72)`, Inter 300 40/48 px `#00FFFF`, centred on one line, with a 10 s linear marquee when the text overflows

The overlay SHALL sit above the grid and tile overlays and take no pointer events. Covers AI-201, KNOB-058, KNOB-062, SCREEN-112.

#### Scenario: Overlay geometry at 1920×480

- **WHEN** a knob stage is `recording/listening`
- **THEN** the waveform canvas is 1920×480, the band is 96 px tall with its bottom at 72 px, and the subtitle text is `#00FFFF` at 40 px

#### Scenario: Long transcript

- **WHEN** the subtitle text is wider than the band
- **THEN** it scrolls from 100 % to −100 % over 10 s; under reduced motion it is truncated with an ellipsis instead

### Requirement: Voice stage texts and countdown

The overlay text SHALL follow the stage:

- `recording/preparing`: "Preparing to record…" for the knob, "Preparing microphone…" for grid keys
- `recording/listening`: the partial transcript, else "You can speak now"
- `recording/speaking` and `recording/recording`: the partial transcript, else the current non-placeholder text, else "Recording..."
- `processing`: the final transcript, else "Processing..."
- `failed`: the message, or the localized text for its errorCode, else "Processing error, please retry", suffixed " (3S)", " (2S)", " (1S)" at 1000 ms steps, closing the overlay 3000 ms after the stage
- `busy`: the message, else "System busy, please try again later"
- `idle`: the overlay closes

Recording events that arrive after `processing` in the same capture SHALL be ignored. A new captureId SHALL start a fresh session even after an error. Covers AI-202, KNOB-059, KNOB-060, SCREEN-111.

#### Scenario: Error countdown

- **WHEN** a knob capture fails without a message
- **THEN** the text reads "Processing error, please retry (3S)", then "(2S)" at 1000 ms and "(1S)" at 2000 ms, and the overlay is gone at 3000 ms

#### Scenario: Rejected knob hold expires

- **WHEN** a grid key owns capture and a knob hold is rejected busy
- **THEN** the busy overlay closes after 3000 ms without a terminal event, and the grid capture continues
- **AND** a newer knob session replaces the busy expiry and is not closed by it

#### Scenario: Next press after an error

- **WHEN** a new capture starts `recording/preparing` right after an error countdown ends
- **THEN** the overlay shows "Preparing to record…", not an empty placeholder

#### Scenario: Late partial

- **WHEN** a `recording/speaking` partial for capture A arrives after A's `processing` stage
- **THEN** the overlay keeps showing the final transcript

### Requirement: Mic mountain bar

While a stage is `recording`, for the knob key or a grid key, the strip SHALL draw the mic bar: a fixed 1920×72 canvas at the bottom, above the overlay, with no pointer events. Every frame SHALL apply `target = speaking ? rms : rms·0.2`, `display += (target − display)·0.28`, and snap a non-speaking display below 0.004 to 0. It SHALL draw the gradient background, the 28 px grid, three ripples, cyan and magenta spike waves out to `0.4r + energy·0.19W` with amplitude `0.08H + energy·0.42H`, and the 72-segment hollow orb of radius `min(0.36H, 0.03W)`, with the formulas in design.md. It SHALL use only Level events whose keyCode matches the bar's key, and SHALL hide on every non-recording stage. For grid keys, where no backdrop shows, a 52 px transcript row SHALL sit above the canvas. Covers AI-203, KNOB-061, SCREEN-113.

#### Scenario: Level from another key

- **WHEN** the bar shows for key `0,1` and a Level for key `1,6` arrives
- **THEN** the bar's level is unchanged

#### Scenario: Bounded drawing

- **WHEN** arbitrary rms values in [0,1] drive any number of frames
- **THEN** spikes never extend past the spread, amplitudes never exceed `maxAmp`, and the display level stays in [0,1]

### Requirement: Level meter

The capture side SHALL compute `rms = clamp(3.5·analyserRms, 0, 1)` and mark speaking when rms > 0.05 or the peak exceeds 15 %, scaling non-speaking levels by 0.35. It SHALL emit at most one Level per 50 ms while speaking and one per 180 ms while silent. Voice activity SHALL be detected above a 15 % peak, clear after 15 consecutive buffers below it, and never stop capture. Covers KNOB-050, KNOB-054.

#### Scenario: Throttled silent level

- **WHEN** silent buffers arrive every 20 ms for 400 ms
- **THEN** at most three Level events are emitted

### Requirement: Hold-to-talk on AI keys

Keys of type `aiChat`, and `clawbot` keys with a truthy `voiceInput` action, SHALL follow one state machine in main:

- **Busy rejection.** A down while another key holds the reservation or an active flow SHALL publish `busy`, play the busy tone, raise an `invalid` alert, and swallow the press.
- **Tap-to-cancel.** A down on a key whose own flow is active SHALL cancel that flow.
- **Select.** Any other down SHALL select and reserve the key and arm a long press at 1000 ms. The long press SHALL start a capture with a new generation.
- **Duplicates.** A duplicate down SHALL be ignored, and a down during a pending grace SHALL cancel the grace.
- **Release grace.** A touch end SHALL release after 350 ms. A touch cancel SHALL never release. An up without the touch-end flag SHALL be ignored.
- **Release outcomes.** A release whose touch lasted under 280 ms, with no long press, SHALL be a short tap, with no voice release. A release before the long press SHALL free the reservation. A release while capturing SHALL send exactly one release for that generation.
- **Dedupe.** No key SHALL receive two releases within 150 ms.
- **Reset.** A profile change or disconnect SHALL disarm all timers and cancel a running capture.

Covers AI-169, AI-193, AI-205, SCREEN-058, SCREEN-059.

#### Scenario: Hold, speak, release

- **WHEN** key `1,6` goes down at 0 ms, the touch ends at 2400 ms and nothing else arrives
- **THEN** capture starts at 1000 ms and one release is sent at 2750 ms

#### Scenario: Grace absorbs a false lift

- **WHEN** the touch ends at 1500 ms and a down for the same key arrives at 1700 ms
- **THEN** no release is sent and capture continues

#### Scenario: Short tap

- **WHEN** the touch ends at 100 ms
- **THEN** no capture starts and no release is sent; the key stays selected

#### Scenario: Second key while one is busy

- **WHEN** key `1,6` is capturing and key `1,7` goes down
- **THEN** `1,7` gets the busy stage, tone and alert, and `1,6` keeps capturing

#### Scenario: Select a typed-only assistant

- **WHEN** a clawbot key has false or absent `voiceInput` and receives pointer or device down and release
- **THEN** it selects the key and agent for typed chat and publishes key presses without reserving voice or starting capture

#### Scenario: Touch cancel

- **WHEN** a capturing key receives a touch cancel
- **THEN** capture continues until a real touch end

### Requirement: AI key decorations

While the AI Copilot status is processing, the active aiChat or clawbot key SHALL show the cancel indicator and hide its icon: a 120×120 SVG (viewBox 240) with a white ring r 100 at .8, a white .3 disc r 92 with a 100×100 rx 16 hole, and a 92×92 rx 12 `#8B0000` square at .8, centred and shifted down 20 px. The last selected clawbot key SHALL show a 20 px green dot (145° `#3ee66a → #28a745 → #1e7b35`) at left 24 and bottom 24. A profile change SHALL clear both. Covers AI-170, AI-197, SCREEN-040, SCREEN-045.

#### Scenario: Cancel indicator lifecycle

- **WHEN** aiChat key `1,6` is released after a long press and the view enters processing, then completes
- **THEN** the indicator shows on `1,6` with its icon hidden, and both revert at completion

### Requirement: Strip toasts

Toast events and local busy interceptions SHALL show a warning toast with 24 px text and a 28 px icon for 3000 ms. The text SHALL be the localized string for `aiIconViewTxt.busyToast`, `aiAudio.prevTurnBusy`, `aiAudio.openClawGatewayNotRunning`, `aiAudio.openClawGatewayStarting`, `aiAudio.openClawNotReady` or `aiAudio.busyOnGrid` (with the key name). Covers AI-169, AI-199, KNOB-064, SCREEN-120.

#### Scenario: Busy toast

- **WHEN** a toast with key `aiIconViewTxt.busyToast` arrives in English
- **THEN** "System busy, please try later" shows for 3000 ms

### Requirement: AI Copilot view

The `aiChatView` tile SHALL lay out with toolbar 20 % of the height, content split 1:4, gap clamp(0.015·min(w,h), 4, 20), textFs clamp(0.05·min, 10, 20) and smallFs clamp(0.035·min, 8, 16). The toolbar SHALL show "AI Copilot Chat", the status text and, on the strip with text present, the 40×40 copy icon. The status machine SHALL follow ACV:

- statuses null, 0 Initializing, 3 Start Recording, 1 Processing, 4 Generating, 2 Completed, −1 Error or "Error code: {code}", 5 System busy
- key semantics as listed in design.md
- "Time out" 330 000 ms after the status leaves null

The left panel SHALL hold the energy orb in a 1:2 box with speed null 1, 0 → 3, 3 or 4 → 6, 1 → 10, 2 → 1. On the strip, idle SHALL show "Push-To-Talk with AI via a button" with one character turning `#00FFFF` every 100 ms, and processing without text SHALL show "Press {title} button to cancel". Answer text SHALL render as escaped plain text. Copy SHALL write the trimmed text through main and toast "Copied to system clipboard" or "Copy to system clipboard failed". Covers AI-190–AI-196, AI-198, AI-199.

#### Scenario: Hold and stream

- **WHEN** aiChat key `1,6` goes down, the mic opens, the key is released and three answer chunks then an end arrive
- **THEN** the status reads Initializing, Start Recording, Processing, Completed in order, and the text holds the three deltas

#### Scenario: Whitespace answer chunks

- **WHEN** answer deltas contain standalone spaces, newlines or indentation
- **THEN** the displayed and copied answer preserves those deltas in order

#### Scenario: Released before the mic opens

- **WHEN** the key goes up while the status is Initializing
- **THEN** the status returns to null and no text remains

#### Scenario: Stuck turn

- **WHEN** the status stays non-null for 330 000 ms
- **THEN** the status text reads "Time out" and the view resets

#### Scenario: Escaped answer

- **WHEN** an answer delta contains `<img src=x onerror=alert(1)>`
- **THEN** it renders as literal text and no element is created

### Requirement: Energy orb

The orb SHALL draw the recovered SVG (core r 75 `#00FFFF`, three σ 12 blurred clouds, three gloss ellipses) and animate core-breathe 3 s, core-hue 6.7 s, orbits 17.3/12/8 s, cloud fades 3.7/2.8/2.4 s and gloss sweeps 4.3/5.2/6.1 s with 0.5/1.1/1.6 s delays, each divided by the speed. Paused or reduced motion SHALL remove the animations. Covers AI-194, SCREEN-119.

#### Scenario: Speed scales durations

- **WHEN** the speed is 10
- **THEN** core-breathe lasts 0.3 s and the slow orbit 1.73 s

### Requirement: ClawBotView

The `quakeBot` tile SHALL scale by `s = clamp(w/h ≥ 2 ? h/440 : w/880, 0.4, 2.5)` and draw:

- the glass card, opaque without blur while the FunctionWheel is open
- the header, with the "Interaction History" title and the connection pill (badge labels "Checking…", "No service", "Connecting…", "Connected", "Disconnected", and dot colours and pulses per state)
- the message list

Messages SHALL group per turn with avatars, sender and HH:mm time, and normal, system-hint and voice bubbles, with every size from design.md. Connection changes SHALL append the matching system hint. Identical hints within 5000 ms SHALL be dropped. Error codes SHALL map to the AI-167 copy; account codes 4001, 4003 and 2014 SHALL fall back to "Chat failed.". The live "Voice Input" row SHALL merge partials by the QBV rules, be replaced by a final transcript, and move into the next turn as a voice message. Auto-scroll SHALL follow only within clamp(8s, 5, 15) px of the bottom. Outside the strip panel the message list SHALL not render. A profile change SHALL clear the live row and active key. All text SHALL render as React text. Covers AI-150–AI-154, AI-157–AI-162, AI-164–AI-168, AI-170, AI-171, AI-207.

#### Scenario: Partial merge

- **WHEN** partials "你查一下。" then "你查一下今天的天气" arrive
- **THEN** the live row reads "你查一下今天的天气"

#### Scenario: Short tail after a break

- **WHEN** the row holds a 20-character sentence and a 6-character partial with no common prefix arrives
- **THEN** the partial is appended on a new line

#### Scenario: Hint dedupe

- **WHEN** the same system hint arrives twice within 5000 ms
- **THEN** one hint group exists

#### Scenario: Management preview

- **WHEN** the tile renders in the management preview
- **THEN** the header renders and the message list does not

### Requirement: Safe rich text and link chips

Chat text SHALL render a markdown subset when DK's detection rule matches: headings, paragraphs, bullet and numbered lists, blockquotes, fenced code, bold and inline code. Everything SHALL render as React elements with no HTML injection. HTTP(S) URLs SHALL render as link chips with the AI-176 visuals. Activating a chip SHALL ask main to open the URL, and main SHALL open only `http:` or `https:` URLs with a host and no credentials. File paths SHALL stay text. Covers AI-172–AI-177.

#### Scenario: Markdown with raw HTML

- **WHEN** a reply is "## Plan\n- **one** `two`\n<script>x</script>"
- **THEN** it renders a heading, a list item with bold and code, and a literal "<script>x</script>" paragraph

#### Scenario: Rejected link

- **WHEN** a chip activation asks to open `javascript:alert(1)` or `https://user:pw@host/`
- **THEN** main opens nothing

### Requirement: Tool cards

Tool events SHALL upsert cards by toolCallId with the running (`#4a9fff`, pulsing 1.2 s), done (`#30d158`) or error (`#ff375f`) dot, "Command", the monospace name and the phase. Exec-kind and web_search-kind tools SHALL expand on tap into a preview capped at 160s height, showing the command or query argument, the JSON arguments or the raw string. Covers AI-178, AI-179.

#### Scenario: Running then done

- **WHEN** a tool event with phase start and then one with phase result arrive for one toolCallId
- **THEN** one card shows, first "Running" and then "Done"

### Requirement: ClawBotInput

The `quakeBotInput` tile SHALL scale by `S = clamp(h/440, 0.4, 2.0)·1.25` and draw:

- the header "Command Input · {agentName}"
- the textarea, placeholder "Click to enter command...", Enter inserting a newline
- the "📤 Send" and "📎 File Attach" row
- the warning bubble, hiding after 1800 ms

Voice partials SHALL merge into the box, a final transcript SHALL replace it, and a new session SHALL clear it. Send SHALL warn "Please tap an AI assistant first!" without a selected clawbot key, and "Please select your assistant!" without an agent. Otherwise it SHALL send the trimmed message to main, and the runtime's typed turn SHALL render in ClawBotView as "Command · {agent}". File Attach SHALL ask main for a "Choose file(s) to attach" dialog and append the chosen paths one per line. A tap on the textarea SHALL ask main to focus the strip window before focusing the box. Open WebChat SHALL not be offered. Covers AI-180–AI-185, AI-187–AI-189 (AI-186 excluded by the "Don't copy" list).

#### Scenario: Send without a key

- **WHEN** Send is pressed before any clawbot key was tapped
- **THEN** the warning "Please tap an AI assistant first!" shows for 1800 ms and nothing is sent

#### Scenario: Rejected typed send retains draft

- **WHEN** the runtime rejects a typed send as unavailable
- **THEN** main returns a rejected reply with its stable error code, and the input retains the draft
- **AND** accepted sends clear only the submitted draft, preserving edits made while awaiting the reply

#### Scenario: Profile or page change clears draft

- **WHEN** a profile or page switch reuses the input tile coordinate
- **THEN** the mounted input clears its typed draft, voice buffer and selected assistant

### Requirement: Localized strip copy

Overlay, tile and toast strings SHALL come verbatim from DK's en, zh, de, es, fr, it, ja and ko locales. The strip SHALL select a locale from the renderer language, falling back to English, and the idle placeholder SHALL be localized. Covers AI-208.

#### Scenario: German renderer

- **WHEN** the renderer language is `de-DE` and a knob capture is preparing
- **THEN** the overlay reads "Aufnahme wird vorbereitet"

### Requirement: Mock voice runtime

Only with `OPEN_QUAKE_MOCK_DEVICE=1` (the device mock's switch) or in the native smoke, main SHALL bind the voice runtime port to a scripted runtime:

1. preparing 300 ms, then listening
2. levels every 50 ms with partial transcripts
3. processing with the final transcript on release
4. answer chunks every 60 ms
5. idle completed

It SHALL call no provider and SHALL mark itself mock. Without mock mode and without a runtime, a voice start SHALL publish `failed` with reason `unavailable`. Covers the lane's hardware-free development rule.

#### Scenario: Scripted turn under TestClock

- **WHEN** a mock grid capture starts and is released at 1500 ms
- **THEN** the published sequence is preparing, listening, speaking with partials, processing, TurnStarted, answer chunks, end completed, idle completed

#### Scenario: No runtime

- **WHEN** mock mode is off and a long press starts a capture
- **THEN** the stage `failed` with reason `unavailable` is published, with the error tone and key alert

#### Scenario: Mock capture ownership

- **WHEN** cancellation or release targets another key or a stale generation
- **THEN** the current mock capture continues with its original key and capture ID
- **AND** cancellation of its owning key and generation closes that capture and its mic bar
