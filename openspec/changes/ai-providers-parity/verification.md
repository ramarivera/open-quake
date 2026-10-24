# Verification

Source roots and intentional differences are in design.md and
packages/edge/src/ai/README.md. Tests drive AiProviderService through selected
profiles to fake HTTP/WebSocket, transcript callbacks and the player lease.
Router tests drive the facade and typed target consumer, including all routes,
explicit-mode bypass, pinned follow-ups, disabled HA and rejected expressions.

The ASR fixture uses begin_time and sentence_end for segment identity/finality.
This is protocol conformance with synthetic fixtures, not a live model claim.
No hardware, microphone, native audio, paid provider, SDK chat transport,
credential store, real integration target or renderer behavior was exercised.
No renderer files changed; the native screenshot gate does not apply.

The independent OpenAI TTS task open-quake-c5w.13 is covered by
speech/speech-service.test.ts through the actual facade-owned player consumer.
Native host bindings remain voice-stt-tts task 2.3; batching remains task 2.4;
physical mic-to-provider acceptance remains task 2.5. DashScope tasks 2.1/2.2
have protocol implementations but their live qualification requirement in 1.2
remains open, as directed by the no-paid-requests constraint.


All required lane gates passed on 2026-10-24:
- pnpm biome check packages apps: 250 files checked, no fixes.
- pnpm typecheck: 6 tasks successful.
- pnpm test: 4 tasks successful; edge has 57 passing tests in 8 files.
- pnpm build: desktop production build passed.
- env -u ELECTRON_RUN_AS_NODE OPEN_QUAKE_MOCK_DEVICE=1 pnpm --filter @open-quake/desktop test:bundle: default absence and mock connected paths passed, no hardware I/O and zero mock native enumerations, awaited quit.
- openspec validate --all --strict: 31 passed, zero failed.

Logs are local-only at /Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/ai-providers/.
No renderer changes, so no native UI screenshots were required. PR #27:
https://github.com/ramarivera/open-quake/pull/27. Beads tasks 1.1–1.5 and the
independent OpenAI TTS task carry source/test closure evidence.

The first shutdown regression failed on malformed input and early cancellation.
Combining the receive and send workers under Effect.all could propagate an
interruption without completing the waiting result. Independent scoped workers
now hand their errors to the result and both terminate with the capture scope.
The same regression tests pass without real-clock waits or extra timeouts.
