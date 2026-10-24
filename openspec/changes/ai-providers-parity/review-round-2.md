# PR #27 review round 2

On 2026-10-24, five new review threads on `ec013348b7e0b451eb43bd2961a8da9d5a9df468`
were independently confirmed against source and a fresh GitHub GraphQL snapshot.
All five are addressed in `9473f3250f137c1e341680551cf9d63fa5fb94a0`, pushed to
`lane/ai-providers`. Each thread received a fix-SHA reply attributed to
Codex, `gpt-6.1-sol`, before resolution. Earlier review dispositions remain intact.

OpenSpec task 4.1 was added under `open-quake-lih.15.1.16` and strict change
validation passed before implementation. The new scenarios clarify existing
provider-control, persona and speech-framing contracts.

## Findings and regressions

- `PRRT_kwDOUADXpM6v4CTW`, discussion `r4367004781`: absent GPT-5.1 reasoning
  controls omit `reasoning_effort`; explicit disabled thinking without an effort
  emits `none`. Explicit low/medium/high and enabled thinking remain supported.
  Existing conflicting-control rejection remains. The facade test covers all
  controls, and Auto expects `none` when disabling GPT-5.1 thinking while retaining
  configured daily/deepThink effort. The wire-options schema now accepts `none`.
- `PRRT_kwDOUADXpM6v4CTc`, discussion `r4367004789`: router failure cases pair
  each input with its expected tag. Expressions, malformed JSON, unknown category,
  trailing text and prose assert `AiProtocolInvalid`; disabled operatingEquipment
  asserts `AiConfigInvalid`; TestClock timeout asserts `AiUnavailable` and aborted
  transport. Invalid output still dispatches no target.
- `PRRT_kwDOUADXpM6v4CTd`, discussion `r4367004790`: `RoleSelection` rejects a
  supplied `customPrompt` on preset IDs, including empty text. Custom text belongs
  to role -1. Tests prove rejection before credentials or adapter calls and that
  role -1 sends the supplied system prompt. Valid presets retain their prompt.
- `PRRT_kwDOUADXpM6v4CTe`, discussion `r4367004791`: WAV verification accepts
  `0xffffffff` for RIFF and final data lengths, deriving final sample bytes from
  the completed response. Streaming data requires a preceding verified fmt chunk.
  A fragmented HTTP-to-player fixture carries signed 24kHz mono 16-bit PCM and
  verifies exact bytes and 20ms duration. Cases cover either/both sentinels, bad
  ordinary lengths, chunk overflow, invalid PCM fields, empty/odd/truncated data,
  unknown sentinels, nonfinal streaming data and duplicate chunks.
- `PRRT_kwDOUADXpM6v4CTh`, discussion `r4367004798`: DashScope treats JSON null
  and string "null" as progress, with only stop completing synthesis. The shared
  multiline SSE fixture now carries string-null. Tests cover JSON null, unsupported
  strings/types, missing stop for both null forms, and frames after stop, preserving
  exact protocol-error identity and PCM order.

The first pre-fix focused run recorded six failing regressions and 21 passing
tests. After corrections and the final malformed-WAV cases, the focused run
passed 28 tests in four files. The six failures included the new default/persona,
streaming-WAV and null-reason cases; two turn-result assertion failures rendered
as Effect stack errors, while direct audio validation and synthesis tests also
showed the format/protocol failures. Logs preserve the exact output.

## Source verification

Official pages were fetched on 2026-10-24, without a provider inference call:

- [OpenAI GPT-5.1](https://developers.openai.com/api/docs/models/gpt-5.1)
  documents reasoning efforts none, low, medium and high, with none as default.
- [OpenAI Chat Completions create](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
  includes none in the reasoning-effort wire schema.
- [DashScope Qwen-Audio-TTS HTTP reference](https://www.alibabacloud.com/help/en/model-studio/qwen-audio-tts-http-api)
  defines null as progress and stop as completion, with a JSON-null streaming
  example. String-null compatibility is additionally covered by the reviewed
  protocol fixture.

WAV sentinel support is bounded parser compatibility tested with synthetic
fixtures. This work does not establish live OpenAI response headers, current
workspace/model availability, or full provider qualification. Recovered model
names and legacy mini-model policy are not live-availability guarantees.

## Integration and six gates

The single final main fetch returned `bdf8ca82dbaa661d30dab5514178369420cdb0e5`.
It was already an ancestor of the fix; no merge was needed. No additional main
fetch, review polling, paid rerun request, watch or merge was performed.

All gates ran against `9473f32`, from 11:45:30 through 11:45:51 UTC:

- `pnpm biome check packages apps`: 427 files, passed.
- `pnpm exec turbo run typecheck --force`: six successful tasks, zero cached.
- `pnpm exec turbo run test --force`: 957 tests passed, zero cached tasks.
  Desktop 441, device 388, edge 81, protocol 47, across 100 test files.
- `pnpm build`: fresh production build, zero cached build tasks, passed.
- `pnpm --filter @open-quake/desktop test:bundle`: both default typed device
  absence and explicit mock passed, with awaited quit and no hardware I/O.
- `openspec validate --all --strict`: 36 items passed, zero failed.

The final delivery commit only records evidence and tracker completion; it
changes no implementation. No renderer changed, so screenshots were unnecessary.

Logs, exact commands, gate exit codes, source-page snapshots, thread mutation
responses and process audit are retained under
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/ai-providers/review-round-2/`.
The reproducible runner is `run-gates.py`. Documentation snapshots and the initial
thread snapshot are in the parent `ai-providers/` scratch directory.

## Advisory, tracking and limits

CodeRabbit's reviewed-head docstring advisory was 16.67%, with 18 analyzed
functions across 28 files and 13 unsupported files skipped. Useful comments were
added for provider snapshot/control intent, custom-role validation, WAV sentinels,
and SSE completion. No broad generated documentation or coverage-score claim was
made. The advisory is not a source defect or proof of correctness. No paid review
was requested, and a green bot status does not replace substantive acceptance.

All five new threads are valid, addressed and resolved. Review task 4.1 and
`open-quake-lih.15.1.16` are complete. The implementation epic remains open.
Task 3.2 / `open-quake-lih.15.1.15` and shared speech task 2.6 /
`open-quake-c5w.13` remain open for production consumers and authorized live
qualification. Caller-owned conversation route identity remains the contract.
Synthetic speech fixtures do not close live qualification or physical acceptance.

All work stayed in `/Volumes/ExtSSD/devplane/oq-ai-providers`. No dependencies,
real HID, live paid inference, DK-Suite, firmware or host Xcode changes were used.
Commands used `OPEN_QUAKE_MOCK_DEVICE=1` and removed `ELECTRON_RUN_AS_NODE`.
Both bundle cases use injected native discovery and never open hardware.
Hooks remained active. A post-verification/push process audit found no worktree
processes and no DK-Suite processes. Final PR check state is recorded separately
in the handoff snapshot; the parent owns independent acceptance and merge.
