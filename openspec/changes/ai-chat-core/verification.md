# L6 specification verification

Verified on 2026-10-23 in branch `lane/specs-ai-voice`. This report covers planning artifacts only. No implementation, provider login, audio recording, hardware session, or DK-Suite process was started.

## Scope

Seven new changes: ai-provider-facade, ai-chat-core, ai-chat-modes, voice-stt-tts, knob-push-to-talk, agent-runtime, and soundboard-playback. Each contains proposal.md, design.md, tasks.md, a capability spec, and OpenSpec metadata. The chat-core directory also contains this report and the parent Beads handoff. Existing change directories, source files, hooks, dependency manifests, and tracker data were not edited.

The specifications contain 58 SHALL requirements, 77 WHEN/THEN scenarios, and 67 unchecked implementation tasks. Every design marks unsettled decisions as `Proposed (pending Ramiro)` and records package ownership, evidence tiers, deliberate replacements, risks, and migration/rollback.

## Commands and observed results

```text
pnpm install
exit 0; lockfile up to date; 117 packages reused; prepare completed

pnpm run lint
exit 0; Checked 29 files in 14ms. No fixes applied.

pnpm run typecheck
exit 0; Tasks: 6 successful, 6 total; Cached: 6 cached, 6 total

pnpm run test
exit 0; Tasks: 2 successful, 2 total; Cached: 2 cached, 2 total
cached reports: protocol 2 tests passed; device 1 test passed

openspec validate --all
exit 0; Totals: 11 passed, 0 failed (11 items)

openspec validate --all --strict
exit 0; Totals: 11 passed, 0 failed (11 items)

git diff --cached --check
exit 0; no whitespace errors
```

Turbo typecheck/test results came from the shared worktree cache. They check the unchanged repository baseline, not the future AI/voice behavior. No desktop source was touched, so the lane's conditional desktop build gate did not apply.

Each new change's `openspec status --change <name> --json` reports all four planning artifacts done and `isPlanningComplete: true`. Open implementation tasks remain unchecked. A read-only structural audit confirmed required artifact files, Purpose sections, SHALL/scenario shape, WHEN/THEN pairs, decision markers, numbered task checkboxes, and existence of every explicitly named recovered-source file. The staged-path audit restricts additions to the seven new directories.

## Evidence limits and open decisions

- Codex device login is documented; a supported Vercel inference bridge, isolated helper grant storage, and the integration choice remain pending. No login was attempted.
- DashScope's active recovered TTS route is HTTP/SSE. Its current audio descriptor and STT final-segment rule still require adapter probes before release.
- The cited title helper proves preset-label localization, not automatic conversation summarization. Optional generated titles are a proposed extension.
- Physical panel transfer/touch, knob hold/release timing, microphone permissions, real playback, live model/provider behavior, gateway compatibility, and Linux behavior are unverified.
- No npm dependency was added. Future SDK/provider/GT packages require approved exact versions and catalog pins during implementation.
- Beads was not run by this lane. The parent must create/reconcile the epic/task records in beads-handoff.md and attach verification before closing implementation work.
