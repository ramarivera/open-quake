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
