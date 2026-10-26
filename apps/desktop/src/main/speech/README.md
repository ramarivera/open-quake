# Desktop speech

`createDesktopSpeech` composes the production bindings with the existing
`AiSpeechService`. It requires `VoiceSurface` and a lifetime `Scope`. Creation
opens no window, microphone, speaker or network connection. STT and TTS remain
disabled until the user saves independent profiles in Settings > Speech.

Parent composition:

```ts
const speech = yield* createDesktopSpeech({
  storage: fileStore(userData, "speech-v1.json", emptySpeechSettings),
  credentials: systemCredentialVault(join(userData, "credentials")),
  diagnostics,
  sendTranscript: request => httpVoice.sendTranscript(request),
  sendText: request => fallback.sendText(request),
  // Optional direct HTTP turn cancel. Never route back through the decorator.
  cancelText: (serial, keyCode) => httpVoice.cancelText(serial, keyCode),
});
```

The parent owns the HTTP runtime composition and adds a direct `cancelText`
handle if needed. The existing local fallback is the original mock/unavailable
runtime before HTTP decoration. Never send the speech fallback back through
`httpVoice.runtime.sendText` or `httpVoice.runtime.cancelFlow`: both delegate
to their fallback and would recurse when the external selection is absent.
Use late-bound callbacks when
constructing the HTTP voice adapter around `speech.runtime`, to preserve its
capture implementation without introducing a construction cycle. Pass a
`Layer.scoped(GridVoiceRuntime, ...)` into the voice registration's existing
`runtime` decorator. Do not create another speech service for typed answers.

The voice registration accepts `speech.onEvent` and `speech.readAloud` callbacks.
Run `speech.observe(event)` in the owning runtime for `onEvent`. It serializes
`TurnStarted`, answer/end `Chunk`, and `Reset` events from the real HTTP adapter.
It rejects stale turn IDs and nonincreasing chunk sequences. It never speaks
`followUp` chunks. Map `readAloud(text)` outcomes to `VoiceSurfaceReply`, returning
`ok` only for `completed`, otherwise a rejected speech error/cancellation code.
The registration keeps at most 16 current answers, with at most 4,000 characters
each, to resolve the existing key-only ReadAloud request in main. An oversized
answer rejects ReadAloud with `VOICE.TTS.QUEUE_FULL` instead of silently reading
a truncated answer.

Register settings through `registerSpeechSettings({ controller: speech.settings,
management, renderer, run })`. The supplied `run` is the parent's instrumented
interpreter. Dispose the returned unregister function during shutdown. The
existing voice preload loads the speech settings bridge, and SettingsPage uses
it. No secret or credential reference appears in settings replies. New keys go
through the existing safeStorage vault, with revocation cancelling live speech.
Profile destination changes require a new key. Failed deletion of an obsolete
key keeps its reference in a bounded persisted cleanup list and retries on the
next settings request. Settings changes call
`speech.reset()` before replacing profiles, physically cancelling capture and
output. The user can independently disable either route.

`desktopSpeechPorts()` supplies HTTP fetch, an authenticated TLS WebSocket
implementation and exclusive output. The driver validates the WebSocket
upgrade, masks client frames, joins fragmented text, responds to ping, bounds
inbound messages/queues and outbound buffered bytes, and destroys the socket on
abort. It follows no redirect that could forward authorization.

Audio runs in an invisible, unfocusable, sandboxed file-origin BrowserWindow
with Node disabled. Its fixed HTML contains no user data. A dedicated in-memory
session grants audio permission only to its worker; navigation/new windows are
blocked. macOS native microphone permission is requested before connecting STT.
The actual microphone starts only when `AiSpeechService` consumes frames after
matching provider readiness. Permission, session configuration and recorder
startup have bounded waits. Release during preparation interrupts setup;
late worker creation/grants are destroyed. Physical tracks stop on release,
while the final aligned PCM tail drains before STT finish-task.

Capture uses Chromium's supported ScriptProcessorNode with 1,024 input samples
per callback and the actual AudioContext sample rate. The pure area resampler
handles 24–192kHz input, preserves phase across blocks, mixes channels to mono,
clips nonfinite/out-of-range samples and emits 480 signed 16-bit little-endian
samples per normal frame. The worker retains at most 249 frames and transfers
one at a time, keeping at most five seconds in the capture pipeline. A shorter
aligned final frame is allowed. Frames carry capture ID, sequence and normalized
RMS internally; only PCM reaches the provider. No raw audio is written to disk.

Output validates PCM/WAV again, owns its audio context, strips verified WAV
container chunks, and resolves only on natural AudioBufferSourceNode end.
Cancellation destroys the worker and cannot become natural completion. The
service enforces readiness/synthesis/playback deadlines and output arbitration.
New capture cancels assistant speech before microphone startup. Answer speech
flushes at punctuation, 200 characters or two seconds and bounds all unsaid
text, including active synthesis, to 4,000 characters. Overflow cancels speech
while readable chat continues.

Diagnostics are optional and structurally compatible with
`Pick<DesktopDiagnostics, "layer" | "instrument">`. Parent interpreters must
provide the shared diagnostics layer. The owned voice interpreter merges it.
Capture, recognition and playback operations are instrumented before outcome
catches. The playback boundary temporarily lifts text-only failures into the
typed error channel for diagnostics, then restores readable-text continuation. New errors come from `DesktopSpeechErrors` with private original causes
and scrubbed JSON. No PCM, text, provider bodies or keys are logged here.

Tests drive the serialized audio worker with synthetic tracks/contexts, a real
loopback RFC6455 server, real `AiSpeechService`, the production voice runtime and
ReadAloud IPC consumer, explicit settings and the existing credential vault.
They do not record, play audio, contact a provider, launch Electron, take focus,
or touch a QUAKE. Physical audio routing, OS permission prompts, live provider
segment finality/codec acceptance and physical audio remain unverified. DashScope
uses explicit workspace/region routes; OpenAI Speech API is the existing
`gpt-4o-mini-tts` compatibility profile, disabled by the service on 2027-01-06.
No custom inference URL, implicit provider fallback or Realtime substitution is
supported by these first-release bindings.

The production root uses `createSpeechVoiceBinding` to deliver finalized
transcripts into the selected HTTP runtime or direct ChatService and to feed
answer events into ordered speech. With no external selection, the direct
adapter is the fallback. The binding never routes cancellation back into itself.
`composition.test.ts` drives actual recognition, both conversation services,
answer events and natural output drain with synthetic adapters, including
permission failure and fallback.

Malformed or unreadable saved profiles leave speech disabled. Settings reports
the configuration error and offers an explicit replacement flow. Nothing writes
over the saved file until a valid Save succeeds. Failed replacement preserves
both the file and the reported error; successful replacement requires fresh keys
before speech can be enabled.

For native Chromium acceptance without recording or audible output, build
`src/main/test/speech-audio-smoke.config.ts`, then run its
`out/speech-smoke/speech-audio-smoke.js` entry with Electron and
`OPEN_QUAKE_SYNTHETIC_AUDIO_TEST=1` plus an absolute external
`OPEN_QUAKE_TEST_SCRATCH`. Unset `ELECTRON_RUN_AS_NODE`. The entry forces
Chromium's fake microphone and muted output, keeps all workers invisible,
checks real 960-byte PCM frames and nonzero signal, waits for natural playback
drain, and verifies worker cleanup. It has a 30-second deadline and must emit
`SPEECH_AUDIO_SMOKE_OK`; process exit alone is insufficient. This establishes
the native worker binding only. It doesn't establish physical audio routing,
provider compatibility, microphone permission, or audibility.


`createDesktopSpeech` now creates exactly one `AudioOutput` ownership service and
returns it as `audioOutput` for app-root soundboard composition. Its lifetime is
the same scoped voice runtime; shutdown closes the owner after the voice
controller finalizes. `desktopSpeechPorts(audioOutput)` and
`createDesktopAudioOutput(audioOutput, optionalWorkerFactory)` require that owner
explicitly, so separate adapters don't silently create independent arbiters.
Synthetic `options.ports` overrides remain responsible for their own output
semantics.

The production speech port supplies a scoped `capture` reservation. Recognition
holds it from before provider/socket and microphone acquisition through every
success, failure and interruption finalizer. Legacy injected ports without that
optional reservation retain their existing `suspendForCapture` behavior. A new
speech or capture reservation invalidates and awaits the previous output group's
immediate cleanup. The cleanup has a two-second deadline; failure blocks later
acquisition for that owner's lifetime instead of allowing overlapping output.
Soundboard groups must register only immediate resource shutdown, without fades
or recursive lease release. A group's later release only touches its own token.
No playback starts automatically after capture completes.

The native synthetic speech smoke now drives the production output adapter and
shared owner, in addition to its fake microphone. It checks repeated readiness
creates one worker, speech/capture preemption, busy rejection, stale soundboard
stop isolation, muted natural drain, and full native worker cleanup. These are
ownership and native worker proofs. The soundboard conductor, MP3 decoding,
player UI and physical/hearing acceptance remain separate unfinished tasks.

Direct answers use the same speech controller through createDirectChatVoice.
The direct-composition tests run the actual ChatService and installed Vercel
adapter against fake SSE, then assert ordered TTS requests, serialized output
drain, retained chat history on Stop, overflow and synthesis failure, safe
failure diagnostics, and shutdown during pending inference/playback. The capture
composition test also drives a finalized synthetic transcript through direct
inference to output when the external runtime is deselected. The scoped direct
consumer cancels its host turn before dropping ownership; the SDK adapter aborts
IO before awaiting async-generator return. Live STT/TTS and physical audio remain
unverified. Native Linux worker evidence is recorded in the OpenSpec tasks file;
it proves worker execution with synthetic input and a private output sink.
