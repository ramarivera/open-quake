# PR #28 review round 2

Verified on 2026-10-24 in `/Volumes/ExtSSD/devplane/oq-strip-voice`, branch
`lane/strip-voice`, starting from reviewed head
`d22228775568a8dc5c8d1724915c6f0c7694f5f8`. This is one fix round covering
all nine findings received against that head. No dependencies were added.
The fix commit is `1bb5376ce0554a744c2e2eb152d9170c814e0a92`.
Both voice and monitor tile registrations, runtime registrations and disposal
paths remain present. The PR remains open and unmerged.

## Thread dispositions

All nine findings were confirmed against the implementation and fixed. Each
received a specific reply linking `1bb5376` with the attribution
"Implemented by Codex (gpt-6.1-sol).", then was resolved. The final full
GraphQL fetch and comment-curator fetch confirm 16 of 16 threads resolved,
including the seven from round one. The new CodeRabbit replies acknowledge
fixes and add no actionable finding. No pagination remains unread.

| Thread | Fix and evidence |
| --- | --- |
| [Selection-only tap](https://github.com/ramarivera/open-quake/pull/28#discussion_r4366952776) | Copilot clears initializing state, active key and watchdog when no capture started. Only a recording release enters processing; foreign key up cannot release its owner. Voice-store regressions and the mounted native tap followed by another key's completed answer pass. |
| [Device disconnect](https://github.com/ramarivera/open-quake/pull/28#discussion_r4366952778) | The production DeviceBus listener calls `voice.onDevice` before forwarding status. It gates input synchronously, resets GridVoice with reason disconnected, cancels capture or processing, and broadcasts Reset after cancellation. Reset wins over overdue deadlines; touch teardown never emits voiceTouchEnd. TestClock, actual IPC-handler and raw mock-device native tests prove no delayed capture or interrupted submission. |
| [Transcript prefix](https://github.com/ramarivera/open-quake/pull/28#discussion_r4366952780) | `LiveTranscript.prefix` separates preceding sentences from the current hypothesis. Growing, shrinking and corrected partials replace only the suffix in both consumers. Final transcripts remain authoritative full replacements, matching recovered `QuakeBotIconView.vue:1494-1507`. Exact first-sentence/Next/Next-sentence regressions and mounted live-row/input assertions pass. |
| [Capture ownership](https://github.com/ramarivera/open-quake/pull/28#discussion_r4366961132) | Conversation capture key, capture ID and agent survive typed-only B selection during A recording. A's final voice message uses `TurnStarted.prompt`, with event agent or captured agent fallback. Reducer and native tests retain Weather's complete corrected prompt while Coder remains selected for typed input. |
| [Committed key map](https://github.com/ramarivera/open-quake/pull/28#discussion_r4366973485) | `keysRef.current` updates in a layout effect, so dispatch cannot read an abandoned render's key map. Forced typecheck and the native profile-switch/selection paths pass. |
| [Rejected bridge promise](https://github.com/ramarivera/open-quake/pull/28#discussion_r4366973487) | The Effect request boundary returns a typed rejected reply with catalog code `VOICE.SURFACE.REQUEST_FAILED`. `VoiceSurfaceRequestFailed` retains the original cause privately and uses the existing diagnostic scrubber. Both rejecting and synchronously throwing bridge tests pass, along with missing, malformed and accepted replies and serialization privacy assertions. |
| [Repeated history work](https://github.com/ramarivera/open-quake/pull/28#discussion_r4366973493) | Message bodies memoize stable message identity, the link callback depends on the stable request function, and time formatters cache by supported locale. The native streamed conversation remains correct. No timing claim or implementation-mirroring memo test is made. |
| [Code fences](https://github.com/ramarivera/open-quake/pull/28#discussion_r4366973497) | Backtick and tilde openers retain their marker and length. Closing lines require the same marker, at least the opener's length and whitespace alone afterward. Four parser cases cover nested shorter fences, wrong characters, trailing text and longer valid closers, including the paragraph after the block. |
| [Knob/grid race](https://github.com/ramarivera/open-quake/pull/28#discussion_r4366973502) | Knob and grid actions share the GridVoice lock and explicitly reserve capture ownership before the adapter starts. Two deterministic deferred-adapter/TestClock tests cover both start orders without any Stage publication. Busy behavior remains intact and unavailable failures release reservations. The lock-only counterfactual fails with two starts rather than one. |

## Regression paths

- `packages/edge/src/voice/surface/grid-voice-service.test.ts` covers both
  concurrent start orders, disconnect before long press and during release
  grace, active-flow cancellation and unavailable reservation cleanup.
- `packages/edge/src/voice/surface/hold-to-talk.test.ts` proves reset skips
  overdue capture and release effects and leaves no deadline.
- `apps/desktop/src/main/voice/voice-ipc.test.ts` exercises the registered
  handler, disconnect input gate, Reset broadcast and reconnect acceptance.
- `apps/desktop/src/renderer/src/strip/overlays/voice/voice-state.test.ts`
  covers selection-only tap, foreign release, prefix replacement in both
  consumers, independent capture agent and authoritative final prompt, plus
  clearing all renderer voice deadlines and state on disconnect.
- `voice-request.test.ts`, `clawbot.test.ts` and `touch-controller.test.ts`
  cover rejected requests, transcript/fence cases and disconnect release
  cancellation. Existing round-one regressions still pass.
- `apps/desktop/src/main/voice/review-round-2-smoke.ts` uses native pointer
  input and raw mock reports through touch parsing, preload, IPC, GridVoice
  and the mounted renderer. It checks the tap/following-answer chain,
  growing/shrinking/final transcripts, A/B ownership and disconnect both
  before and during capture. Its bus listener preserves production status
  ordering. Mock status injection and disabling timed demo input make the
  fixture deterministic.

## Verification

All six gates pass:

| Command | Result |
| --- | --- |
| `pnpm biome check packages apps` | 463 files, no fixes |
| `pnpm exec turbo run typecheck --force` | Six tasks pass |
| `pnpm exec turbo run test --force` | 1,033 tests across 103 files, zero cached tasks: protocol 47, edge 82, device 388, desktop 516 |
| `pnpm build` | Pass |
| `pnpm --filter @open-quake/desktop test:bundle` | Pass |
| `openspec validate --all --strict` | 36 items pass |

Voice, knob, media and monitor native mock fixtures each pass, built with
`pnpm --filter @open-quake/desktop exec electron-vite build --config src/main/<fixture>/smoke.config.ts`
and run sequentially with
`env -u ELECTRON_RUN_AS_NODE OPEN_QUAKE_MOCK_DEVICE=1 pnpm --filter @open-quake/desktop exec electron out/<fixture>-smoke/smoke.js <artifact-directory>`.
TMPDIR is on ExtSSD. The runner records command, exit status and elapsed time,
with bounded subprocess timeouts and process-group cleanup. No task-owned
Electron child remains after completion.

After the full run, the ownership screenshot was corrected to wait for its
entrance animation. Biome, forced typecheck, the voice fixture build and its
complete native smoke pass again. The refreshed screenshot visibly shows
Weather's authoritative corrected voice prompt and answer while the input
header remains Coder. This timing change affects only the fixture.

The knob fixture logs a missing `quake:lifecycle` handler during its isolated
run, alongside expected dispatch/capability warnings. Its assertions and
exit status pass. The monitor native probe reports CPU unavailable and GPU
unsupported on this host; fixture rendering and available sampler checks pass.
No native check failed with an Xcode error and no host repair was attempted.

## Artifacts

Primary scratch directory:
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/strip-voice/review-round-2/`.

- `run-verification.py`, `verification.json` and the six gate logs record
  the full run; `voice-smoke.log`, `knob-smoke.log`, `media-smoke.log` and
  `monitor-smoke.log` record the four native outcomes.
- `voice-timing-verification.json` and `voice-timing-*.log` record the final
  voice rerun after screenshot timing correction.
- `race-lock-only-counterfactual.log` records the deliberate failing test
  with the lock retained but the knob reservation removed. Production source
  was restored before the passing gates.
- `voice/voice-round2-selection-only-tap.png` and
  `voice/voice-round2-following-answer.png` show the cleared pending state
  and a later completed answer.
- `voice/voice-round2-transcript-prefix.png` shows the full final transcript
  in both live row and input; `voice/voice-round2-capture-owner.png` shows
  the corrected Weather voice group with Coder selected.
- `voice/voice-round2-disconnected-pending.png` and
  `voice/voice-round2-disconnected-capture.png` show cleared voice UI on
  link loss. Native assertions also prove no new conversation turn and
  no end tone from the interrupted recording.
- Other voice, knob and media screenshots are in `voice/`, `knob/` and
  `media/`. The monitor fixture enforces its own prefix, so its five captures
  are in `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/monitor-panel/voice-review-round-2/`.
- `threads-before.json`, `threads-pre-finish.json`, `threads-after.json`,
  `thread-outcomes.json` and the comment-curator text snapshots preserve the
  findings, attributed replies and verified resolutions.

## Advisory and remaining acceptance

CodeRabbit's old-head check was SUCCESS and Macroscope was SKIPPED. Those
statuses did not remove the nine unresolved blockers. Its separate docstring
advisory reported 64.65% against a default 80%, analyzing 99 functions across
50 files while skipping 30 functions for unsupported inputs or the file limit.
That result is inconclusive. No source-enforced threshold was found. Useful
ownership, request-boundary, reservation and mock-status contract comments
were added with the fixes; no blanket docstring churn or bot checkbox was used.
The saved advisory is `strip-voice/coderabbit-summary-current.txt` under the
shared parity scratch root. The parent owns required-check inspection before
merge and subsequent review findings.

Task 6.3 and bead `open-quake-lih.5.1.14` remain open for physical QUAKE
rendering, real microphone levels and provider delivery, touch/knob gestures
and buzzer output. These checks used mocks only and opened no device.
DK-Suite was not started. Task 6.4 is verified and round bead
`open-quake-lih.5.1.15` closes with source and verification evidence.
The voice epic and parity cluster remain open. Bot re-review is requested
after the final evidence push; its outcome and required checks remain for
the parent to inspect. This worker does not merge, watch or poll the PR.
