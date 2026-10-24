# PR #28 review round 1

Verified on 2026-10-24 in `/Volumes/ExtSSD/devplane/oq-strip-voice`.
Main at `19d7240` was merged in `d8267d3`, preserving lifecycle, profiles
management, voice registration, both preload bridges and combined tests.
All six distinct defects are fixed in
`2d8867e30ec652fc6b84b8b383bbc964ecc46fe8`. The PR remains open and unmerged.

## Review outcomes

Each thread was checked against the code. All seven were valid; the two busy
threads describe one defect. Each received a fix-commit reply with attribution,
then was resolved through GitHub GraphQL.

- [Devin busy overlay](https://github.com/ramarivera/open-quake/pull/28#discussion_r4366781387): expires after 3000 ms without an idle; replacement sessions clear the deadline.
- [Failed typed send](https://github.com/ramarivera/open-quake/pull/28#discussion_r4366781425): the unavailable error reaches IPC as a rejected reply, and the input clears only after accepted delivery.
- [Draft isolation](https://github.com/ramarivera/open-quake/pull/28#discussion_r4366781456): profile and page reset increments the input revision and clears the mounted textarea.
- [Codex busy overlay](https://github.com/ramarivera/open-quake/pull/28#discussion_r4366784196): the same 3000 ms expiry fix, verified while grid capture continues.
- [Typed-only assistant selection](https://github.com/ramarivera/open-quake/pull/28#discussion_r4366784203): clawbot selection routes independently of microphone eligibility and does not disturb a running Copilot capture.
- [Mock capture ownership](https://github.com/ramarivera/open-quake/pull/28#discussion_r4366784212): cancellation and release validate key ownership and generation where supplied.
- [Whitespace deltas](https://github.com/ramarivera/open-quake/pull/28#discussion_r4366784217): the answer accumulator skips only empty strings, retaining spaces, newlines and indentation.

## Regression evidence

- `packages/edge/src/voice/surface/grid-voice-service.test.ts`: TestClock coverage for typed-only selection, no capture reservation, wrong-key cancellation/release, stale-generation cancellation, continuing levels and correct terminal identity.
- `apps/desktop/src/main/voice/voice-ipc.test.ts`: actual request handler returns rejected/unavailable and ok for accepted mock typed sends.
- `apps/desktop/src/renderer/src/strip/overlays/voice/voice-state.test.ts`: exact busy expiry and replacement, reset revision, whitespace chunks and typed selection during active capture.
- `apps/desktop/src/main/voice/smoke.ts` and `review-smoke.ts`: actual GridVoice knob rejection and interruption during grid capture; native pointer and raw mock touch selection with false/absent voiceInput; accepted/rejected sends; profile and page switches retaining the same mounted textarea.

The native fixtures now compose the voice request handler in knob/media and
the knob handler in voice. The media registry probe isolates its synthetic
scroller from the real ClawBot targets. The voice smoke records all three
countdown renders independently of screenshot latency and waits for mounted
and completed states. Production hold timings are unchanged.

## Gates

All pass:

- `pnpm install`
- `pnpm biome check packages apps`: 436 files checked, no fixes.
- `pnpm typecheck`: six package tasks pass.
- `pnpm test`: 987 tests across 98 files. Protocol 47, edge 74, device 388, desktop 478. The first full run used `pnpm test --force`; the final run repeated desktop after fixture changes.
- `pnpm build`: desktop build passes. The first build used `pnpm build --force`.
- `pnpm --filter @open-quake/desktop test:bundle`: HID-default and explicit-mock cases pass without hardware I/O.
- `openspec validate --all --strict`: 35 changes pass.
- Voice, knob and media native mock smokes pass, built with each module's `smoke.config.ts` and run with `env -u ELECTRON_RUN_AS_NODE OPEN_QUAKE_MOCK_DEVICE=1` and the lane `TMPDIR`.

Logs and 42 screenshots are under
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/strip-voice/review-round-1/`.
Screenshot subdirectories are `voice/`, `knob/` and `media/`. GraphQL snapshots
are `threads-before.json` and `threads-after.json`; replies are recorded in
`thread-outcomes.json`.

## Remaining verification

Real QUAKE rendering, microphone capture/levels, physical knob/touch, buzzer
output and firmware delivery remain unverified. These checks used mock input
and opened no device. DK-Suite was not started. Bead `open-quake-lih.5.1.12`
closes this review round; epic `open-quake-lih.5.1` stays open for merge and
the existing hardware checklist.
