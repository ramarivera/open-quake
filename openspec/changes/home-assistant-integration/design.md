# Design

## Context

See proposal.md for the capability boundary. This is a spec-only proposal; every product choice below marked "Proposed (pending Ramiro)" awaits a decision. The delta spec records the recommended acceptance contract, not existing implementation or verified hardware parity.

Inventory: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, sections 7–9, Later phases and the cited open questions.

## Evidence and source paths

Path roots are local-only, read-only research inputs. S means recovered source for the stated behavior, P means partial analysis/dependency evidence, and N means name-only evidence. Source availability does not prove runtime or hardware success. Replacement limits and new failure behavior are proposed, not recovered facts.

- ATLAS = `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion`
- ART = `ATLAS/artifacts`
- RS = `ART/recovered_sources`

- **S** `RS/webpack:__dk-suite_src_views_Components_HomeAssistantConfig.vue`: URL/token and TLS toggle, connect/reconnect, room/domain grouping, service data fields and selected entity display fields.
- **N** `ART/store_keys.txt`: haConfig.hassUrl, haConfig.accessToken and haConfigIgnoreSSLErrors.
- **P** `RS/webpack:__dk-suite_src_main_ai_AIManager.js`: HA prompt/execution integration; AI behavior belongs to the AI lane.

## Goals / Non-Goals

Goals: give implementers one owned contract, observable failure states and a verification path for this capability.

Non-goals: implementation in this lane, new dependencies, changes to other lanes' artifacts, guessed device opcodes, or claiming unresolved integrations work.

## Package ownership

`packages/edge` HA contracts, repository interface, connection and execution conductor; `packages/client` typed HA API; `apps/desktop` secret-store adapter and HA configuration/status UI. Profile and AI services call the same action capability. Protocol/device packages retain their existing event/display role.

Proposed (pending Ramiro): keep domain modules in the existing packages rather than adding feature packages now. In `packages/edge`, each domain separates contracts, pure invariants, repository interfaces and an Effect.Service conductor. Electron-specific APIs live in `apps/desktop/src/main` adapters supplied at the composition root; renderers consume `packages/client` through a narrow typed preload bridge. `packages/protocol` stays pure; `packages/device` owns hardware I/O. `packages/cli` is an optional client, not another domain owner.

Native control contracts are Schema-first `@effect/rpc`; external third-party protocols stay boundary adapters. Services declare dependencies, use named `Effect.fn` methods with explicit success/error types and scoped cleanup. User/automation actions have one capability-registry declaration. UI never calls raw SDKs. AI calls, where needed, use the existing Vercel AI SDK Effect facade and mocked providers in CI.

## Decisions

1. Proposed (pending Ramiro): certificate validation stays enabled by default. A user-selected certificate exception is scoped to one configured HA origin and shown in status; no process-wide TLS override.

2. Proposed (pending Ramiro): use direct user-configured HA connections and OS-backed secret references. Do not mirror the recovered plain store key as a renderer-readable token.

3. Proposed (pending Ramiro): AI produces a schema-validated entity/service intent. Execution remains an HA capability; unvalidated model text never becomes a service call.

### Data model

Proposed (pending Ramiro): HAConfig stores normalized origin, token reference and per-origin TLS policy. EntitySelection stores entity ID, service ID, validated service data and display fields. ConnectionState carries generation ID so late responses from an old endpoint cannot mark a new endpoint connected.

### Data flow and lifecycle

Proposed (pending Ramiro): Desktop resolves the protected secret only inside the HA adapter. The HA conductor connects, fetches entities/services and produces grouped selection data. Both configured key events and approved AI intents call the same validated execution capability. Refresh replaces the entity/service snapshot atomically; action requests bind to that connection generation.

### Failure contract

Proposed (pending Ramiro): use operation-specific catalog leaves, initially QUAKE.HA.AUTH_FAILED, QUAKE.HA.CERTIFICATE_REJECTED, QUAKE.HA.ACTION_INVALID and QUAKE.HA.REQUEST_FAILED. Final code names must be reconciled with the shared catalog before implementation; never introduce a second catalog. Each leaf is a catalog-derived Schema.TaggedError with private original cause and bounded, scrubbed diagnostic projection. Consumers branch on tag/code, never text. Verify exact identity, cause retention, safe serialization and broken-dependency paths through real consumers.

## Recommended phase and dependencies

Later phases item 4, Home Assistant integration and channels hub. Requires an HA test instance, profile actions and, for natural-language control, the AI intent contract.

Dependencies are contracts supplied by their owning changes. An unavailable dependency yields an explicit unavailable state; this change does not duplicate its implementation or modify its specs.

## Risks / Trade-offs

Entity catalogs can change after a key is saved, and retries can duplicate non-idempotent service calls. Validate the current service snapshot and report unknown outcomes without replay.

The proposed package placement keeps current workspace boundaries but grows `packages/edge`; retain cohesive domain files and split a new package only when ownership or dependency constraints justify it. No npm dependency is selected here; future dependency proposals must name exact versions and approval needs.

## Migration plan

Create versioned local settings/repository records behind a capability gate. Validate imported shapes before writing and preserve the last valid snapshot on failure. Enable only the verified capability subset after its acceptance scenarios pass. Roll back by disabling the capability and retaining readable user records; destructive native side effects need their own recovery flow.

## Verification and outstanding evidence

A fake HA endpoint must prove auth/certificate failures, invalid service fields, no retry after unknown mutation outcome and reconnect refresh. Then use a user-controlled HA test instance and the real key/editor consumers to assert exactly one service call plus state updates. HA credentials, test instance and physical triggers are unverified in this spec lane.

Implementation closure requires scenario evidence and parent-managed Beads updates. The tasks in tasks.md remain unchecked in this design lane. Do not launch DK-Suite; use independent fixtures and the open-quake application for future verification.
