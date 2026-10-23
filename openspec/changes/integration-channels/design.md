# Design

## Context

See proposal.md for the capability boundary. This is a spec-only proposal; every product choice below marked "Approved (Ramiro, 2026-10-23)" was accepted by Ramiro on that date. The delta spec records the recommended acceptance contract, not existing implementation or verified hardware parity.

Inventory: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, sections 7–9, Later phases and the cited open questions.

## Evidence and source paths

Path roots are local-only, read-only research inputs. S means recovered source for the stated behavior, P means partial analysis/dependency evidence, and N means name-only evidence. Source availability does not prove runtime or hardware success. Replacement limits and new failure behavior are proposed, not recovered facts.

- ATLAS = `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion`
- ART = `ATLAS/artifacts`
- RS = `ART/recovered_sources`

- **S** `RS/webpack:__dk-suite_src_views_ManagementCenter_components_channels_ChannelHubSection.vue`: dynamic catalog/status merge and openclaw-list-channels/list-channel-catalog/remove-channel calls.
- **S** `RS/webpack:__dk-suite_src_views_ManagementCenter_components_channels_ChannelCatalogCard.vue`: catalog-driven cards and status display.
- **S** `RS/webpack:__dk-suite_src_views_ManagementCenter_components_channels_ChannelSetupDrawer.vue`: qr_login, credentials_or_qr, bot_token forms and OpenClaw setup/login APIs.
- **S** `RS/webpack:__dk-suite_src_views_ManagementCenter_components_channels_ChannelQrPanel.vue`: QR display and login progress UI.

## Goals / Non-Goals

Goals: give implementers one owned contract, observable failure states and a verification path for this capability.

Non-goals: implementation in this lane, new dependencies, changes to other lanes' artifacts, guessed device opcodes, or claiming unresolved integrations work.

## Package ownership

`packages/edge` channel contracts, setup state machine, adapter registry and conductor; `packages/client` typed catalog/setup events; `apps/desktop` setup drawer, QR display and secret-store adapter. The OpenClaw lane owns runtime installation and channel providers. No new device/protocol behavior.

Approved (Ramiro, 2026-10-23): keep domain modules in the existing packages rather than adding feature packages now. In `packages/edge`, each domain separates contracts, pure invariants, repository interfaces and an Effect.Service conductor. Electron-specific APIs live in `apps/desktop/src/main` adapters supplied at the composition root; renderers consume `packages/client` through a narrow typed preload bridge. `packages/protocol` stays pure; `packages/device` owns hardware I/O. `packages/cli` is an optional client, not another domain owner.

Native control contracts are Schema-first `@effect/rpc`; external third-party protocols stay boundary adapters. Services declare dependencies, use named `Effect.fn` methods with explicit success/error types and scoped cleanup. User/automation actions have one capability-registry declaration. UI never calls raw SDKs. AI calls, where needed, use the existing Vercel AI SDK Effect facade and mocked providers in CI.

## Decisions

1. Approved (Ramiro, 2026-10-23): question 9 remains open. Feishu/Lark and bot-token form branches are observed, but they are not an authoritative catalog. Ship only adapters with their own verified contract; an empty catalog is a supported state.

2. Approved (Ramiro, 2026-10-23): keep the hub independent of runtime installation. Runtime absence yields unavailable setup rather than an implicit install.

3. Approved (Ramiro, 2026-10-23): setup sessions expire after five minutes unless the adapter supplies an earlier expiry; ignore progress from cancelled/replaced session IDs.

### Data model

Approved (Ramiro, 2026-10-23): ChannelDescriptor carries ID, label, setup type, field schemas, runtime requirement and availability. SetupSession carries channel ID, unique session ID, deadline and state. ChannelConfig stores enabled flag and secret references; runtime status stays distinct from saved configuration.

### Data flow and lifecycle

Approved (Ramiro, 2026-10-23): The runtime/provider lane supplies adapters into a registry, not a hard-coded recovered catalog. The hub queries descriptors and live status through the channel conductor. Setup validates descriptor fields, creates a session and streams correlated progress to the drawer. Closing/removal cancels session scope; save does not imply connection verification.

### Failure contract

Approved (Ramiro, 2026-10-23): use operation-specific catalog leaves, initially QUAKE.CHANNEL.UNAVAILABLE, QUAKE.CHANNEL.SETUP_INVALID, QUAKE.CHANNEL.SESSION_EXPIRED and QUAKE.CHANNEL.REMOVAL_FAILED. Final code names must be reconciled with the shared catalog before implementation; never introduce a second catalog. Each leaf is a catalog-derived Schema.TaggedError with private original cause and bounded, scrubbed diagnostic projection. Consumers branch on tag/code, never text. Verify exact identity, cause retention, safe serialization and broken-dependency paths through real consumers.

## Recommended phase and dependencies

Later phases item 4 for the hub and fake adapter. Runtime-backed channels depend on Later phases item 5, DKClaw/OpenClaw, even though the inventory lists the hub earlier.

Dependencies are contracts supplied by their owning changes. An unavailable dependency yields an explicit unavailable state; this change does not duplicate its implementation or modify its specs.

## Risks / Trade-offs

Inventory question 9 is unresolved and recovered setup names can be mistaken for supported integrations. Show only registered verified descriptors; link runtime enablement to the owning runtime change.

The proposed package placement keeps current workspace boundaries but grows `packages/edge`; retain cohesive domain files and split a new package only when ownership or dependency constraints justify it. No npm dependency is selected here; future dependency proposals must name exact versions and approval needs.

## Migration plan

Create versioned local settings/repository records behind a capability gate. Validate imported shapes before writing and preserve the last valid snapshot on failure. Enable only the verified capability subset after its acceptance scenarios pass. Roll back by disabling the capability and retaining readable user records; destructive native side effects need their own recovery flow.

## Verification and outstanding evidence

Use an empty registry, unavailable-runtime adapter and controllable QR adapter to drive the actual hub/drawer. Prove stale events cannot change a new session, credentials never enter status serialization and removal affects only one channel. Real channel catalog, pairings and external messaging remain unverified.

Implementation closure requires scenario evidence and parent-managed Beads updates. The tasks in tasks.md remain unchecked in this design lane. Do not launch DK-Suite; use independent fixtures and the open-quake application for future verification.
