# Tasks

Production desktop bindings and synthetic acceptance are implemented. Live provider and physical capture/playback acceptance remain open. Each checkbox maps to a Beads task; a synthetic pass doesn't close a live requirement.

## 1. First-release speech contracts and evidence

- [x] 1.1 Record decisions on deadlines, PCM framing, output ownership, TTS batching, and facade-owned transport drivers; verify `openspec validate voice-stt-tts --strict` and document approved choices and required exact dependency pins. Decisions are in design.md and main/speech/README.md; production bindings use existing dependencies without additions.
- [ ] 1.2 Establish current DashScope STT segment/finality semantics and HTTP TTS codec/rate/channel descriptors with sanitized fixtures and authorized live probes; verify the documented workspace-host/model/voice pairs (`AI-094/101/108`, official docs accessed 2026-10-24) and segment finality, and document supported configuration before enabling either adapter.
- [ ] 1.3 Implement injected capture/utterance contracts, reducers, phase errors, and finalizers; verify every phase failure, late readiness, empty capture, exactly one terminal, five-second PCM bound, 60s automatic stop, and scrubbed diagnostics with fake clocks/recorders, and document lifecycle semantics.

## 2. First-release speech adapters and desktop loop, macOS

- [ ] 2.1 Implement DashScope STT behind the facade; verify one run-task, readiness gating, 24kHz PCM frames, provisional replacement/final deduplication, one finish-task, malformed/close/timeout branches, and cancelled stale task IDs through the real transcript consumer, and document wire fixtures.
- [ ] 2.2 Implement HTTP/SSE TTS behind the facade using the descriptor proved in 1.2; verify split SSE/base64 records, truncated/error streams, format rejection, ordered audio, cancel, and 30s synthesis timeout through the player consumer, and document provider limitations.
- [ ] 2.3 Implement desktop mic permission/resampling/metering and exclusive AudioOutput playback; verify real preload correlation, 48kHz resampling, release-before-ready cleanup, normalized levels, player timeout/drain, and resource release with injected adapters, and document platform permissions.
- [x] 2.4 Wire ordered answer-segment TTS to ChatService; verify punctuation/200-char/2s flushes, 4,000-character overflow preserving text, ignored followUp speech, cancellation, and text-only continuation through the actual chat consumer, and document synthesis controls.
- [ ] 2.5 Exercise an authorized macOS mic-to-STT-to-chat-to-TTS loop when credentials/audio are available; retain timing/format evidence without raw content or secrets, and mark physical audio/device acceptance unverified until exercised.

- [ ] 2.6 Add the independent OpenAI TTS adapter (`AI-105`) with explicit model/voice/instructions/WAV descriptor, cancellation and output ownership; verify it through the actual player consumer, including text-only failure and late cancelled audio. Document the 2027-01-06 Speech API model shutdown, gate unavailable profiles, and verify any replacement transport separately before enabling it. Bead: `open-quake-c5w.13`.

## 3. Day 2 and later speech routes

- [ ] 3.1 Implement/exercise Linux mic/output/permission adapters; verify the same lifecycle/audio-focus suite and actual Linux audio, and document unresolved PipeWire/PulseAudio/device cases.
- [ ] 3.2 Add a separate OpenAI Realtime/transcription adapter after current API verification; verify one session/update/ack, no event_id dependency, nonempty single commit, cancellation and no nutrition tool execution through real consumers, and document versioned protocol evidence.
- [ ] 3.3 Add optional Qwen realtime TTS, Azure, or XFY only after adapter-specific evidence; verify readiness, codec, usage, and playback-terminal conformance per route, and document unsupported capabilities.
- [ ] 3.4 Add the shipped opt-in Meet AI live translation route (`AI-136/292/327`); verify explicit language pairs, original/translated provenance, target TTS, and GT locale independence through the voice UI and bounded display history (`AI-338`), and document the shipped-profile evidence despite commented library entries.

## 4. Recorder lifetime hardening

- [x] 4.1 Await acquired recorder-worker teardown on startup failure and interruption, close late acquisitions without recording, and share failed-Stop/session-close teardown. Tracked in `open-quake-c5w.6.1`; broader task 2.3 remains open.

The actual driver passes five lifetime regressions. Four fail against the
previous implementation, demonstrating two failure paths returning before
cleanup, interruption dropping acquired ownership, and duplicate close calls.
Permission-denied and recorder errors retain their original private cause.
The desktop suite passes 1,616 tests with one existing native skip. Typecheck,
scoped Biome, production build, both bundle smoke modes and strict validation
pass. The hidden native smoke exercises the production capture driver with
Chromium synthetic input, and failed startup with delayed real worker cleanup,
then the existing muted output/ownership acceptance. It reports success with
zero remaining workers or worker directories. This proves synthetic native
resource ownership, not physical microphone, OS grants or audible playback.

An initial native run blocked in an Electron uncaught-error dialog and its
owned process was terminated. Its cause wasn't established. The test entry now
exits unsuccessfully on uncaught errors instead of opening that dialog. The
subsequent native run passed. Reviewed delivery remains tracked in Beads.

PR69 review hardening adds two cleanup-rejection cases and strengthens late
acquisition cancellation. All three fail on the previous revision. Cancellation
now awaits both the pending factory and its worker teardown; a rejecting factory
also settles before cancellation returns. Startup cleanup rejection emits a
scrubbed catalog warning without masking the original typed recorder error.
The eight lifetime cases and 80 focused speech/chat tests pass. The updated
native smoke joins delayed acquisition and actual worker cleanup without invoking
capture, and finishes with no workers or worker directories left. It continues
to use synthetic input and muted output only. The combined desktop suite passes
1,626 tests with one existing native skip; typecheck, production build, both
bundle smoke modes, scoped Biome and strict validation pass.


Cluster 14 implementation evidence for 2.6: packages/edge/src/ai/speech/
speech-service.test.ts drives AiProviderService.createSpeech to fake HTTP and
the actual owned player consumer, including natural drain, text-only errors,
cancellation, late audio, deadlines and retirement. See ai-providers-parity/
verification.md. No live/hardware acceptance is claimed; 1.2, 2.3–2.5 stay open.
Task 2.6 remains unchecked to match the shared open acceptance bead
`open-quake-c5w.13`. Production audio bindings now exist. The native
speech-audio-smoke verifies hidden sandboxed Chromium capture with synthetic
input and muted natural-drain output; it doesn't verify a live provider or
physical microphone/speaker. The parent composition test drives one finalized
transcript through the selected external ConversationService into ordered
answer speech, including original-fallback exclusion and retained safe failures.
Direct ChatService answer consumption in 2.4 is verified by the actual
production binding in speech/direct-composition.test.ts and composition.test.ts,
using synthetic capture, fake provider fetch and controlled output drain.
Live provider and physical audio acceptance in 2.5 remain open.


## Linux native-worker evidence, 2026-10-26

Task 3.1 remains open. On Linux x64, Electron 43.4.1 and PipeWire 1.6.10, the
actual capture driver consumed synthetic Chromium input and produced 28 ordered
960-byte PCM frames with nonzero RMS. The production hidden sandboxed worker
and output owner passed repeated readiness, natural drain, busy rejection,
capture preemption, stale soundboard Stop isolation, aborted acquisition and
complete cleanup. Generated PCM reached a private PipeWire sink with measured
peak RMS 0.173887. No raw PCM was persisted. Default input/output and host volume
were unchanged; all owned windows, workers, recorders and virtual sinks closed.

This proves Linux worker execution and native output routing, with synthetic
input. Physical microphone capture, portal denial and unplugged-device behavior
remain unverified, as do live STT/TTS credentials and physical hearing. The
source and result artifacts remain external under `open-quake-finish/linux-audio/`
in project scratch. The existing macOS synthetic smoke was reused with actual
production driver capture and a nonzero generated output tone.

## Direct speech consumer acceptance, 2026-10-26

Task 2.4 drives finalized capture through the real direct ChatService, installed
Vercel compatible adapter, VoiceSurface events, AiSpeechService and output
consumer. Tests cover punctuation and 200-character segmentation, timed pending
text, sequential natural drain after inference completion, cancellation,
4,000-character overflow with readable chat intact, and synthesis failure with
private text and credentials absent from diagnostics. Existing ordered/runtime
TestClock tests verify the exact two-second boundary and ignored followUp chunks.

Closing the voice scope previously removed its consumer without cancelling the
host turn. It now cancels upstream before clearing ownership. Separately,
interrupted SDK iteration previously waited for async-generator return before
aborting pending IO. The adapter now aborts before return. Both fetch and body
interruption regressions fail on the previous adapter; voice-only shutdown
failed before its ownership fix. Tests assert cancelled durable history and
stopped output. No live provider, physical microphone, audible output or device
acceptance is claimed.

## speech-capture burn-down lane

- [x] Implement the shared identity, recorder format/control, runtime timing/error and knob duration requirements above with production consumer fixtures. Evidence: shared microphone/settings/worker tests, supported PCM input-rate and stereo fixtures, recorder lifetime/native rejection boundary tests, runtime TestClock level/deadline/terminal metrics fixtures, and mounted EN/DE picker checks. Beads open-quake-c5w.14 and open-quake-c5w.15 stay open for lead merge.
- [ ] Complete physical microphone, OS permission/unplug/reconnect, provider and device acceptance under the lead's authorization. No physical recording or playback was performed by the speech-capture lane.

## PR85 review corrections

- [x] Resolve saved microphones against capture-local identities, excluding foreign document group IDs and retaining exact or unambiguous label selection. Regression drives the production Electron worker bridge with distinct settings/worker salts. Tracked in open-quake-c5w.17; physical acceptance remains on the checklist above.

- [x] Stop recording duration at capture-stream release, including automatic 60-second capture, delayed final results and provider timeout. Two TestClock regressions drive the production STT consumer; startup timing still includes final processing. Tracked in open-quake-c5w.17.

- [x] Propagate the effective microphone-only retry configuration into meeting history without changing the configured system-audio preference. Port and MeetingService persistence regressions fail before the fix. Tracked in open-quake-c5w.17; meeting-minutes owns the source-fallback scenario.

- [x] Bound opt-in archives to the first 60 seconds without failing Stop/export, and close the audio context in a finalizer when graph teardown rejects. Serialized-worker regressions cover partial-frame/full-frame overflow and failing disconnect; all fail before the fix. Tracked in open-quake-c5w.17.

- [x] Count validated final-tail PCM after release for the current owner before suppressing level/activity events. A short-press production STT/runtime regression fails before the fix and verifies unclear rather than noAudio, first-frame metrics, transmitted PCM and no post-release recording activity. Tracked in open-quake-c5w.17.
