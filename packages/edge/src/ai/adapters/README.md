# Direct text provider adapter

`VercelCompatibleAdapterLive` binds the existing `AiCompatibleAdapter` port to
Vercel's production `streamText` and OpenAI-compatible chat provider. For an
injected transport, use `makeVercelCompatibleAdapter(fetcher)` and
`Layer.succeed(AiCompatibleAdapter, adapter)`. Credentials remain host-only
`Redacted` values resolved by `AiProviderService`. The facade is still mock by
default; a selected compatible profile requires this layer and `AiCredentials`.

The exact pins are `ai@7.0.153` and `@ai-sdk/openai-compatible@3.0.78`.
The registry and both published source packages were checked on 2026-10-25.
They share provider protocol `@ai-sdk/provider@4.0.34` and utilities
`@ai-sdk/provider-utils@5.0.68`, require Node 22 or newer, and fit the existing
Electron 43 runtime. The compatible provider's `getArgs` and `doStream`
implement custom fetch, named provider-body options and streaming usage.
Source is included in the published npm packages. The reference documentation
is https://ai-sdk.dev/providers/openai-compatible-providers.

`maxRetries: 0` disables dispatch retries. Stream retries are left disabled.
Every request uses `redirect: "error"`, an owned abort signal and the validated
profile URL. Provider-specific options come from `prepareWorkflow`; OpenAI's
`max_completion_tokens` replaces `max_tokens`, and the SDK's known
`reasoningEffort` option maps to `reasoning_effort`. Generic/Qwen/Kimi options
remain on the named provider body. Missing usage gets an explicitly estimated
UTF-8 byte count, never fabricated reported tokens.

This first adapter accepts text only. It rejects image/tool capability requests
and unsolicited tool output. It supplies no tools or executors, never fetches
attachments, never exposes reasoning deltas and accepts only a normal `stop`
finish as completed. Truncated, missing or malformed terminals fail with the
protocol catalog error. SDK failures retain private original causes and expose
only the existing scrubbed diagnostic projection.

`vercel.test.ts` drives the real facade and installed SDK with fragmented HTTP
fixtures, numeric failures, malformed streams and a pending fetch. The redirect
test uses two disposable loopback HTTP servers and proves no request reaches
the destination. None of these tests call an external provider or account.
