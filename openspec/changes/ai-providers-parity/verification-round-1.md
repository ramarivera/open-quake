# PR #27 review round 1

Merged origin/main at 19d7240 into the d6a6dad lane head without conflicts
(merge fdf3bee). Existing speech adapters, role models, thinking/search controls,
Auto mode and all 126 retained localized presets remain covered by the suite.

## Verified corrections

- PRRT_kwDOUADXpM6v3QSS: valid Kimi profiles without caller sampling ranges now
  dispatch mandatory temperature/top-p. Only the prepared profile snapshot
  supplies missing ranges; explicit values/ranges still fail when conflicting.
  Regression: ai-workflow.test.ts, both k2.5/k2.6, constraints and stored limits.
- PRRT_kwDOUADXpM6v3QS0 and PRRT_kwDOUADXpM6v3Qmn: classification controls are
  independent of daily defaults. The Auto regression drives the real facade
  and target with medium/high daily effort across three routing models, then
  verifies daily/deepThink still receive their configured effort/search.
- PRRT_kwDOUADXpM6v3QTX: DeepSeek rejects the vision role with text-only input
  even when the profile advertises image support. The regression asserts
  AI.PROVIDER.CAPABILITY_UNSUPPORTED/images before credentials or adapter calls.
- PRRT_kwDOUADXpM6v3Qms: configure/final deadlines include their sends and
  response waits. PCM sends use the remaining capture budget. TestClock
  regressions prove exact deadlines, interrupted sends, closed/aborted sockets,
  no late transcripts, subsequent playback/recognition and the retained
  60-second automatic stop. Existing malformed-frame/cancellation tests pass.

The first regression run failed on Kimi dispatch, Auto reasoning, DeepSeek
vision and all three stalled-send cases. After the corrections, the focused
suite passed 27 tests; the full edge suite passed 67.

## Declined changes and acceptance boundaries

- PRRT_kwDOUADXpM6v3QUA: the live response qualification gap is real, but no
  parser defect is established by this observation. Content-type checks and a
  terminal stop marker implement the current speech contract. Synthetic
  fixtures cannot qualify live workspace responses. No paid calls were
  authorized; voice-stt-tts task 1.2 remains open. No live conformance claim.
- PRRT_kwDOUADXpM6v3QUz: caller-owned session routes are intentional in
  design.md and the Auto requirement. VoiceRequest has no conversation ID;
  submit returns the chosen route for the caller to bind to its conversation.
  The existing explicit-key/pinned-follow-up test proves classification bypass.
  README.md now states conversation binding and clearing on a new conversation.
  A global service session registry would change this contract. Consumer UI
  integration remains separate work.

## Integration failure found by the required gate

The merged desktop failed the existing bundle smoke twice during mock shutdown:
knob.dispose awaited a queued profile read without cancellation. Instrumenting
the generated bundle isolated this wait; a longer diagnostic also exposed late
calls into the disposed runtime. No diagnostic code remains in source/build.

Knob registration now owns an AbortController for initialization, refresh and
dispatch, aborts before draining its queue, and rechecks disposal after awaited
initialization. Three registration regressions failed before the fix and pass
afterward, proving interrupted reads and no late runtime calls. The original
bundle smoke passes both cases without changing its deadline or assertions.
No renderer code changed relative to main, so the native UI screenshot gate
does not apply. This additional correction is bead open-quake-lih.15.1.11.

## Gates, 2026-10-24

- pnpm biome check packages apps: 401 files, no fixes.
- pnpm typecheck: 6 successful tasks (5 cached).
- pnpm test: 4 successful tasks (3 cached); protocol 47, device 388,
  edge 67, desktop 417 tests, 919 total.
- pnpm build: desktop production build successful, uncached.
- env -u ELECTRON_RUN_AS_NODE OPEN_QUAKE_MOCK_DEVICE=1 pnpm --filter
  @open-quake/desktop test:bundle: default absence and explicit mock passed;
  awaited quit, no hardware I/O, no native discovery in mock mode.
- openspec validate --all --strict: 35 passed, zero failed.

Logs, including red regressions and the original bundle failure, are local at
/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/ai-providers/round-1/.
TMPDIR for the bundle gate points there. No dependencies, hooks or hook
configuration changed. No paid provider, real device, microphone or DK-Suite
was used. Native/live acceptance and the shared voice-stt-tts tasks remain
open; the current shared tracker also leaves open-quake-c5w.13 open.

## Publication and thread resolution

Fix commit 40fdfcd0b6eeb8d71727a4ac4e4dd19d90ccc860 was pushed to
lane/ai-providers through the unchanged pre-push gates. All seven original
threads received addPullRequestReviewThreadReply and resolveReviewThread calls.
Five threads were fixed (including the duplicate Auto report); two code changes
were declined for the boundaries above. Reply evidence:

- Kimi: https://github.com/ramarivera/open-quake/pull/27#discussion_r4366932170
- Auto (Devin): https://github.com/ramarivera/open-quake/pull/27#discussion_r4366932332
- DeepSeek: https://github.com/ramarivera/open-quake/pull/27#discussion_r4366932448
- Live qualification: https://github.com/ramarivera/open-quake/pull/27#discussion_r4366932558
- Caller session identity: https://github.com/ramarivera/open-quake/pull/27#discussion_r4366932677
- Auto (Codex): https://github.com/ramarivera/open-quake/pull/27#discussion_r4366932813
- Recognition deadlines: https://github.com/ramarivera/open-quake/pull/27#discussion_r4366932935

Review-round beads open-quake-lih.15.1.6–11 are closed with source and gate
evidence, and the ai-providers-parity epic is closed again. PR #27 remains open;
no merge was performed. No PR watcher was started.

## Final main integration

The final fetch found PR #30 had advanced origin/main to bdf8ca8 after the
initial integration. Merge 38bf8c1aa4f42824503f7c793c12314e96514849 includes
that monitor panel change without conflicts and retains the AI review fixes.
The epic and verification bead were reopened for this integration. All six
gates were rerun on the combined source, then the beads were closed again:

- pnpm biome check packages apps: 425 files, no fixes.
- pnpm typecheck: 6 successful tasks, 4 cached.
- pnpm test: 4 successful tasks, 2 cached; protocol 47, device 388,
  edge 70, desktop 441 tests, 946 total.
- pnpm build: successful, uncached.
- env -u ELECTRON_RUN_AS_NODE OPEN_QUAKE_MOCK_DEVICE=1 pnpm --filter
  @open-quake/desktop test:bundle: both default absence and explicit mock
  passed, including awaited shutdown with no hardware I/O.
- openspec validate --all --strict: 36 passed, zero failed.

Logs use the *-integrated.log filenames in the scratch directory above.
There is still no renderer diff relative to origin/main, so the native UI
screenshot gate does not apply. No paid live calls or device access occurred.

## Additional finding during delivery

Thread PRRT_kwDOUADXpM6v33e1 appeared after the original seven were resolved.
The report is valid: DeepSeek treated thinking:false as unsupported, so an
initial Auto request failed before classification despite an explicit routing
model. DeepSeek now accepts disabled thinking without adding provider options.
Enabled thinking, reasoning effort and native search still fail before
credentials or adapter calls.

The new Auto test failed with AiConfigInvalid before the correction, then
passed through classification and target dispatch with empty provider options.
A second regression checks the exact tag/code and forbids credential/adapter
calls for enabled controls. The focused suite passes 16 tests. Logs:
deepseek-auto-before.log and deepseek-auto-after.log in the scratch directory.

All six gates were rerun after this correction:

- pnpm biome check packages apps: 425 files, no fixes.
- pnpm typecheck: 6 successful tasks, 4 cached.
- pnpm test: 4 successful tasks, 3 cached; protocol 47, device 388,
  edge 72, desktop 441 tests, 948 total.
- pnpm build: successful, uncached.
- env -u ELECTRON_RUN_AS_NODE OPEN_QUAKE_MOCK_DEVICE=1 pnpm --filter
  @open-quake/desktop test:bundle: both cases passed with awaited shutdown.
- openspec validate --all --strict: 36 passed, zero failed.

These final logs use *-deepseek-final.log. Fix commit
2c930eb08d070f3158fca742bfd4fe5ff6d01d10 was pushed through the normal hooks.
The additional thread was replied to with that SHA and resolved:
https://github.com/ramarivera/open-quake/pull/27#discussion_r4366961621.
Bead open-quake-lih.15.1.12 and the epic are closed with this evidence.
All seven original threads plus this additional thread are handled.

## Additional routing-budget finding

Thread PRRT_kwDOUADXpM6v36me also appeared during delivery. Its report is
valid: a fixed 2048-token override rejects otherwise valid Auto profiles with
smaller limits or no override support. Auto now reads the profile's supported
limit, caps the requested budget at 2048, and omits the unsupported override.
The later search-permission read is retained so a control change during
classification still takes effect before dispatch.

The facade regression failed with AiConfigInvalid before the fix. It now
proves dispatch for absent, 1, 1024, 2048 and 4096 limits, with compatible
sampling and unchanged saved profiles. Existing response-size, timeout and
explicit-mode/follow-up checks still pass. Logs: router-budget-before.log
and router-budget-after.log in the scratch directory.

All six gates were rerun on this source:

- pnpm biome check packages apps: 425 files, no fixes.
- pnpm typecheck: 6 successful tasks, 4 cached.
- pnpm test: 4 successful tasks, 3 cached; protocol 47, device 388,
  edge 73, desktop 441 tests, 949 total.
- pnpm build: successful, uncached.
- env -u ELECTRON_RUN_AS_NODE OPEN_QUAKE_MOCK_DEVICE=1 pnpm --filter
  @open-quake/desktop test:bundle: both cases passed with awaited shutdown.
- openspec validate --all --strict: 36 passed, zero failed.

These latest logs use *-budget-final.log. Fix commit
f1fa10df9d21dc9d6ac4036956c0e7b5c2661e0d was pushed through the normal hooks.
The thread received a reply naming the fix and was resolved:
https://github.com/ramarivera/open-quake/pull/27#discussion_r4366975958.
Bead open-quake-lih.15.1.13 and the epic are closed with this evidence.
The original seven threads and both additional findings are handled.
