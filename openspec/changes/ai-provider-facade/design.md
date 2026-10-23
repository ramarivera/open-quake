# Design

## Context

The wayfinder direction supplied for L6 fixes Vercel AI SDK provider facades, BYO keys, Codex OAuth device login, local data ownership, and macOS before Linux. The conductor AI exception requires an Effect.Service around the Vercel AI SDK, never `@effect/ai`. SDK types and credentials do not cross into renderer contracts. This is a proposed implementation contract, not evidence of working provider access.

## Goals / Non-goals

Goal: Keep provider/auth details behind one tested contract with credential-free consumers.

Non-goal: Do not choose a model catalog, copy DK-Suite engine code, or implement generic OAuth token extraction.

## Decisions

Approved (Ramiro, 2026-10-23): all recommendations in this design are approved. Evidence labels still distinguish recovered observations from deliberate replacements. Approval does not establish live integration or hardware verification.

### Package ownership

Approved (Ramiro, 2026-10-23): use existing `packages/edge/src/ai/` for `ai-contracts`, `ai-invariants`, `ai-repository`, and `ai-service`, with adapter modules beneath it. This avoids introducing another package before a real consumer exists. Expose Schema-only contracts through a browser-safe export; `packages/client/` owns typed consumers. `apps/desktop/src/main/` owns the OS credential-store and optional Codex helper adapters. Renderer settings use redacted profile summaries.

`AiProviderService` owns capability checks, Config selection, SDK calls, and SDK-to-domain event normalization. Public methods use named Effect.fn spans and explicit success/error types. Repositories own profile persistence and opaque credential references. The root application composes declared service dependencies as Layers. `@effect/rpc` defines configuration and inference contracts; Electron preload is a thin allowlisted adapter. A future HTTP/SSE edge uses Elysia over the same contracts.

### Profiles and inference

A profile has an opaque ID, adapter kind, explicit base URL, model ID, auth kind, credential reference, sampling options, and declared/tested capabilities. Capabilities include text, tools, images, image/video generation, STT, and TTS, each with supported/unsupported/unverified status. Chat and speech select profiles independently. Model names and sampling rules are configuration, not copied DK-Suite defaults.

Normalize the SDK stream to text deltas, optional follow-up suggestions, usage, and one completion/failure. Chat owns public `answer`/`followUp`/`end` envelopes. Capability rejection happens before network I/O; credentials are attached only inside the selected adapter. BYO-key first-release support targets explicit OpenAI-compatible chat configuration. Empty credentials do not silently select an account proxy. An explicit unauthenticated loopback profile is a later option, separate from a missing key.

### Codex device authentication

Official documentation read on 2026-10-23 establishes a Codex-managed device flow. The documented app-server request is `account/login/start` with `type: chatgptDeviceCode`; its response includes `loginId`, `verificationUrl`, and `userCode`. Completion arrives through `account/login/completed`, cancellation uses `account/login/cancel`, and logout uses `account/logout`. The CLI also documents `codex login --device-auth`.

Approved (Ramiro, 2026-10-23): use a user-installed, version-checked Codex app-server helper with an application-owned credential namespace. Keep OAuth tokens inside that helper. A custom Vercel AI SDK provider bridge must prove text-only inference, cancellation, capability reporting, no unsolicited host tools, and grant isolation. Login success alone does not make an inference profile ready. Do not extract a bearer token and feed it to an arbitrary OpenAI-compatible endpoint.

Official docs recommend migration to Sign in with ChatGPT and describe restrictions on app-server authentication. They establish neither approval for a new open-quake integration nor an off-the-shelf Vercel adapter. Approved (Ramiro, 2026-10-23): validate the supported integration and usage terms before enabling this route; keep its status `unavailable` with a reason if the bridge cannot be established. Retain device-login product intent without substituting another auth product silently. BYO-key operation remains independent.

Login states are signedOut, starting, awaitingUser, ready, expired, cancelled, and failed. Each attempt has a new ID. The helper owns polling/token refresh. A local ten-minute watchdog bounds an attempt when the helper provides no earlier expiry. Ignore stale completion notifications. Logout invalidates queued requests for that auth generation; active requests terminate with auth revocation, never restart with another credential.

### Recovered engine disposition

| DK-Suite engine | Open-quake treatment |
| --- | --- |
| StandardChat 4 | First-release custom compatible profile |
| OpenAI 1, GroqChat 3, QWenChat 5, ZhiPuChat 6, KimiChat 10, DeepSeekChat 11 | Explicit compatible profiles when conformance-tested; no promise that every modality works |
| XFY 0, HuoShan 8, Coze 9 | Later dedicated adapters only after wire/capability evidence |
| ArixoChat 2 | Drop DecoKee-account/proxy dependency |
| CustomEngine 7 | Replace unrestricted engine code with validated adapter/profile configuration |

Recovered `AI_ENGINE_TYPE` spells engine 0 `XYF`, while speech labels use XFY. Import aliases may recognize both, but public IDs use stable strings. No numeric ordinal controls runtime dispatch.

### Error and privacy boundary

Catalog leaves include `AI.PROVIDER.CONFIG_INVALID`, `AI.PROVIDER.AUTH_REQUIRED`, `AI.PROVIDER.AUTH_REVOKED`, `AI.PROVIDER.CAPABILITY_UNSUPPORTED`, `AI.PROVIDER.RATE_LIMITED`, `AI.PROVIDER.UNAVAILABLE`, `AI.PROVIDER.PROTOCOL_INVALID`, and `AI.AUTH.DEVICE_LOGIN_EXPIRED`. Translate SDK/helper failures at the actual boundary into Schema.TaggedError leaves. Retain original causes privately and serialize only bounded scrubbed diagnostics. Never log prompts, generated content, API keys, device codes, auth URLs with secrets, or tokens. UI errors resolve stable codes through GT. No automatic generation retry after a request starts; a user can create a new turn.

### Evidence and deliberate replacements

Local research root `R` is `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion`; `RS` means `R/artifacts/recovered_sources`. These are read-only local inputs, not committed files.

- S: `RS/webpack:__dk-suite_src_main_ai_AIManager.js:77-103` proves engine IDs and speech labels.
- S: `RS/webpack:__dk-suite_src_main_ai_Connector_openAiCompatProviderProfiles.js` proves explicit profile handling, provider sampling patches, and proxy coupling. These are interoperability observations, not code to copy.
- P: `R/SUBAGENT_AI_ARCHITECTURE.md` summarizes endpoints. An inferred endpoint is not an adapter acceptance test.
- Product direction: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, section 4 and First-release cut, plus the L6 wayfinder direction.
- External documentation: https://developers.openai.com/codex/auth and https://developers.openai.com/codex/app-server, authentication sections, fetched 2026-10-23. No credentials or live login were used.

Deliberately replace geo-seeded selection, account credits, MQTT keys, cloud model sync, silent modality stripping, and the twelve-engine switch with explicit local profiles and fail-before-send capability validation. No account login to DecoKee is required. Local configuration does not imply offline external inference.

## Approved decisions and verification

- Approved (Ramiro, 2026-10-23): approve package locations above and the Codex helper/custom-provider bridge only after a focused integration spike.
- Approved (Ramiro, 2026-10-23): macOS Keychain-backed credential storage; Linux Secret Service day 2. If secure storage is unavailable, use an explicitly selected in-memory session, never plaintext fallback.
- Approved (Ramiro, 2026-10-23): require HTTPS for remote providers, allow HTTP only for explicit loopback profiles, and refuse credential-bearing cross-origin redirects.
- Approved (Ramiro, 2026-10-23): SDK major version and adapter package set are chosen and pinned during implementation after exact-version approval. W7 proposes `ai@7.0.150` and `@ai-sdk/openai-compatible@3.0.77`; neither is installed. Task 1.3 and the real adapter remain deferred.

Use mock SDK/credential/helper Layers and a fake clock. Acceptance must drive a real chat consumer through profile selection, outbound request, stream, cancellation, and safe failure serialization. Live provider compatibility, actual device login, OS credential stores, and Linux behavior are unverified.

## Migration and rollback

Introduce versioned local profiles without changing existing device configuration. Preview imported engine names and require explicit credential entry. Enable the mock facade, then a verified compatible profile; enable OAuth only after its bridge decision. Rollback disables the new adapter/profile and preserves local metadata for repair. Never downgrade secure credential storage or copy an OAuth grant into an API-key field.

## Risks and alternatives

- SDK/provider protocol drift can invalidate model capabilities. Pin versions and rerun the real-consumer conformance suite before updates.
- A helper-owned OAuth namespace may not be available in the chosen version. Keep the route unavailable until isolation is established; using the user's unrelated Codex session implicitly is not an accepted substitute.
- A generic profile can simplify settings but conceal unsupported modalities. Keep explicit per-profile capability evidence rather than presenting twelve untested provider badges.

## W7 implementation boundary

The mock-default facade, profile Schemas/invariants, volatile metadata repository,
AI catalog, and host Keychain interface are implemented. See
`packages/edge/src/ai/README.md`,
`apps/desktop/src/main/credentials/README.md`, and `verification.md`.
The desktop root, native Keychain binding, settings consumer, real ChatService,
Vercel SDK adapter, and Codex helper remain unwired. These are integration
acceptance items, not revoked design approvals.
