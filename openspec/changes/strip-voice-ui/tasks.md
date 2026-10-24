# Tasks

Beads: epic `open-quake-lih.5.1` under cluster `open-quake-lih.5`; one task bead
per numbered item below (`open-quake-lih.5.1.1` … `open-quake-lih.5.1.11`).

## 1. Spec

- [ ] 1.1 Write this change with the recovered geometry, timings, strings and audit row ids; `openspec validate --all --strict` passes. (`open-quake-lih.5.1.1`)

## 2. Voice surface domain (`packages/edge/src/voice/surface/`)

- [ ] 2.1 Add the `VoiceSurfaceEvent` contracts, the feedback mapping (tones, key alerts), the tile status mapping, the hold-to-talk key classifier and the level meter; unit and property tests. (`open-quake-lih.5.1.2`)
- [ ] 2.2 Add the hold-to-talk reducer and the `GridVoice` service with Clock-driven deadlines; TestClock tests cover every scenario in "Hold-to-talk on AI keys", and a property test proves one release per press. (`open-quake-lih.5.1.3`)
- [ ] 2.3 Add the `VoiceSurface` service: per-device stage dedupe, active-flow tracking, feedback through `VoiceTonePort`, fan-out through `VoiceSurfacePublisher`; tests. (`open-quake-lih.5.1.4`)

## 3. Desktop main

- [ ] 3.1 Add `main/voice/`: the `voice:surface` broadcast, the decoded `voice:input` channel with the app-renderer guard, link opening, copy, file pick and focus, the tone recorder port, and the scripted mock runtime (TestClock tests); the preload bridge; one registration call in `main/index.ts`. (`open-quake-lih.5.1.5`)

## 4. Strip renderer

- [ ] 4.1 Add `strip/overlays/voice/`: overlay reducer with countdown, waveform and mic bar geometry and canvases, subtitle band with marquee, localized strings, reduced motion; tests. (`open-quake-lih.5.1.6`)
- [ ] 4.2 Add the key alert, cancel indicator, clawbot dot and strip toast; register `aiChat` and `clawbot` voice key tiles; add the HTML overlay slot and tile overlay hook to `StripScreen`. (`open-quake-lih.5.1.7`)
- [ ] 4.3 Add `strip/tiles/aiCopilot/` (layout, status machine, orb, hints, copy); tests. (`open-quake-lih.5.1.8`)
- [ ] 4.4 Add `strip/tiles/clawBot/` (card, header, pill, conversation reducer with transcript merge and hint dedupe, rich text, link chips, tool cards); tests. (`open-quake-lih.5.1.9`)
- [ ] 4.5 Add `strip/tiles/clawBotInput/` (header, textarea, buttons, warnings, voice buffer, send, attach, focus); tests. (`open-quake-lih.5.1.10`)

## 5. Verification

- [ ] 5.1 Add the voice native smoke (hidden windows, mock levels, no HID) capturing every overlay stage and the three chat tiles at 1920×480; run biome, typecheck, test, build, bundle smoke and strict OpenSpec validation; open the PR. (`open-quake-lih.5.1.11`)
