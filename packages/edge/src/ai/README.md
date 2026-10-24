# AI provider foundation

Import `@open-quake/edge/ai/contracts` in browser code. That entry imports
only `effect/Schema`. Import `@open-quake/edge/ai` only in host/service code.
SDK types and credential values are absent from the public Schemas.

`AiProviderService.Default` declares `AiRepository.Default` and builds a registry
of available adapters keyed by profile adapter kind. The registry always includes
`mock`; providing `AiCompatibleAdapter` adds `openai-compatible`. Each request
dispatches through its selected profile, so mock and compatible profiles can run
in one service. Unregistered adapters fail with `AI.PROVIDER.UNAVAILABLE` before
credential resolution. `AI_PROVIDER_ADAPTER` no longer restricts explicit profile
selection. Use the repository's `MOCK_PROFILE.id` for the deterministic mock.
Each event takes 10ms on the Effect Clock. The output is a generation and usage is estimated.
The repository is volatile metadata storage, not disk persistence.

`generate` validates the profile selection, sampling, and capabilities before
credential resolution or adapter dispatch. A profile snapshot stays pinned for
the lifetime of the returned generation. Each generation has one consumable
stream and an idempotent `cancel` operation. Interrupting the stream or revoking
its credential aborts its signal. Failures use the typed stream error channel;
successful streams emit one `completed` and suppress subsequent output.
ChatService remains responsible for emitting its one public `end`, including
when a generation is cancelled.

Profiles require explicit model and endpoint configuration. Remote endpoints
require HTTPS; HTTP requires an explicit loopback policy. Endpoint credentials,
queries, and fragments are rejected. `credentialRedirectAllowed` is a pure
same-origin check; the adapter port requires redirects disabled entirely.
Unsupported and unverified capabilities fail with the capability identifier.
Mock capabilities are fixed to text only. Saving different mock capability
declarations fails validation; request validation also rejects non-text mock
requests even if a caller passes a profile claiming support.
Sampling values must fit the profile's declared ranges; absent ranges mean the
option is unsupported. No implicit provider switch, account, proxy, geo lookup,
or retry exists.

For compatible profiles, explicitly provide `AiCompatibleAdapter` and
`AiCredentials` at the root, then select a compatible profile by ID.
There is no installed SDK adapter. The port requires an AbortSignal, redacted
credential, disabled redirects, and `maxRetries: 0`. Native SDK normalization and
SDK-specific status extraction belong inside that adapter. Use the catalog
translation at the failing boundary and preserve the original cause privately.
Diagnostics contain bounded, allowlisted identities, never provider bodies.
Codex profiles remain unavailable; login and a verified inference bridge are
separate work.

## Needs approval

Proposed exact dependencies for task 1.3, queried from npm on 2026-10-23:

- `ai@7.0.150`, requiring Node >=22.
- `@ai-sdk/openai-compatible@3.0.77`, the explicit compatible-provider adapter.

Neither package is installed. Approval must precede adding catalog pins and
implementing the SDK adapter. Existing catalog versions of vitest 4.1.11,
@effect/vitest 0.30.0, and fast-check 4.9.0 are reused for this package's tests.

## Verification boundaries

The tests consume the real facade stream, injected adapter port, and host
credential service. They do not prove a Vercel SDK integration, ChatService,
settings/preload UI, local disk persistence, a native Keychain binding, a live
provider, Codex authentication, Linux, or physical hardware.


## Cluster 14 provider and speech routes

`AiProviderService.generate` accepts `modelRole`, per-key `controls` and a `persona`.
Profiles optionally select `provider`, `models` and default `controls`; existing
version-1 profiles keep their daily model. Non-daily roles require an explicit
model. The facade resolves the role, injects the retained system prompt, checks
capabilities and prepares `providerOptions` before resolving credentials. The
SDK port must consume those options. No SDK dependency was added in this lane;
the existing real-chat SDK integration task remains open.

Provider behavior comes from AI-008 and AI-030–033. OpenAI uses
`max_completion_tokens`, rejects temperature/top-p and supports the recovered
reasoning/search combinations for gpt-5.1 and gpt-5.1-mini. Qwen forwards
thinking/search controls. Kimi k2.5 fixes temperature 0.6/top-p 0.95 and disables
thinking; k2.6 fixes temperature 1/top-p 0.95. Conflicts fail rather than being
overwritten. Unknown Kimi models remain unverified. DeepSeek rejects images;
this version does not claim verified native search or reasoning control for it.
The request contract does not yet contain tool-call history, so the recovered
Kimi/DeepSeek reasoning_content tool-call patch cannot be reached here.
`ai-provider-quirks.ts` is the executable table. Recovered defaults are evidence,
not current live model qualification or silent cross-provider fallbacks.

Mandatory Kimi sampling supplies missing ranges only on the prepared profile
snapshot, after validating caller values. Explicit ranges still constrain the
mandatory values. The saved profile remains unchanged. DeepSeek also rejects
the vision role with text-only messages, even when a profile advertises images.
Routing-role controls come from the request independently of profile defaults;
Auto disables thinking and search without inheriting daily reasoning effort.
Daily and deepThink requests retain the profile's configured controls.

`AiVoiceService.submit` accepts explicit modes or `auto`. Auto uses the routing
model with at most 2048 output tokens and a 300-second deadline. A bounded,
strict JSON decoder accepts only the recovered categories plus agents,
shortcuts and meetings from decision lih.22. The source HA example has invalid
JSON; our prompt fixes it. Search suggestions are gated by the saved profile
control. Home Assistant must be explicitly enabled, including follow-ups.
Pass the returned route back as `sessionRoute` for subsequent Auto turns. Route
state belongs to the caller. `AiVoiceTargets` is the small owning-lane port for
chat/agents/HA/shortcut/meeting/action consumers and grants no execution rights.
There is no complete ChatService or these integration handlers in this checkout.
Desktop key editor and voice-press bindings remain the responsibility of those
consumer lanes; no renderer was changed here.
The caller must bind that route to its own conversation identity and clear it
when starting a new conversation. This service does not accept a conversation
identifier or maintain a shared session registry.

`ROLE_PRESETS` ships 126 recovered prompts with verbatim names for en/zh/ja/ko/
de/fr/es/it. Decision 12 excludes IDs 65, 122, 124 and 125: escape-box, DAN and
the two sexual roleplay presets. IDs remain stable; custom input uses roleId -1
and a bounded customPrompt. `COPILOT_PRESETS` preserves the six role IDs,
translated key names and thinking/search defaults. Preset instructions are sent
as text to the selected provider and never executed on the host.

`AiProviderService.synthesize`, `createSpeech` and `recognize` delegate to
`AiSpeechService`. Speech selection is independent of chat and accepts a
Schema-validated `TtsProfile` or `SttProfile`. Inject `AiCredentials` and
`SpeechHttp`/`SpeechWebSocket`/`SpeechOutput` at the root. `SpeechFetchLive` is an
explicit fetch binding; default Layers have no network provider. WebSocket
connect is a host port because browser WebSocket cannot add bearer headers.
The port must cancel partial acquisitions on its AbortSignal and translate
close/error into a failed receive. This lane introduces no socket dependency.

DashScope uses the corrected PR #19 workspace hosts in Beijing or Singapore,
ASR `qwen-audio-3.1-asr-flash-streaming`, and TTS
`qwen-audio-3.1-tts-flash`/`longanlingxin_v3.1`. SSE accepts fragmented and
multiline data records, requires stop, and rejects errors/truncation. PCM is
24kHz/mono/s16le. Recognition waits for the matching task ID, replaces partials,
deduplicates finalized segments by begin_time, and returns final text only on
task-finished. The synthetic fixture encodes this finality rule; current live
workspace availability and finality semantics have not been probed.

OpenAI uses `/v1/audio/speech`, `gpt-4o-mini-tts`, explicit voice/instructions and
WAV. RIFF chunks, PCM codec, sample rate, channels, block alignment and duration
are verified before playback. The compatibility profile is disabled at
2027-01-06 UTC. Realtime replacement models cannot reach this endpoint.

The player consumer serializes utterances behind one lease, waits for readiness
and natural drain, and stops on cancel, revocation, failure or timeout. Capture
cancels pending speech, calls host output suspension and holds the same lease;
completion does not resume old output. Synthesis is bounded to 30 seconds,
readiness to 10 seconds, and playback to duration plus 10 seconds capped at 120
seconds. Player and WebSocket ports own partially acquired native resources and
must honor interruption. Host microphone/resampling, native playback, answer
batching and hardware behavior are separate open voice-stt-tts tasks.
Recognition allows 10 seconds for run-task plus readiness, limits PCM sends
to the remaining 60-second capture budget, and allows 15 seconds for
finish-task plus the final response. Timeout closes and aborts the socket and
releases the shared speech lease so subsequent capture and playback can run.

Run `pnpm --filter @open-quake/edge test`. Fixtures use fake HTTP/WebSocket and
Effect TestClock only. Tests exercise the facade, transcript and player
consumers, cancellation before readiness, late audio, error identity/privacy,
retirement, routing, locales and unsupported control rejection. No paid request,
microphone, real device, DK-Suite process or hardware acceptance is involved.
