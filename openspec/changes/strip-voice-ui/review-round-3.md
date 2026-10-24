# PR #28 review round 3

The idle Copilot hint is readable, and an unconfigured ClawBot key now shows
the missing-assistant warning instead of sending to a synthetic assistant.
This is task 6.5, bead `open-quake-lih.5.1.16`, on `lane/strip-voice` in the
existing `/Volumes/ExtSSD/devplane/oq-strip-voice` worktree. No helpers or
additional worktrees were used.

Source fix: `85c3e23129f9def85658394fa0b8ff7a90810987`.
Verified source and native capture correction:
`3f98e8af8f88ce40f8c860f3487a1ca5f038acad`.
Main integration: `498a49f227a492edb909d094c66a5d21746135e8`, containing
AI providers main `9e3dd4f0abd0aec664ef01eb5c21f8ed3572883f`.
The earlier nine fixes in `1bb5376` and evidence head `971596d` remain in
the ancestry. The integration merged without conflicts. AI router/speech
and voice surface package exports are all present. Knob registration keeps
its abort-before-drain shutdown; main retains both knob and voice disposal.

## Recovered intent and measured cause

Recovered `v0.4.95/recovered_sources/src/views/Components/AIChatIconView.vue`
lines 100–113, 435–467, 1043–1076 and 1394–1405 specify the AI-196 idle hint:
30/45 px, centred, 60% white, inline character spans, negative tracking of
0.12 em, nowrap and a cyan character advancing every 100 ms. These are local
research inputs under `/Users/ramarivera/dev/dark-encyclopedia/dk-suite-introspeccion/`.

The mounted renderer reproduced the lead screenshot. Range positions and
Canvas font metrics showed `P` advancing 16.421875 px rather than its natural
20.009766 px. The narrowest advance retained 46.2% of its natural width.
Thirteen adjacent ink bounds overlapped by more than 0.75 px. Switching only
to DK's inline layout still reproduced the compression. Switching only to
normal tracking removed those overlaps in the flex probe. Negative tracking
was the cause; available panel width was sufficient.

We deliberately improve this DK defect. The hint uses normal tracking,
real spaces and one inline text run inside its existing centred flex area.
Translations wrap at words, with an emergency break for an overlong word.
The font size, line height, colour, highlight timer, orb, state machine and
tile dimensions are unchanged. The native check permits the font's normal
kerning, including CJK shaping, while detecting additional compression.

## Missing-assistant finding

Thread `PRRT_kwDOUADXpM6v4Ckw`, [discussion 4367006633](https://github.com/ramarivera/open-quake/pull/28#discussion_r4367006633),
was confirmed against source and the AI-184 spec. `keyInfo` already maps
missing or blank action values to `Option.none()`. The voice reducer then
replaced that with `default` before `selectInput`, bypassing `checkSend`.
The fallback now remains only at the conversation display boundary.

Three unit cases cover absent, empty and whitespace-only IDs through
`keyInfo`, the voice reducer and `checkSend`. Native pointer selection covers
absent and blank IDs through the built renderer, preload and real IPC handler.
Both warn "Please select your assistant!", retain the draft and emit no
`SendText`. The observed IPC boundary also records real selection requests.
Before the fix, the same mounted path sent `SendText` with `agentId: default`
and consumed the draft. The unit and native counterfactual logs are retained.

## Verification

Final checks run after integrating AI providers main and the native capture
correction, with `ELECTRON_RUN_AS_NODE` unset and `OPEN_QUAKE_MOCK_DEVICE=1`.

- `pnpm biome check packages apps`: pass.
- `pnpm exec turbo run typecheck --force`: six tasks pass, uncached.
- `pnpm exec turbo run test --force`: 1,090 tests in 111 files pass, zero
  cached tasks: protocol 47, edge 133, device 388, desktop 522.
- `pnpm build`: pass.
- `pnpm --filter @open-quake/desktop test:bundle`: both default HID absence
  and explicit mock cases pass without hardware I/O.
- `openspec validate --all --strict`: 37 items pass.
- Voice, knob, media and monitor native mock builds/runs: pass, sequential.

One earlier full run timed out in the unchanged profile IPC initialization
recovery test at its existing five-second limit. The isolated file then
passed both tests, and the final full uncached run passed all 1,090 tests.
No test timeout or profile implementation was changed. The failed run is
retained in `tests-timeout.log` and `verification-timeout.json`; the isolated
retry is in `profile-recheck.log`.

The voice fixture measures actual mounted glyph positions and font ink
bounds in all eight locales, in full and reduced motion. It observes the
English highlight advancing once per 100 ms, checks the static reduced state
and stopped orb, and constrains French to 420 px to prove wrapping without
shrinking glyphs. A two-frame paint wait with background throttling disabled
makes hidden-window screenshots reflect the current DOM; the earlier capture
could return the previous compositor frame for transient states.
The warning capture also waits for its fade-in to reach full opacity.

All eight locale images, wrapped French, reduced motion and both fully
visible warnings were inspected after this run. Fresh knob, media and
monitor captures were also inspected. Knob's fixture logs its missing
lifecycle handler and injected dispatch/capability warnings; its assertions
pass. The monitor's native probe reports CPU unavailable and GPU unsupported;
its five-style fixture and cleanup assertions pass. Neither result claims
physical device or live provider acceptance.

Evidence root:
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/strip-voice/review-round-3/`.
`verification.json` records all 14 commands, exits and durations. Gate and
native logs sit beside it. `diagnostic-geometry.json` and `diagnostic-*.png`
record the original, DK inline and normal-tracking probes. `hint-before.log`
and `missing-agent-before.log` show failing regressions;
`agent-native-before.log` and `agent-before/voice-round3-requests.json` show
the unwanted synthetic-assistant send.

Fresh `voice/` captures cover every locale, constrained French, reduced
motion, both missing-assistant warnings and the prior review regressions.
`voice-round3-hint-*.json` contains the measured geometry;
`voice-round3-hint-timing.json` contains the highlight observations;
`voice-round3-requests.json` contains the observed IPC requests.
Knob and media captures use `knob/` and `media/` here. The monitor fixture
requires its own prefix and writes to
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/monitor-panel/voice-review-round-3/`.

## Handoff

The finding received an [attributed reply](https://github.com/ramarivera/open-quake/pull/28#discussion_r4367063175)
with source SHA and verification evidence, then was resolved. The completion
snapshot `pr28-threads-after.json` confirms 17 of 17 threads resolved,
preserving the prior 16 resolutions. It records the pushed source head
`3f98e8a`, AI27 main base `9e3dd4f` and a clean merge state. No fresh-head
review completion is claimed or requested.

Task 6.5 and only bead `open-quake-lih.5.1.16` are complete. Physical task
6.3 (`open-quake-lih.5.1.14`), epic `open-quake-lih.5.1` and parity cluster
`open-quake-lih.5` remain open. Final documentation follows the verified
source commit and does not change executable code.

No lane-owned Electron or DK-Suite process remains. Eight temporary mock
user-data directories were removed after checking process liveness; logs,
captures and measured evidence remain in scratch. `cleanup.json` records
the removed directories. The existing worktree and branch remain available
for the parent's independent verification.

CodeRabbit's latest action was a rate limit, not a completed review. Its
previous docstring advisory remains inconclusive as recorded in round 2.
No paid API, review request, real HID, DK-Suite, firmware or Xcode change was
used. No dependencies were added. The parent owns final verification and
merge; this lane does not merge or watch the PR.

Implemented by Codex (gpt-6.1-sol).
