# Beads updates

Parent handoff for lane L6. No bd command was run by this lane. Per COMMON.md, the parent must create these records and link them to the wayfinder map before implementation. Planning files are complete; no implementation issue is complete.

## Epic records

Create one epic per record below. Use the exact OpenSpec path in the description and attach each task issue as a child of its matching epic.

### ai-provider-facade

- Title: L6 parity: ai-provider-facade
- Type: epic
- Description: Specify the Effect/Vercel provider boundary, explicit BYO-key profiles, secure credentials, and the pending Codex device-login/inference integration.
- OpenSpec path: `openspec/changes/ai-provider-facade/`
- Status: open; planning delivered, implementation pending.

### ai-chat-core

- Title: L6 parity: ai-chat-core
- Type: epic
- Description: Specify normal streaming chat, ordered terminal events, sessions/deadlines, local history, safe management/panel rendering, and offline GT strings.
- OpenSpec path: `openspec/changes/ai-chat-core/`
- Status: open; planning delivered, implementation pending.

### ai-chat-modes

- Title: L6 parity: ai-chat-modes
- Type: epic
- Description: Specify normal-only first-release dispatch and later key configuration, PC/HA actions, analysis/media, search, selection, and emoji candidates.
- OpenSpec path: `openspec/changes/ai-chat-modes/`
- Status: open; planning delivered, implementation pending.

### voice-stt-tts

- Title: L6 parity: voice-stt-tts
- Type: epic
- Description: Specify independent DashScope STT/HTTP-SSE TTS, bounded capture/audio lifecycle, later realtime adapters, and explicit translation routing.
- OpenSpec path: `openspec/changes/voice-stt-tts/`
- Status: open; planning delivered, implementation pending.

### knob-push-to-talk

- Title: L6 parity: knob-push-to-talk
- Type: epic
- Description: Specify versioned knob routes, deterministic legacy migration, direct first-release voice, correlated gestures, and cancellation races.
- OpenSpec path: `openspec/changes/knob-push-to-talk/`
- Status: open; planning delivered, implementation pending.

### agent-runtime

- Title: L6 parity: agent-runtime
- Type: epic
- Description: Specify the later local agent/tool loop, catalog/session isolation, confirmations/budgets, inert cards, and an evidence gate for optional OpenClaw compatibility.
- OpenSpec path: `openspec/changes/agent-runtime/`
- Status: open; planning delivered, implementation pending.

### soundboard-playback

- Title: L6 parity: soundboard-playback
- Type: epic
- Description: Specify deferred local MP3 playlists, reviewed control migration, playback state/fades, and shared speech/audio ownership.
- OpenSpec path: `openspec/changes/soundboard-playback/`
- Status: open; planning delivered, implementation pending.

## Executable issue records

Each numbered entry below is one issue, with its title taken from the task ID and leading action. Its description is the complete task text below, including verification. The OpenSpec path is the matching tasks.md. Preserve dependencies from the tasks group order; later work stays gated.

### ai-provider-facade

Parent epic: L6 parity: ai-provider-facade. Type for every record below: issue.

OpenSpec path for every record below: `openspec/changes/ai-provider-facade/tasks.md`.

- 1.1 Record Ramiro's decisions on ownership, credential storage, endpoint policy, and SDK version; verify design/spec coherence with `openspec validate ai-provider-facade --strict` and document approved/deferred choices.
- 1.2 Define profile/capability/normalized-event Schemas and pure validation; verify round trips, credential-free summaries, unsupported modality rejection, and endpoint/redirect invariants with unit/property tests, and document the contract.
- 1.3 Add only approved essential Vercel SDK/provider dependencies with exact shared catalog pins; verify `pnpm install`, lockfile consistency, and dependency documentation.
- 1.4 Implement the mock-default Effect facade and compatible BYO-key adapter; verify the real ChatService consumer selects its configured adapter, streams, aborts, and never takes an account/proxy path, and document configuration.
- 1.5 Implement macOS credential references and catalog error translation; verify missing/revoked/broken storage, private original causes, scrubbed serialization, and no plaintext fallback through the real settings consumer, and document recovery.
- 2.1 Run a focused supported-integration spike for Codex device auth and a Vercel inference bridge; deliver a versioned protocol/usage decision covering grant namespace, cancellation, text-only operation, and SDK compatibility, or an explicit unavailable disposition for Ramiro to accept.
- 2.2 After approval of 2.1, implement device-login state/cancel/logout behind an injected helper; verify matching and stale completion, expiry/watchdog, helper absence, no token exposure, and auth generation revocation with a fake helper/clock, and document the settings flow.
- 2.3 After bridge verification, wire the Codex-backed Vercel provider to real chat; verify a user-authorized device login, text stream, cancellation, and no autonomous host tools, or keep inference unavailable and document the unresolved blocker without claiming parity.
- 3.1 Add Linux secure credential/helper adapters; verify isolated storage, missing Secret Service, explicit in-memory fallback, and the same provider/auth conformance suite, and document Linux setup.
- 3.2 Add optional provider presets/dedicated adapters only from verified capability evidence; verify each accepted sampling/modality request and every unsupported branch with fixtures, and document the twelve-engine import/disposition map.

### ai-chat-core

Parent epic: L6 parity: ai-chat-core. Type for every record below: issue.

OpenSpec path for every record below: `openspec/changes/ai-chat-core/tasks.md`.

- 1.1 Record decisions on v1 events, concurrency, deadlines, idle retention, repository format, and window staging; verify updated artifacts with `openspec validate ai-chat-core --strict` and document approved/deferred choices.
- 1.2 Implement Schema contracts and pure chunk/session reducers; verify identity isolation, contiguous seq, suggestion separation, exactly one terminal, duplicate/gap recovery, and cancellation at each state with unit/property tests, and document protocol v1.
- 1.3 Implement ChatService deadlines, profile snapshots, and bounded fan-out; verify real mock-provider dispatch, 60s/300s boundaries, one-turn busy, late-delta suppression, and slow-subscriber snapshot restoration using a fake clock and real client, and document subscription recovery.
- 2.1 Implement local versioned history and context budgeting; verify atomic finalization, restart interruption, deletion races, whole-exchange pruning, over-budget rejection, and usage provenance through the next real outbound request, and document retention/export behavior.
- 2.2 Wire Schema-first RPC/preload clients to management and panel chat; verify shared assembled content, inert HTML/file/command handling, user-gesture links, preserved scroll position, and closed-window cleanup, and document the no-hardware demo procedure.
- 2.3 Consume the shared General Translation infrastructure with bundled en/de chat strings and local fallback title/rename; verify offline locale switching, missing-key fallback, unchanged user text/provider selection, and stale title callbacks, and document localization ownership.
- 2.4 Exercise the full macOS mock-provider chat path and physical panel when available; capture stream/cancel/history/locale evidence, label synthetic versus hardware observations, and leave hardware acceptance open until it is actually run.
- 3.1 Exercise Linux windows, stream cleanup, local persistence, and locale behavior with the same contract suite; document platform gaps and retain failed acceptance items as open work.
- 3.2 Add the optional floating assistant and optional generated-title job after approval; verify display-bound restoration, closed-window chat/capture, rename/delete races, and title-failure isolation, and document the opt-in behavior.

### ai-chat-modes

Parent epic: L6 parity: ai-chat-modes. Type for every record below: issue.

OpenSpec path for every record below: `openspec/changes/ai-chat-modes/tasks.md`.

- 1.1 Record decisions on mode gates, registry policies, attachment limits, report format, and media deadlines; verify `openspec validate ai-chat-modes --strict` and document the phase map.
- 1.2 Implement mode/import Schemas and normal-only dispatch; verify all known numeric IDs, unknown IDs, immutable accepted modes, and disabled modes causing no capture/upload/provider/action calls through the real chat consumer, and document availability.
- 2.1 Implement keyConfig candidate validation and profile revision preview/apply; verify unsupported/duplicate keys, invalid actions, stale revision, and no write before confirmation through the profile consumer, and document candidate/apply behavior.
- 2.2 Register structured PC operations with host integration and agent-runtime; verify disabled shell, malformed proposals, exact argument confirmation, macOS permission denial, and no prose execution through the real executor adapter, and document supported actions.
- 2.3 Integrate HA entity/service phases with the HA-owning domain; verify removed entities, stale catalogs, invalid services/data, and no mutation before required approval against fixtures and a test instance, and document remaining test-instance gaps.
- 3.1 Implement explicit file/screenshot input and analysis stages/local Markdown save; verify picker cancellation, mime/size/modality rejection, stage order, privacy, and failed atomic saves through the desktop consumer, and document input/export limits.
- 3.2 Implement capability-checked picture/video jobs and local asset candidates; verify 300s timeout, fragmented responses, unsupported remote cancellation, no generation resubmission, and explicit profile/artwork apply, and document provider evidence per modality.
- 3.3 Implement emoji generation/edit as candidate revisions; verify text edits, invalid asset metadata, user application, and unchanged icons before apply through the artwork consumer, and document the workflow.
- 3.4 Add opt-in registry search and explicit selection actions with the host-integration lane; verify source provenance, excluded apps, disabled hooks, and no capture/search side effects in first-release mode, and document enablement and privacy behavior.
- 3.5 Run enabled-mode acceptance on Linux after macOS; verify explicit unsupported platform gates and action permissions with the real platform adapters, and document per-mode availability without claiming Windows support.

### voice-stt-tts

Parent epic: L6 parity: voice-stt-tts. Type for every record below: issue.

OpenSpec path for every record below: `openspec/changes/voice-stt-tts/tasks.md`.

- 1.1 Record decisions on deadlines, PCM framing, output ownership, TTS batching, and facade-owned transport drivers; verify `openspec validate voice-stt-tts --strict` and document approved choices and required exact dependency pins.
- 1.2 Establish current DashScope STT segment/finality semantics and HTTP TTS codec/rate/channel descriptors with sanitized fixtures and authorized live probes; verify the recovered default model/endpoint assumptions and document supported configuration before enabling either adapter.
- 1.3 Implement injected capture/utterance contracts, reducers, phase errors, and finalizers; verify every phase failure, late readiness, empty capture, exactly one terminal, five-second PCM bound, 60s automatic stop, and scrubbed diagnostics with fake clocks/recorders, and document lifecycle semantics.
- 2.1 Implement DashScope STT behind the facade; verify one run-task, readiness gating, 24kHz PCM frames, provisional replacement/final deduplication, one finish-task, malformed/close/timeout branches, and cancelled stale task IDs through the real transcript consumer, and document wire fixtures.
- 2.2 Implement HTTP/SSE TTS behind the facade using the descriptor proved in 1.2; verify split SSE/base64 records, truncated/error streams, format rejection, ordered audio, cancel, and 30s synthesis timeout through the player consumer, and document provider limitations.
- 2.3 Implement desktop mic permission/resampling/metering and exclusive AudioOutput playback; verify real preload correlation, 48kHz resampling, release-before-ready cleanup, normalized levels, player timeout/drain, and resource release with injected adapters, and document platform permissions.
- 2.4 Wire ordered answer-segment TTS to ChatService; verify punctuation/200-char/2s flushes, 4,000-character overflow preserving text, ignored followUp speech, cancellation, and text-only continuation through the actual chat consumer, and document synthesis controls.
- 2.5 Exercise an authorized macOS mic-to-STT-to-chat-to-TTS loop when credentials/audio are available; retain timing/format evidence without raw content or secrets, and mark physical audio/device acceptance unverified until exercised.
- 3.1 Implement/exercise Linux mic/output/permission adapters; verify the same lifecycle/audio-focus suite and actual Linux audio, and document unresolved PipeWire/PulseAudio/device cases.
- 3.2 Add a separate OpenAI Realtime/transcription adapter after current API verification; verify one session/update/ack, no event_id dependency, nonempty single commit, cancellation and no nutrition tool execution through real consumers, and document versioned protocol evidence.
- 3.3 Add optional Qwen realtime TTS, Azure, or XFY only after adapter-specific evidence; verify readiness, codec, usage, and playback-terminal conformance per route, and document unsupported capabilities.
- 3.4 Add opt-in live translation after product approval; verify explicit language pairs, original/translated provenance, target TTS, and GT locale independence through the voice UI, and document why disabled legacy-menu evidence is insufficient.

### knob-push-to-talk

Parent epic: L6 parity: knob-push-to-talk. Type for every record below: issue.

OpenSpec path for every record below: `openspec/changes/knob-push-to-talk/tasks.md`.

- 1.1 Record decisions on route migration, profile snapshots, re-press behavior, and device input generations; verify `openspec validate knob-push-to-talk --strict` and document the agreed logical gesture API without inventing HID thresholds.
- 1.2 Implement route Schemas and deterministic legacy migration/preview; verify idempotence, first-slash model parsing, explicit-field precedence, route field separation, ambiguous imports, and no credential persistence with property tests, and document migration outcomes.
- 2.1 Wire the real device logical-event adapter to KnobVoiceService and direct chat; verify pinned profile/provider/model, preparing/listening feedback, final-only single submission, duplicate reports, and distinct empty/cancelled/failed outcomes with synthetic device/provider Layers, and document the flow.
- 2.2 Implement capture ownership, release-before-ready latches, same-device re-press, and cleanup bounds; verify other-device busy, stale releases/STT callbacks, profile edits/removal, disconnect, 60s automatic stop, and no late request through the actual chat consumer, and document race handling.
- 2.3 Exercise the physical macOS knob hold/release/direct-answer/audio loop when hardware and credentials are available; record press/release generation and timing evidence, and leave hardware acceptance open until actual observations exist.
- 3.1 Exercise Linux direct-route capture/disconnect and speech output with the same fixture suite and physical device when available; document permission/gesture gaps explicitly.
- 3.2 After agent-runtime is enabled, connect dkclaw to its pinned agent/model session; verify agent switching, reset/cancel, unsupported model, and no silent direct fallback through the real runtime consumer, and document that the name does not promise OpenClaw protocol parity.
- 3.3 Add an explicit legacyAssistant-to-direct/agent migration UI after approval; verify review/save, preserved import backup, repeat import, and no legacy execution, and document the chosen replacement.

### agent-runtime

Parent epic: L6 parity: agent-runtime. Type for every record below: issue.

OpenSpec path for every record below: `openspec/changes/agent-runtime/tasks.md`.

- 1.1 Record the runtime replacement, budget, template, and approval-control decisions; verify `openspec validate agent-runtime --strict` and document accepted/deferred choices without claiming gateway compatibility.
- 1.2 Implement an explicit unavailable agent capability in first-release dispatch; verify chat/direct voice start with no installer/gateway/agent-network calls and agent routes fail visibly through real clients, and document feature availability.
- 2.1 Implement versioned local catalog/agent/session contracts and newly authored templates; verify revision/model/tool capability validation, locale fallback, offline CRUD/switch/reset isolation, and no recovered template text redistribution, and document template provenance.
- 2.2 Implement the Vercel-facade tool loop and ordered run events; verify fragmented/invalid tool arguments, repeated IDs, exact dispatch/result identity, per-agent context, 8-step/16-call/300s limits, and one terminal outcome with mock models and real consumers, and document run semantics.
- 2.3 Bind capability registry policy and desktop confirmation; verify allowlist/gates, never-policy refusal, changed arguments, stale/duplicate approvals, 120s approval expiry, and one simultaneous host mutation through actual domain executors, and document action permission defaults.
- 2.4 Implement cancellation, 30s tool deadlines, and restart ambiguity records; verify late non-cancellable results, no automatic write replay, private original causes, scrubbed serialized errors, and truthful UI outcomes through the runtime consumer, and document recovery.
- 2.5 Implement runtime enable/health/stop and typed tool cards; verify 10s start/check and 5s stop, owned-process cleanup, snapshot recovery, inert command previews, and desktop approval with panel status, and document lifecycle controls.
- 2.6 Integrate later dkclaw knob routing with the same AgentService; verify pinned agent/model, final-transcript submission, reset/cancel isolation, and response/TTS stream identity, and document the relationship to the legacy route name.
- 3.1 Implement/exercise Linux runtime and action adapters; verify identical tool policy/lifecycle suites and actual platform permissions, and document unsupported host capabilities.
- 3.2 Research an optional user-managed OpenClaw gateway only if selected; deliver versioned handshake/auth/capability/stream/cancel fixtures and clarify the printer gateway's role, then verify a real compatible backend or keep the adapter unavailable with evidence.
- 3.3 Add panel approval only after the device/panel lane validates deliberate touch identity; verify matching nonce/target, stale touches, and no action from markdown/card parsing, and document the additional approval control.

### soundboard-playback

Parent epic: L6 parity: soundboard-playback. Type for every record below: issue.

OpenSpec path for every record below: `openspec/changes/soundboard-playback/tasks.md`.

- 1.1 Record decisions on named controls, fades, codec scope, and output precedence; verify `openspec validate soundboard-playback --strict` and document soundboard as deferred without blocking direct speech.
- 1.2 Keep imported playAudio visibly unavailable in first release; verify no file scan/player start or interference with chat/voice through actual action dispatch, and document availability and migration status.
- 2.1 Implement versioned playlist/action Schemas and legacy importer; verify MP3 arrays/single-file order, invalid JSON/directories, missing files, unknown numeric controls, and idempotence with unit/property tests, and document review/save migration.
- 2.2 Implement playlist state and desktop player adapter; verify named controls, position preservation/reset, clamped navigation, duplicate/stale natural end, readiness timeout, and rescan without restart through the real profile consumer, and document playback semantics.
- 2.3 Implement bounded volume/fades and AudioOutput arbitration; verify interrupted ramps, zero gain, voice preemption, no auto-resume, and delayed soundboard stop leaving TTS intact with a fake player/clock and real output service, and document focus behavior.
- 2.4 Exercise actual macOS local MP3 decoding/output and device controls when available; record codec/control evidence, distinguish synthetic versus physical observations, and document unresolved audio-device behavior.
- 3.1 Exercise Linux playback/focus with real audio and the same conformance fixtures; document platform gaps and keep unsupported codecs/actions gated.

## Dependency edges and closure

- ai-chat-core depends on ai-provider-facade and the shared GT/panel contracts.
- voice-stt-tts depends on provider credential contracts. Its core capture/output contracts do not depend on chat; answer-segment speech integration follows ai-chat-core.
- knob-push-to-talk depends on speech, chat, provider profiles, and the device/profile logical gesture contract.
- ai-chat-modes depends on chat/provider contracts and each action-owning integration; PC action execution additionally depends on agent-runtime.
- agent-runtime depends on chat/provider contracts and capability registrations. The later knob-agent integration depends on its readiness.
- soundboard-playback depends on the speech AudioOutput contract, not on inference.
- Linux tasks follow each capability's macOS acceptance. First-release gates precede later enabled features.
- Do not close implementation issues based on this PR. Close only after source and actual verification evidence is attached; hardware-only checks remain open until run.
- No existing Beads record was changed or closed by this lane. The parent must reconcile these planned records with existing wayfinder children to avoid duplicates.

Total requested: 7 epics and 67 executable task issues.
