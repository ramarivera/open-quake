# Design

## Context

See proposal.md for the capability boundary. This is a spec-only proposal; every product choice below marked "Approved (Ramiro, 2026-10-23)" was accepted by Ramiro on that date. The delta spec records the recommended acceptance contract, not existing implementation or verified hardware parity.

Inventory: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, sections 7–9, Later phases and the cited open questions.

## Evidence and source paths

Path roots are local-only, read-only research inputs. S means recovered source for the stated behavior, P means partial analysis/dependency evidence, and N means name-only evidence. Source availability does not prove runtime or hardware success. Replacement limits and new failure behavior are proposed, not recovered facts.

- ATLAS = `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion`
- ART = `ATLAS/artifacts`
- RS = `ART/recovered_sources`

- **S** `RS/webpack:__dk-suite_src_main_utils_ActiveWindowService.js`: query locking, cached results, scoped polling and stop lifecycle.
- **S** `RS/webpack:__dk-suite_src_main_utils_ActiveWindowService.logic.js`: 500 ms cache, 3000 ms macOS and 2000 ms other-platform poll defaults, 5000 ms execution timeout.
- **S** `RS/webpack:__dk-suite_src_views_Setting_GeneralSettings.vue`: monitor master switch, method, and frame-rate controls.
- **N** `ART/store_keys.txt`: settings.appMonitorConfig, settings.gameModeMonitorConfig and system.appMonitor* names; metric collector details remain unproven.
- **N** `ART/ipc_channels.txt`: app-monitor-view-config-changed and set-gaming-mode channel names.

## Goals / Non-Goals

Goals: give implementers one owned contract, observable failure states and a verification path for this capability.

Non-goals: implementation in this lane, new dependencies, changes to other lanes' artifacts, guessed device opcodes, or claiming unresolved integrations work.

## Package ownership

`packages/edge` monitoring contracts, invariants, collector interfaces and conductor; `packages/client` typed subscription API; `apps/desktop` native collectors and tile/settings views. `packages/device` consumes existing display delivery; `packages/protocol` gains no monitoring opcodes.

Approved (Ramiro, 2026-10-23): keep domain modules in the existing packages rather than adding feature packages now. In `packages/edge`, each domain separates contracts, pure invariants, repository interfaces and an Effect.Service conductor. Electron-specific APIs live in `apps/desktop/src/main` adapters supplied at the composition root; renderers consume `packages/client` through a narrow typed preload bridge. `packages/protocol` stays pure; `packages/device` owns hardware I/O. `packages/cli` is an optional client, not another domain owner.

Native control contracts are Schema-first `@effect/rpc`; external third-party protocols stay boundary adapters. Services declare dependencies, use named `Effect.fn` methods with explicit success/error types and scoped cleanup. User/automation actions have one capability-registry declaration. UI never calls raw SDKs. AI calls, where needed, use the existing Vercel AI SDK Effect facade and mocked providers in CI.

## Decisions

1. Approved (Ramiro, 2026-10-23): use a 1 Hz metric default with a validated 0.2–10 Hz range, coalesce active-window queries, and keep at most one sample request in flight per collector. These are replacement-client budgets, not measured DK-Suite metric rates.

2. Approved (Ramiro, 2026-10-23): gaming mode overlays saved monitoring settings and restores them on exit; it does not rewrite profiles or infer game detection from arbitrary foreground apps.

3. Approved (Ramiro, 2026-10-23): unsupported collectors remain visible as unavailable. ActiveWindowService proves window discovery, not implementations of every metric named by the inventory.

### Data model

Approved (Ramiro, 2026-10-23): MonitoringConfig stores masterEnabled, metric IDs, collector method, sample rate, app monitor settings and separate game overrides. MetricSample stores metric ID, collectedAt, unit and an availability-tagged value. ForegroundWindow contains only required window/app identity, not captured screen content.

### Data flow and lifecycle

Approved (Ramiro, 2026-10-23): An enabled settings capability starts a scoped monitoring conductor. Host collectors return normalized samples through contracts; the conductor marks stale values using an injected clock and fans out one snapshot stream. Gaming mode overlays the saved normal config; leaving it reads the latest normal snapshot. Foreground-window requests use one query lock and cache, separate from metric collection.

### Failure contract

Approved (Ramiro, 2026-10-23): use operation-specific catalog leaves, initially QUAKE.MONITOR.PERMISSION_DENIED, QUAKE.MONITOR.COLLECTION_FAILED and QUAKE.MONITOR.CONFIG_INVALID. Final code names must be reconciled with the shared catalog before implementation; never introduce a second catalog. Each leaf is a catalog-derived Schema.TaggedError with private original cause and bounded, scrubbed diagnostic projection. Consumers branch on tag/code, never text. Verify exact identity, cause retention, safe serialization and broken-dependency paths through real consumers.

## Recommended phase and dependencies

Later phases item 1, system monitor tiles, app monitor, and gaming mode. Implementation follows the profile/grid and display contracts.

Dependencies are contracts supplied by their owning changes. An unavailable dependency yields an explicit unavailable state; this change does not duplicate its implementation or modify its specs.

## Risks / Trade-offs

Platform collectors differ and app titles can reveal private information. Expose per-collector availability, minimize stored window data and keep raw titles/process details out of diagnostics.

The proposed package placement keeps current workspace boundaries but grows `packages/edge`; retain cohesive domain files and split a new package only when ownership or dependency constraints justify it. No npm dependency is selected here; future dependency proposals must name exact versions and approval needs.

## Migration plan

Create versioned local settings/repository records behind a capability gate. Validate imported shapes before writing and preserve the last valid snapshot on failure. Enable only the verified capability subset after its acceptance scenarios pass. Roll back by disabling the capability and retaining readable user records; destructive native side effects need their own recovery flow.

## Verification and outstanding evidence

Use a fake clock and controllable collectors to prove non-overlap, stale thresholds, disable-during-query and gaming restore. Drive a settings save through the typed client to both actual tile consumers and assert obsolete collectors stop. Native collector availability and all device display behavior remain unverified until exercised on target hosts/hardware.

Implementation closure requires scenario evidence and parent-managed Beads updates. The tasks in tasks.md remain unchecked in this design lane. Do not launch DK-Suite; use independent fixtures and the open-quake application for future verification.
