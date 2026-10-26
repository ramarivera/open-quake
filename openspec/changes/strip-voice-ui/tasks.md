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

- [x] 6.5 Diagnose the overlapping idle Copilot hint with mounted glyph/Range geometry against recovered DK spacing (AI-196); restore legible English and locale text with appropriate wrapping while preserving the 100 ms highlight, reduced motion, orb, state and tile geometry. Preserve missing/blank ClawBot assistant IDs through input selection (AI-184), with mounted warning/no-SendText regressions. Reconcile AI providers main `9e3dd4f`, retaining voice and knob shutdown ownership. Add a native geometry regression, run six gates and voice/knob/media/monitor native mock smokes, inspect fresh captures and record round-three evidence. (`open-quake-lih.5.1.16`)

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

Not verified: real buzzer output, real microphone levels at the time of that original smoke, knob holds and touch on the device, and rendering on the
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


## 7. Capture and consumer parity, 2026-10-26

- [x] 7.1 Wire capture RMS and peak through the normalized meter, 50/180 ms throttling and 15-buffer VAD, resetting per capture; TestClock consumer regressions. (`open-quake-lih.5.2`, KNOB-050, KNOB-054)
- [x] 7.2 Adopt the 100 ms blur refocus only while the strip chat input owns its active surface; cancel on close, ownership change and unmount; mounted focus regression. (`open-quake-lih.5.3`, AI-183)
- [x] 7.3 Toggle read-aloud per serial/key, publish thinking/speaking/idle to the pill, render dots/wave FX and apply 8 s resume, duration + 5 s and 12 s no-audio watchdogs; consumer regressions. (`open-quake-lih.5.4`, AI-155, AI-156)
- [x] 7.4 Publish correlated meeting stages 0–5/status 0–2 from capture, merge, upload, ASR, transcript and summary; consume in the mounted strip display with stale-id, cancellation and reset regressions. (`open-quake-lih.5.5`, AI-267)

These four beads stay open for lead integration. Physical acceptance 6.3,
live provider qualification and the Auto router are outside this lane.


Evidence for tasks 7.1–7.4 on `feat/strip-voice-parity`:

- 7.1: `apps/desktop/src/main/speech/runtime-levels.test.ts` drives the real
  capture, STT socket, VoiceSurface and renderer reducer. TestClock checks
  49/50 ms, 179/180 ms, peak-only activity, quiet buffers 14/15, continued
  capture and immediate first emission after a capture reset. The serialized
  audio-worker regression also verifies RMS and peak from synthetic samples.
- 7.2: `apps/desktop/src/main/voice/parity-smoke.ts` mounts the real input and
  uses deterministic renderer timers to check 99/100 ms, reset without an
  assistant, assistant ownership changes, FunctionWheel, full voice overlay,
  chat-surface unmount and a delayed FocusPanel reply. Native window focus is
  intercepted; no foreground app is activated.
- 7.3: `main/speech/read-aloud.test.ts` has eight consumer tests for second
  taps during readiness, playback and synthesis, different-key replacement,
  reset, stale sessions, the 8 s resume and restarted duration + 5 s deadline,
  and 12 s without audio. Receiving partial audio before 12 s allows the
  synthesis stream to continue. Edge `speech-watchdog.test.ts` adds three
  exact-clock cases for unknown 30 s, minimum 8 s and a hung context probe.
  The native smoke verifies the pill's 3/3/7 dots/bars and second-tap stop
  through the production renderer, preload, IPC and speech controller.
- 7.4: `packages/edge/src/meetings/meeting-service.test.ts` passes 41 tests,
  including all twelve stage/status pairs, origin preservation on retry,
  cancellation of a delayed provider, failure and shutdown. The native smoke
  checks each real pipeline transition through the mounted strip and covers
  stale UUIDs, failure, cancellation, reset, and revealing the final minutes.

Gates pass: Biome checks 1,154 files with zero errors and 14 existing warnings;
all six package typechecks; 2,882 tests pass with four existing skips across
307 passing files and two skipped files; production build; both bundle-smoke
modes; strict OpenSpec validation, 46 items. The full test command uses
`TURBO_ENV_MODE=loose pnpm test -- --maxWorkers=2` with lane `TMPDIR`.
Unrestricted workers initially hit unrelated wall-clock timeouts; Turbo's
strict environment initially removed `TMPDIR`, causing macOS `/tmp` symlink
rejections in backup tests. Preserving `TMPDIR` and limiting workers passes
without source changes or relaxed assertions in those tests.

Both hidden native smokes pass: the media README gate and the parity gate
in `apps/desktop/src/main/voice/README.md`. They emit expected missing-handler
messages for optional modules outside those fixtures. Screenshots and logs:
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/strip-voice-2/`.
Representative files are `parity-meter-speaking.png`, `parity-pill-idle.png`,
`parity-pill-thinking.png`, `parity-pill-speaking.png`,
`parity-meeting-{0-1,1-1,2-1,3-1,4-1,5-1,5-2,failed,cancelled,reset}.png`,
`parity-meeting-minutes.png` and `parity-evidence.json`; the media set is in
`media/`. No real microphone, audible playback, HID, QUAKE or DK-Suite was used.
Live provider qualification, physical acceptance 6.3 / `open-quake-lih.5.1.14`
and the Auto router `open-quake-lih.15` remain unverified and out of scope.

## 8. PR #83 fix round

- [x] 8.1 Allow only the additional `state` and `resume` worker methods and prove suspended playback recovery through the production bridge. Reviews 4375970560 and 4376016278, AI-156, bead `open-quake-lih.5.1.18`.
- [x] 8.2 Render stopped manual recordings as recorded/idle after stage 1 completes. Review 4375970758, AI-267, bead `open-quake-lih.5.1.19`.
- [x] 8.3 Count WAV sample payload rather than metadata for the 12 s no-audio deadline. Review 4375970956, AI-156, bead `open-quake-lih.5.1.20`.
- [ ] 8.4 Include current meeting stage/status in snapshots for late strip mounts. Review 4375971137, AI-267, bead `open-quake-lih.5.1.21`.
- [ ] 8.5 Stop active read-aloud before validating a newer streaming answer. Review 4376016267, AI-155, bead `open-quake-lih.5.1.22`.

Each fix requires a regression observed failing before implementation, its own
normal commit/push and an attributed thread reply. Leave threads unresolved
and the PR unmerged. Run all six lane gates and hidden mock native smokes.
Evidence is stored under
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/strip-voice-2/fix1c/`.

8.1 regression `resumes suspended playback at 8 s through the production worker bridge`
failed before the fix with context state `suspended` instead of `running`. It uses
production `openAudioWorker`, desktop output, serialized worker and watchdog,
with a synthetic WebAudio implementation. No physical audio device is opened.

8.2 regression `shows recorded idle after a manual recording finishes merging`
failed before the fix because the mounted display markup showed processing and
uploading after stage 1/status 2. The recording now renders idle while retaining
its recorded state. The regression and desktop typecheck pass. Current fix-round
logs use `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/strip-voice-2/fix1d/`.

8.3 regression `WAV header without PCM times out at 12 seconds and clears the
read-aloud pill` failed before the fix, still pending at 12 seconds. Incremental
RIFF chunk parsing now waits for a full PCM sample, skipping metadata and padding.
Eleven read-aloud consumer tests cover ordinary/extended headers fragmented into
single bytes and samples arriving later. The speech protocol/service tests and
all six package typechecks also pass. Logs: `strip-voice-2/fix1d/0956-*`.
