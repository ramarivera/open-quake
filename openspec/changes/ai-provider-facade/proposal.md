# Proposal

## Why

DK-Suite couples provider selection to numeric engine IDs, region defaults, and account proxies. Open-quake needs an account-independent provider contract shared by desktop chat, voice routes, and later agent tools.

## What Changes

- Define an Effect.Service facade over the Vercel AI SDK, with Config-selected adapters, named spans, catalog errors, and mock-provider CI.
- Ship a user-configured OpenAI-compatible provider with a user-supplied key first. Include Codex OAuth device login as a separately verified authentication route, with its inference bridge explicitly pending.
- Define provider capabilities, credential isolation, cancellation, sampling validation, and the disposition of all twelve recovered engine IDs.
- Keep configuration and history local. User-selected external providers still receive requests. Local-only means no open-quake or DecoKee account/backend dependency.

## Capabilities

### New Capabilities

- `ai-provider-facade`: provider profiles, BYO credentials, Codex device login, SDK adaptation, and provider failures.

### Modified Capabilities

None.

## Impact

Approved owners are `packages/edge/src/ai/`, browser-safe contracts and clients in `packages/client/`, and credential/UI adapters in `apps/desktop/`. Depends on the shared error catalog. Future dependencies include `ai` and the selected Vercel provider adapter; exact versions require implementation-time approval and catalog pins. W7 implements the foundation documented in design.md; integration tasks remain open. macOS is day 1; Linux credential and helper integration is day 2.
