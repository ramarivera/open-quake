# Design

## Context

See proposal.md for the capability boundary. This is a spec-only proposal; every product choice below marked "Approved (Ramiro, 2026-10-23)" was accepted by Ramiro on that date. The delta spec records the recommended acceptance contract, not existing implementation or verified hardware parity.

Inventory: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, sections 7–9, Later phases and the cited open questions.

## Evidence and source paths

Path roots are local-only, read-only research inputs. S means recovered source for the stated behavior, P means partial analysis/dependency evidence, and N means name-only evidence. Source availability does not prove runtime or hardware success. Replacement limits and new failure behavior are proposed, not recovered facts.

- ATLAS = `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion`
- ART = `ATLAS/artifacts`
- RS = `ART/recovered_sources`

- **S** `RS/webpack:__dk-suite_src_views_Setting_PluginConfig.vue`: local install/delete, manifest metadata and PluginListChange notifications.
- **N** `ART/store_keys.txt`: plugin.streamDeck and pluginWebPageServerPort/pluginWSServerPort/viaPluginPort/HardwareWSServerPort names.
- **N** `ART/ipc_channels.txt`: PluginVisibilityChanged name.
- **S** `RS/webpack:__dk-suite_src_views_DKQuake_RemoteSocketClient.vue`: localhost WSServerPort, default 20230, sn query, open-time config/profile reports and binary decode.

## Goals / Non-Goals

Goals: give implementers one owned contract, observable failure states and a verification path for this capability.

Non-goals: implementation in this lane, new dependencies, changes to other lanes' artifacts, guessed device opcodes, or claiming unresolved integrations work.

## Package ownership

`packages/edge` plugin contracts, repository, compatibility conductor and third-party WS/page adapters; `packages/client` typed management API; `apps/desktop` archive selection, plugin UI and explicit process-launch adapter. Protocol/device packages receive only existing normalized actions. No native plugin dependency is chosen by this proposal.

Approved (Ramiro, 2026-10-23): keep domain modules in the existing packages rather than adding feature packages now. In `packages/edge`, each domain separates contracts, pure invariants, repository interfaces and an Effect.Service conductor. Electron-specific APIs live in `apps/desktop/src/main` adapters supplied at the composition root; renderers consume `packages/client` through a narrow typed preload bridge. `packages/protocol` stays pure; `packages/device` owns hardware I/O. `packages/cli` is an optional client, not another domain owner.

Native control contracts are Schema-first `@effect/rpc`; external third-party protocols stay boundary adapters. Services declare dependencies, use named `Effect.fn` methods with explicit success/error types and scoped cleanup. User/automation actions have one capability-registry declaration. UI never calls raw SDKs. AI calls, where needed, use the existing Vercel AI SDK Effect facade and mocked providers in CI.

## Decisions

1. Approved (Ramiro, 2026-10-23): do not claim general Elgato compatibility until a real fixture covers manifest, registration, key down/up, context, settings and feedback. Unsupported APIs fail explicitly.

2. Approved (Ramiro, 2026-10-23): questions 7 and 12 remain unresolved. RemoteSocketClient uses WSServerPort, not the inventory's presumed HardwareWSServerPort. This supports a local client hypothesis but proves no server binding or LAN handshake. viaPluginPort alone does not establish VIA interoperability.

3. Approved (Ramiro, 2026-10-23): select an available loopback port and report it; conflicts fail without killing another process. Launch plugin executables only after an explicit local enable action; arbitrary-code plugins are not represented as sandboxed.

### Data model

Approved (Ramiro, 2026-10-23): PluginRecord stores manifest identity, installation location reference, version, enabled flag and visible flag. CompatibilityDescriptor versions supported APIs and fixture evidence. RuntimeSession binds plugin ID, launch credential and allowed action contexts. Public status omits launch credentials and executable paths.

### Data flow and lifecycle

Approved (Ramiro, 2026-10-23): Inventory operations go through a plugin repository and manifest validator. After compatibility evidence and explicit enablement, desktop launches the adapter/process, passes a private launch credential and advertised loopback port, and registers owned contexts. Third-party protocol messages are decoded at the WS boundary before dispatching typed internal actions; settings/image feedback returns only to its registered context.

### Failure contract

Approved (Ramiro, 2026-10-23): use operation-specific catalog leaves, initially QUAKE.PLUGIN.MANIFEST_INVALID, QUAKE.PLUGIN.COMPAT_UNVERIFIED, QUAKE.PLUGIN.PORT_CONFLICT, QUAKE.PLUGIN.REGISTRATION_REJECTED and QUAKE.PLUGIN.CONTEXT_REJECTED. Final code names must be reconciled with the shared catalog before implementation; never introduce a second catalog. Each leaf is a catalog-derived Schema.TaggedError with private original cause and bounded, scrubbed diagnostic projection. Consumers branch on tag/code, never text. Verify exact identity, cause retention, safe serialization and broken-dependency paths through real consumers.

## Recommended phase and dependencies

Later phases item 6, Stream Deck compatibility server. Requires profile action routing and a documented fixture plugin/protocol transcript.

Dependencies are contracts supplied by their owning changes. An unavailable dependency yields an explicit unavailable state; this change does not duplicate its implementation or modify its specs.

## Risks / Trade-offs

Installed plugins execute local code and may assume unsupported Elgato APIs. Require explicit enablement and a declared tested subset; do not claim sandboxing or silently enable unrelated ports.

The proposed package placement keeps current workspace boundaries but grows `packages/edge`; retain cohesive domain files and split a new package only when ownership or dependency constraints justify it. No npm dependency is selected here; future dependency proposals must name exact versions and approval needs.

## Migration plan

Create versioned local settings/repository records behind a capability gate. Validate imported shapes before writing and preserve the last valid snapshot on failure. Enable only the verified capability subset after its acceptance scenarios pass. Roll back by disabling the capability and retaining readable user records; destructive native side effects need their own recovery flow.

## Verification and outstanding evidence

First write a versioned protocol transcript with a minimal local fixture plugin. Drive install/enable/key down/up/settings/image/disable through real management and action consumers. Include traversal archives, invalid registration, cross-context messages and shutdown resource counts. General Elgato plugins, VIA, LAN control and hardware-remote protocols remain unverified.

Implementation closure requires scenario evidence and parent-managed Beads updates. The tasks in tasks.md remain unchecked in this design lane. Do not launch DK-Suite; use independent fixtures and the open-quake application for future verification.
