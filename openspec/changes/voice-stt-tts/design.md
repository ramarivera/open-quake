# Design

## Context

STT and TTS are independent capabilities. Text chat and STT remain usable when synthesis or playback fails. The first release uses explicit BYO-key DashScope STT and HTTP/SSE TTS; it does not require a DecoKee account or geolocation. A remote speech provider receives audio/text by user choice. Local-only describes app data/account ownership, not an offline inference promise.

Proposed (pending Ramiro): `packages/edge/src/voice/` owns Schema contracts, lifecycle invariants, VoiceService, adapter interfaces, and a small AudioOutput service. Desktop renderer/main adapters own browser mic acquisition, AudioContext resampling/playback, permissions, and secure credentials. `packages/client/` owns typed subscriptions. Recorder and WebSocket/HTTP constructors, UUID generator, clock, and player are injected. Services use Effect.fn spans, declared dependencies/Layers, and catalog errors. Provider-specific wire clients stay inside facade adapters. For routes unsupported by the selected Vercel AI SDK version, a narrowly scoped speech transport driver may sit behind the same Effect facade; this exception needs an implementation decision and does not permit raw SDK use in consumers.

## Goals / Non-goals

Goal: Separate capture, transcription, synthesis, and actual playback outcomes.

Non-goal: Do not port the nutrition workflow or make STT depend on chat/agent confirmations.

## Decisions

Proposed (pending Ramiro): the draft specifications encode the recommendations below. Supplied product direction is fixed; other design choices await acceptance before implementation. Evidence labels describe recovered observations, not approval of the proposed replacements.

### Capture and transcription lifecycle

Proposed (pending Ramiro): use idle, requesting_permission, requesting_session, connecting, configuring, starting_recorder, listening, stopping, processing, completed, empty, failed, and cancelled. Skip inapplicable transport phases explicitly. Every phase transition has sessionId/captureId and monotonic time. Only completed contains one nonempty final transcript; empty contains no submitted transcript. UI metering is normalized to 0..1 and reports no raw audio in diagnostics.

The research's thinking/confirming/logging phases belong to downstream chat/tool flows, not STT. Preserve its one-session rule, typed failure-per-phase, injected dependencies, and no partial/duplicate terminal logs. A release before ready sets a cancellation latch checked after every awaited step. A late permission grant, session ack, or recorder start is immediately cleaned up; it must not record after release.

Proposed (pending Ramiro): permission wait is bounded at 30s; session acquisition, connect, configuration acknowledgement, and recorder start each at 10s; stop-to-final transcript at 15s. These wait timeouts map to `VOICE.CAPTURE.PHASE_TIMEOUT` with the phase field. Listening automatically stops at 60s and finalizes nonempty audio under the same policy as user release. Explicit cancellation releases mic tracks, context, player lease, sockets, and subscriptions. No empty provider commit and no empty chat submission. A recognition with audio but no final text ends as empty, distinct from permission denial and transport failure.

### PCM and backpressure

Recovered capture uses mono 24,000Hz, signed 16-bit PCM. Proposed (pending Ramiro): use little-endian headerless PCM at that rate for first-release STT, with 20ms frames of 960 bytes and an optional shorter final frame aligned to 16-bit samples. Resample in the recorder adapter; never relabel 48kHz input as 24kHz. Attach captureId, seq, sampleRate, channels, and encoding to internal frames; the provider receives only its specified binary payload. Queue at most five seconds of PCM. Overflow terminates with `VOICE.CAPTURE.BUFFER_OVERFLOW`; no silent loss or unlimited buffering.

Do not send frames before provider-ready. In the first-release policy start the mic only after STT readiness and UI indication, so startup audio is intentionally not captured. Once listening, release flushes final samples and sends finish once. Frames/acks from a previous capture cannot finish a new capture.

### DashScope STT wire contract

Endpoint is `wss://dashscope.aliyuncs.com/api-ws/v1/inference`, default model `paraformer-realtime-v2` per inventory. `QWenSTTClient.js` imports a model constant whose definition is not present in the recovered files inspected, so model availability still needs a live check.

Authenticate in the host adapter. On open send one run-task with task ID, streaming duplex, task_group audio, task asr, function recognition, format pcm, and configured sample_rate. Wait for matching task-started before sending binary audio. Parse result-generated into provisional sentence updates and finalized segments, then send one finish-task with the same task ID after the final frame. Complete on matching task-finished, fail on task-failed, malformed frame, premature close, or deadline.

Proposed (pending Ramiro): provisional sentence updates replace the corresponding provisional text; finalized segments append once based on provider segment identity or a verified final-marker rule. The recovered client appends when usage exists, which is insufficient evidence for exactly-once final-segment semantics. The adapter spike must establish segment identity/finality against fixtures and current wire behavior before release. Never append every interim sentence or derive finality from token/duration usage alone.

### DashScope TTS wire contract

The active recovered QWenAdapter sets useRealtime false. It uses `https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`, model qwen-tts, a configured voice, and `X-DashScope-SSE: enable`. The client also implements a separate WebSocket route `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen-tts-realtime`; that is a later option, not the source-backed active default.

First-release HTTP/SSE sends explicit text/voice/model and parses complete SSE records across arbitrary byte boundaries. Base64 audio appears under output.audio.data. Decode valid complete records in order, handle provider errors, and distinguish normal stream EOF from a truncated record. Proposed (pending Ramiro): negotiate an audio descriptor from the verified adapter contract before playback. Do not assume the HTTP audio has the WebSocket route's 24kHz PCM format; verify codec/rate/channels in the adapter spike. Unknown format fails with `VOICE.TTS.FORMAT_UNSUPPORTED`.

Later realtime TTS sends one session.update and waits for session.updated, then append/commit text. Decode response.audio.delta and distinguish response.done from actual playback end. Response/item IDs isolate utterances. Finish/clear/cancel do not become a natural-end event. No late cancelled audio reaches playback.

### Playback and chat handoff

TTS states are idle, synthesizing, playing, completed, failed, cancelled. Synthesis completion and output drain are separate facts. Each utterance has one terminal outcome; completed occurs only when the player drains naturally. Player-ready, load failure, natural end, and stop are typed events carrying utteranceId. A missing player times out after 10s. Synthesis has a 30s absolute deadline per utterance; playback is bounded by declared duration plus 10s, with a 120s hard cap. A failure preserves the chat answer and permits text-only continuation.

Proposed (pending Ramiro): synthesize ordered sentence segments, flushing at a punctuation boundary, 200 characters, or two seconds of pending text. Serialize utterances per turn and bound queued pending text to 4,000 characters. On overflow cancel the speech remainder, keep text streaming, and report `VOICE.TTS.QUEUE_FULL`. This replaces DK-Suite's 20/50-character and three-second batching heuristics. Cancelled/failed chat turns clear their unsaid text. TTS never speaks followUp suggestions unless the user explicitly chooses one.

AudioOutput grants one output lease. Voice capture suspends output before mic start to prevent self-capture. A re-press cancels current assistant speech. Soundboard later consumes the same lease; automatic playback resume after capture is disabled in the proposed policy.

### Later transports and translation

OpenAI Realtime is a separate later adapter. Adopt the supplied research's one session, exactly one session.update, and first session.updated acknowledgement without relying on echoed event_id. Only then append PCM. Commit once on nonempty stop; suppress empty commits. Session audio config must be verified for the selected current API version. Generic STT completion does not execute the research's nutrition-specific tool or enter confirming/logging. Any tool loop goes through `agent-runtime`.

OpenAI transcription, Azure, and XFY are later adapter candidates and remain unavailable until their own conformance fixtures pass. Provider/speech language is explicit; do not infer it from geography or UI locale. Live translation is a later opt-in mode requiring explicit source/target language, transcript/translation pairing, and optional target-language TTS. GT supplies UI chrome only; no GT cloud call performs speech translation. Disabled-menu evidence does not establish DK-Suite live-translate behavior.

### Evidence and deliberate replacements

Read-only root `R` is `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion`; `RS` is `R/artifacts/recovered_sources`.

- S: `RS/webpack:__dk-suite_src_main_ai_Connector_QWenSTTClient.js`, run-task/task-started/result-generated/finish-task/task-finished and late-stop guard.
- S: `RS/webpack:__dk-suite_src_main_ai_Connector_QwenTTSClient.js`, HTTP/SSE and WebSocket synthesis; `webpack:__dk-suite_src_main_ai_Connector_QWenAdapter.js:64-72` and `_initTTSConvertEngine`, active HTTP route and voice selection.
- S: `RS/webpack:__dk-suite_src_views_AIAssistant_AIAudioHandler.vue:64-68`, mono 24kHz/16-bit capture, stop-before-ready latch, empty-capture events; `webpack:__dk-suite_src_main_ai_recorder.js`, recorder lifecycle.
- S/N: `RS/webpack:__dk-suite_src_main_ai_Connector_OpenAIRealtimeClient.js`, legacy realtime transport. Its behavior is not a current API guarantee.
- N: `R/artifacts/ipc_channels.txt`, recorder/player events only; exact payloads must come from recovered callers.
- P/research: `/Users/ramarivera/dev/open-quake/.context/research/realtime-voice-behavioral-spec.md`, ONYXIO source map and behavioral lessons, not directly inspected ONYXIO code or device evidence.
- Product/research: the same research directory's `general-translation-integration.md` and `dk-suite-feature-inventory.md`, section 5 and release cuts.

Replace region-selected engines, raw audio/text logging, nutrition-specific phases/tools, append-on-usage transcript logic, implicit Qwen sidecars, and suppressed synthesis errors. Keep transcripts/local history under user control; do not retain raw PCM after terminal cleanup by default.

## Open decisions and verification

- Proposed (pending Ramiro): approve the phase deadlines, 20ms PCM framing, five-second queue, TTS batching, and exclusive audio policy.
- Proposed (pending Ramiro): approve active HTTP/SSE TTS first; choose model/voice/region from tested configuration rather than recovered marketing defaults.
- Proposed (pending Ramiro): approve facade-owned direct speech transport drivers if the selected AI SDK lacks the recovered protocol.

Tests use fake clocks, injected recorder/player/transports, fragmented SSE fixtures, and a real desktop/preload consumer. Live checks must establish final STT segment semantics and HTTP TTS audio format. Actual microphone permissions, live providers, device timing, audio routing, and Linux are unverified.

## Migration and rollback

Add explicit versioned STT/TTS profiles and enable mock capture before live DashScope. Do not migrate region defaults into active provider choices automatically. Enable STT first, then verified HTTP TTS, then knob integration. Rollback disables the failing speech adapter, clears active audio resources, and retains text chat/transcript history without retaining raw PCM.

## Risks and alternatives

- Opening the mic after provider readiness avoids buffered private audio but misses speech during preparation. Show preparing/listening distinctly and validate the trade-off on hardware.
- HTTP TTS format and final STT segment rules remain release blockers. A disabled adapter is preferable to labeling unknown audio PCM or duplicating interim transcript text.
- The research describes a nutrition workflow and a different provider API. Adopt lifecycle invariants while verifying each adapter's current wire protocol independently.
