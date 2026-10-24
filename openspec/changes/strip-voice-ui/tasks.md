# Tasks

Beads: epic `open-quake-lih.5.1` under cluster `open-quake-lih.5`; one task bead
per numbered item below (`open-quake-lih.5.1.1` … `open-quake-lih.5.1.11`).

## 1. Spec

- [x] 1.1 Write this change with the recovered geometry, timings, strings and audit row ids; `openspec validate --all --strict` passes. (`open-quake-lih.5.1.1`)

## 2. Voice surface domain (`packages/edge/src/voice/surface/`)

- [x] 2.1 Add the `VoiceSurfaceEvent` contracts, the feedback mapping (tones, key alerts), the tile status mapping, the hold-to-talk key classifier and the level meter; unit and property tests. (`open-quake-lih.5.1.2`)
- [x] 2.2 Add the hold-to-talk reducer and the `GridVoice` service with Clock-driven deadlines; TestClock tests cover every scenario in "Hold-to-talk on AI keys", and a property test proves one release per press. (`open-quake-lih.5.1.3`)
- [x] 2.3 Add the `VoiceSurface` service: per-device stage dedupe, active-flow tracking, feedback through `VoiceTonePort`, fan-out through `VoiceSurfacePublisher`; tests. (`open-quake-lih.5.1.4`)

## 3. Desktop main

- [x] 3.1 Add `main/voice/`: the `voice:surface` broadcast, the decoded `voice:request` channel with the app-renderer guard, link opening, copy, file pick and focus, tones through hardware-controls' `playTone` (plus a recorder), the knob model's voice binding, and the scripted mock runtime (TestClock tests); the preload bridge; one registration call in `main/index.ts`. (`open-quake-lih.5.1.5`)

## 4. Strip renderer

- [x] 4.1 Add `strip/overlays/voice/`: overlay reducer with countdown, waveform and mic bar geometry and canvases, subtitle band with marquee, localized strings, reduced motion; tests. (`open-quake-lih.5.1.6`)
- [x] 4.2 Add the key alert, cancel indicator, clawbot dot and strip toast; register `aiChat` and `clawbot` voice key tiles; add the HTML overlay slot and tile overlay hook to `StripScreen`. (`open-quake-lih.5.1.7`)
- [x] 4.3 Add `strip/tiles/aiCopilot/` (layout, status machine, orb, hints, copy); tests. (`open-quake-lih.5.1.8`)
- [x] 4.4 Add `strip/tiles/clawBot/` (card, header, pill, conversation reducer with transcript merge and hint dedupe, rich text, link chips, tool cards); tests. (`open-quake-lih.5.1.9`)
- [x] 4.5 Add `strip/tiles/clawBotInput/` (header, textarea, buttons, warnings, voice buffer, send, attach, focus); tests. (`open-quake-lih.5.1.10`)

## 5. Verification

- [x] 5.1 Add the voice native smoke (hidden windows, mock levels, no HID) capturing every overlay stage and the three chat tiles at 1920×480; run biome, typecheck, test, build, bundle smoke and strict OpenSpec validation; open the PR. (`open-quake-lih.5.1.11`)

## 6. PR review

- [x] 6.1 Merge main and address PR #28 review round 1 with regressions, full gates and voice/knob/media native mock smokes; reply to and resolve the seven threads, push without merging. (`open-quake-lih.5.1.12`)

- [x] 6.2 Reconcile the merged monitor panel with voice, preserving both tile registries and native smoke registrations/cleanup. Run all six gates and voice, knob, media and monitor native mock smokes before integration. (`open-quake-lih.5.1.13`)

- [ ] 6.3 Accept voice layouts, hold-to-talk, touch, knob stages and buzzer output on the physical QUAKE with user-confirmed gestures. Verify live microphone levels and provider delivery after capture wiring lands; record display captures and HID logs under the hardware checklist. (`open-quake-lih.5.1.14`)

- [x] 6.4 Address all nine PR #28 second-round threads: selection-only taps, disconnect cancellation, transcript replacement, capture ownership, committed renderer key maps, rejected IPC promises, history rendering cost, code fences and concurrent knob/grid starts; add regressions, run six gates and voice/knob/media/monitor native mock smokes, then reply to and resolve handled threads. (`open-quake-lih.5.1.15`)

- [ ] 6.5 Diagnose the overlapping idle Copilot hint with mounted glyph/Range geometry against recovered DK spacing (AI-196); restore legible English and locale text with appropriate wrapping while preserving the 100 ms highlight, reduced motion, orb, state and tile geometry. Preserve missing/blank ClawBot assistant IDs through input selection (AI-184), with mounted warning/no-SendText regressions. Add a native geometry regression, run six gates and voice/knob/media/monitor native mock smokes, inspect fresh captures and record round-three evidence. (`open-quake-lih.5.1.16`)

## Verification evidence

Run in `/Volumes/ExtSSD/devplane/oq-strip-voice` on 2026-10-24, after merging
main at `cef6ee0` (touch #20, hardware #22, knob #24, clock #25, lifecycle #21):

- `pnpm biome check packages apps`: clean.
- `pnpm typecheck`: all packages pass.
- `pnpm test`: all packages pass. Voice tests:
  - `packages/edge/src/voice/surface/*.test.ts`: feedback table with a property
    test (one start and one terminal tone per capture), contracts, level
    meter, hold-to-talk reducer with property tests (one release per press,
    none within 150 ms, capture exactly 1000 ms after down), `GridVoice` and
    `VoiceSurface` under TestClock, the knob seam, and the mock runtime.
  - `apps/desktop/src/main/voice/voice-ipc.test.ts`: renderer guard, decoding,
    links, copy, file pick, Hello and the unavailable runtime.
  - `apps/desktop/src/renderer/src/strip/overlays/voice/*.test.ts`: stage texts,
    countdown, late partials, mic bar routing, drawing geometry properties,
    store routing, alerts, toasts and overlay markup.
  - `apps/desktop/src/renderer/src/strip/tiles/{clawBot,voiceKey}/*.test.ts`:
    transcript merge, conversation, hint dedupe, error copy, rich text, tool
    cards, ClawBotInput and tile registration.
- `pnpm build` and `pnpm --filter @open-quake/desktop test:bundle`: pass.
- `openspec validate --all --strict`: pass.
- Voice native smoke (`main/voice/smoke.ts`; hidden windows, mock levels and
  the mock runtime, no HID): PASS. Captures in
  `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/strip-voice/smoke/`.

Not verified: real buzzer output, real microphone levels (no capture adapter
calls the meter yet), knob holds and touch on the device, and rendering on the
physical strip.

PR #28 review round 1 completed in `2d8867e`: seven confirmed threads
covering six defects, all replied to and resolved. Main reconciliation is
`d8267d3` with `origin/main` at `19d7240`. Full gates and the voice, knob and
media native mock smokes pass. See [review-round-1.md](review-round-1.md)
for per-thread outcomes, regression coverage, commands and artifact paths.

Lead reconciliation with monitor main `bdf8ca8` passes all six gates,
including 1014 uncached tests and 36 strict OpenSpec items. Voice, knob,
media and monitor native mock smokes pass together. Both tile registrations
and both runtime disposals are retained; the monitor fixture now registers
the voice hooks mounted by the combined renderer. See
[lead-integration.md](lead-integration.md). Physical acceptance remains open.

PR #28 review round 2 fixes all nine confirmed findings in `1bb5376`.
Six gates pass with 1,033 uncached tests and 36 strict OpenSpec items, along
with voice, knob, media and monitor native mock smokes. All nine received
attributed fix-commit replies and resolutions; the final fetch confirms all
16 PR threads resolved. See [review-round-2.md](review-round-2.md) for source,
regressions, the lock-only race counterfactual, artifacts and the inconclusive
docstring advisory. Physical task 6.3 and the epic remain open.
