# Design

## Context

See proposal.md for the capability boundary. Every product choice below marked "Approved (Ramiro, 2026-10-23)" was accepted by Ramiro on that date. The original planning record is retained here, followed by the 2026-10-26 implementation decisions. Native and physical acceptance limits are recorded in verification.md.

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
- **N** `ART/ipc_channels.txt`: app-monitor-view-config-changed. `set-gaming-mode` belongs to device-typed hotkeys (`MAIN-096`), not this monitoring override.

## Goals / Non-Goals

Goals: give implementers one owned contract, observable failure states and a verification path for this capability.

Non-goals: new dependencies, guessed device opcodes, storing foreground history or claiming unresolved integrations work.

## Package ownership

`packages/edge` monitoring contracts, invariants, collector interfaces and conductor; `packages/client` typed subscription API; `apps/desktop` native collectors and tile/settings views. `packages/device` consumes existing display delivery; `packages/protocol` gains no monitoring opcodes.

Approved (Ramiro, 2026-10-23): keep domain modules in the existing packages rather than adding feature packages now. In `packages/edge`, each domain separates contracts, pure invariants, repository interfaces and an Effect.Service conductor. Electron-specific APIs live in `apps/desktop/src/main` adapters supplied at the composition root; renderers consume `packages/client` through a narrow typed preload bridge. `packages/protocol` stays pure; `packages/device` owns hardware I/O. `packages/cli` is an optional client, not another domain owner.

Native control contracts are Schema-first `@effect/rpc`; external third-party protocols stay boundary adapters. Services declare dependencies, use named `Effect.fn` methods with explicit success/error types and scoped cleanup. User/automation actions have one capability-registry declaration. UI never calls raw SDKs. AI calls, where needed, use the existing Vercel AI SDK Effect facade and mocked providers in CI.

## Decisions

1. Approved (Ramiro, 2026-10-23): use a 1 Hz metric default with a validated 0.2–10 Hz range, coalesce active-window queries, and keep at most one sample request in flight per collector. These are replacement-client budgets, not measured DK-Suite metric rates.

2. Approved (Ramiro, 2026-10-23): monitoring override overlays saved monitoring settings and restores them on exit; it does not rewrite profiles or infer game detection from arbitrary foreground apps.

3. Approved (Ramiro, 2026-10-23): unsupported collectors remain visible as unavailable. ActiveWindowService proves window discovery, not implementations of every metric named by the inventory.

### Data model

Approved (Ramiro, 2026-10-23): MonitoringConfig stores masterEnabled, metric IDs, collector method, sample rate, app monitor settings and separate monitoring overrides. MetricSample stores metric ID, collectedAt, unit and an availability-tagged value. ForegroundWindow contains only required window/app identity, not captured screen content.

### Data flow and lifecycle

Approved (Ramiro, 2026-10-23): An enabled settings capability starts a scoped monitoring conductor. Host collectors return normalized samples through contracts; the conductor marks stale values using an injected clock and fans out one snapshot stream. The monitoring override overlays the saved normal config; leaving it reads the latest normal snapshot. Foreground-window requests use one query lock and cache, separate from metric collection.

### Failure contract

Approved (Ramiro, 2026-10-23): use operation-specific catalog leaves, initially QUAKE.MONITOR.PERMISSION_DENIED, QUAKE.MONITOR.COLLECTION_FAILED and QUAKE.MONITOR.CONFIG_INVALID. Final code names must be reconciled with the shared catalog before implementation; never introduce a second catalog. Each leaf is a catalog-derived Schema.TaggedError with private original cause and bounded, scrubbed diagnostic projection. Consumers branch on tag/code, never text. Verify exact identity, cause retention, safe serialization and broken-dependency paths through real consumers.

## Recommended phase and dependencies

Later phases item 1, system monitor tiles, app monitor, and monitoring override. Implementation follows the profile/grid and display contracts.

Dependencies are contracts supplied by their owning changes. An unavailable dependency yields an explicit unavailable state; this change does not duplicate its implementation or modify its specs.

## Risks / Trade-offs

Platform collectors differ and app titles can reveal private information. Expose per-collector availability, minimize stored window data and keep raw titles/process details out of diagnostics.

The proposed package placement keeps current workspace boundaries but grows `packages/edge`; retain cohesive domain files and split a new package only when ownership or dependency constraints justify it. No npm dependency is selected here; future dependency proposals must name exact versions and approval needs.

## Migration plan

Create versioned local settings/repository records behind a capability gate. Validate imported shapes before writing and preserve the last valid snapshot on failure. Enable only the verified capability subset after its acceptance scenarios pass. Roll back by disabling the capability and retaining readable user records; destructive native side effects need their own recovery flow.

## Verification and outstanding evidence

Use a fake clock and controllable collectors to prove non-overlap, stale thresholds, disable-during-query and override restoration. Drive a settings save through the typed client to both actual tile consumers and assert obsolete collectors stop. Native collector availability and all device display behavior remain unverified until exercised on target hosts/hardware.

Implementation closure requires scenario evidence and synchronized Beads updates. See verification.md for software acceptance and remaining target-platform work. Do not launch DK-Suite; use independent fixtures and the open-quake application.

## Terminology correction

`MAIN-096` and `v0.4.95/app-resources/background.js`, `set-gaming-mode` / `isGamingMode`, establish that DK-Suite's "gaming mode" routes hotkeys through device keyboard command `0x10`. This change's reversible metric-selection/rate overlay is an open-quake "monitoring override". Its behavior stays unchanged and cannot switch host/device hotkey routing. Hardware-controls owns device-typed hotkeys.

## Implemented panel subset

`system-monitor-panel`, under open-quake-lih.8, implements the seven panel
modules using this change's availability and 0.2–10 Hz rate contract. See
`packages/edge/src/monitor` and `apps/desktop/src/main/monitor/README.md` for the
platform matrix. Approved GAP-MAP decisions 4/5 retain unavailable values and
1 Hz default. WIDGETS-075–077/080–083 provide updated 0.4.95 source evidence.
The 2026-10-26 extension below adds foreground monitoring and the override.
Bluetooth remains unsupported, without changing the strip layout. The panel's
native mock smoke cannot close physical hardware acceptance.

## Implementation decisions, 2026-10-26

The existing local `MonitorStore` remains the sole durable owner of monitoring
settings and panel media. The edge module owns normalized contracts, effective
configuration and a scoped `MonitoringService`; it doesn't introduce a second
settings file. Existing `monitor-v1` records decode with all metrics selected,
native collection, app monitoring off and an inactive CPU-only 1 Hz override.
Normal settings are preserved independently from the override. The master switch
gates both kinds of collection. An override never touches profiles or hotkeys.

One metric worker group serves all current consumers. The main-owned management
Live status and real panel can request collection; thumbnails and URL-spoofed
windows can't. A changed effective selection or rate stops old workers before
starting replacements. Editing normal settings under an unchanged override does
not restart workers. State subscriptions don't themselves create collectors.
Foreground monitoring is independently enabled, coalesces native reads through
the existing 500 ms probe cache, polls at 3 s on macOS and 2 s elsewhere, and has a
5 s query deadline. Disable and shutdown dispose its native helper, including
aborting a pending command. No titles or app history are retained.

The schema-first `monitoring.snapshot` RPC and validated push subscription carry
foreground identity only to the main-owned management document. The panel gets
metrics only. `packages/client/src/monitor.ts` validates subscription messages and
drops delivery after unsubscribe. Existing panel settings/media IPC is retained.
All errors use the canonical edge monitor catalog, re-exported by desktop.

Opus 5.5 designed the new controls and all new copy. The page separates the
labelled sample preview from Live status, then Readings, App monitor and Monitoring
override. All edits follow the existing Save/Revert flow. The master switch
disables dependent controls. Normal and override metrics wrap as labelled toggle
buttons. Uncollected panel modules say Off; unsupported collectors remain visible.
Live status isn't a live region because updates can reach 10 Hz. The foreground
row derives only an app display name from the transient app identity; it never
renders a full path or window id. The design artifact is local-only under
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-finish/monitoring-state/design/`.

### Collector availability

| Metric | macOS | Windows / Linux |
| --- | --- | --- |
| CPU utilization, memory | Node OS APIs | Node OS APIs |
| Disk, process-state counts, network counters, power | bounded native commands | unsupported |
| GPU load, CPU/GPU temperatures | unsupported | unsupported |
| Bluetooth | unsupported | unsupported |
| Foreground identity | bounded AppKit/CoreGraphics query | persistent user32 helper on Windows; xprop on X11 |

Bluetooth has an explicit unsupported identity in normalized state and management.
The existing panel keeps its seven-module layout. Missing metrics never become
synthetic zeroes. Linux without a usable X11 collector reports a failed foreground
query, rather than inventing an app. Windows session-0 absence is not proof of
interactive desktop identity. Target-host and physical acceptance stay separate.
