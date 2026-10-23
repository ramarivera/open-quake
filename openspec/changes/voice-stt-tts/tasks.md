# Tasks

No live capture/provider behavior is verified by this spec PR. The parent creates one Beads issue per checkbox and keeps hardware-only acceptance open.

## 1. First-release speech contracts and evidence

- [ ] 1.1 Record decisions on deadlines, PCM framing, output ownership, TTS batching, and facade-owned transport drivers; verify `openspec validate voice-stt-tts --strict` and document approved choices and required exact dependency pins.
- [ ] 1.2 Establish current DashScope STT segment/finality semantics and HTTP TTS codec/rate/channel descriptors with sanitized fixtures and authorized live probes; verify the recovered default model/endpoint assumptions and document supported configuration before enabling either adapter.
- [ ] 1.3 Implement injected capture/utterance contracts, reducers, phase errors, and finalizers; verify every phase failure, late readiness, empty capture, exactly one terminal, five-second PCM bound, 60s automatic stop, and scrubbed diagnostics with fake clocks/recorders, and document lifecycle semantics.

## 2. First-release DashScope and desktop loop, macOS

- [ ] 2.1 Implement DashScope STT behind the facade; verify one run-task, readiness gating, 24kHz PCM frames, provisional replacement/final deduplication, one finish-task, malformed/close/timeout branches, and cancelled stale task IDs through the real transcript consumer, and document wire fixtures.
- [ ] 2.2 Implement HTTP/SSE TTS behind the facade using the descriptor proved in 1.2; verify split SSE/base64 records, truncated/error streams, format rejection, ordered audio, cancel, and 30s synthesis timeout through the player consumer, and document provider limitations.
- [ ] 2.3 Implement desktop mic permission/resampling/metering and exclusive AudioOutput playback; verify real preload correlation, 48kHz resampling, release-before-ready cleanup, normalized levels, player timeout/drain, and resource release with injected adapters, and document platform permissions.
- [ ] 2.4 Wire ordered answer-segment TTS to ChatService; verify punctuation/200-char/2s flushes, 4,000-character overflow preserving text, ignored followUp speech, cancellation, and text-only continuation through the actual chat consumer, and document synthesis controls.
- [ ] 2.5 Exercise an authorized macOS mic-to-STT-to-chat-to-TTS loop when credentials/audio are available; retain timing/format evidence without raw content or secrets, and mark physical audio/device acceptance unverified until exercised.

## 3. Day 2 and later speech routes

- [ ] 3.1 Implement/exercise Linux mic/output/permission adapters; verify the same lifecycle/audio-focus suite and actual Linux audio, and document unresolved PipeWire/PulseAudio/device cases.
- [ ] 3.2 Add a separate OpenAI Realtime/transcription adapter after current API verification; verify one session/update/ack, no event_id dependency, nonempty single commit, cancellation and no nutrition tool execution through real consumers, and document versioned protocol evidence.
- [ ] 3.3 Add optional Qwen realtime TTS, Azure, or XFY only after adapter-specific evidence; verify readiness, codec, usage, and playback-terminal conformance per route, and document unsupported capabilities.
- [ ] 3.4 Add opt-in live translation after product approval; verify explicit language pairs, original/translated provenance, target TTS, and GT locale independence through the voice UI, and document why disabled legacy-menu evidence is insufficient.
