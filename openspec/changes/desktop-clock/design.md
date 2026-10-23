# Design

## Context

See proposal.md for the capability boundary. This is a spec-only proposal; every product choice below marked "Proposed (pending Ramiro)" awaits a decision. The delta spec records the recommended acceptance contract, not existing implementation or verified hardware parity.

Inventory: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, sections 7–9, Later phases and the cited open questions.

## Evidence and source paths

Path roots are local-only, read-only research inputs. S means recovered source for the stated behavior, P means partial analysis/dependency evidence, and N means name-only evidence. Source availability does not prove runtime or hardware success. Replacement limits and new failure behavior are proposed, not recovered facts.

- ATLAS = `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion`
- ART = `ATLAS/artifacts`
- RS = `ART/recovered_sources`

- **S** `RS/webpack:__dk-suite_src_utils_DefaultProfileData.js`: DEFAULT_DK_DESKTOP_CLOCK and hourFormat action.
- **S** `RS/webpack:__dk-suite_src_views_Components_dkDesktopClock.vue`: 24h default, 12h AM/PM conversion, minute/day scheduling and timer cleanup.

## Goals / Non-Goals

Goals: give implementers one owned contract, observable failure states and a verification path for this capability.

Non-goals: implementation in this lane, new dependencies, changes to other lanes' artifacts, guessed device opcodes, or claiming unresolved integrations work.

## Package ownership

`packages/edge` clock configuration and formatting invariants; `packages/client` clock settings contract; `apps/desktop` clock rendering and scheduling. Existing profile/display services own layout and delivery; `packages/protocol` and `packages/device` need no new command.

Proposed (pending Ramiro): keep domain modules in the existing packages rather than adding feature packages now. In `packages/edge`, each domain separates contracts, pure invariants, repository interfaces and an Effect.Service conductor. Electron-specific APIs live in `apps/desktop/src/main` adapters supplied at the composition root; renderers consume `packages/client` through a narrow typed preload bridge. `packages/protocol` stays pure; `packages/device` owns hardware I/O. `packages/cli` is an optional client, not another domain owner.

Native control contracts are Schema-first `@effect/rpc`; external third-party protocols stay boundary adapters. Services declare dependencies, use named `Effect.fn` methods with explicit success/error types and scoped cleanup. User/automation actions have one capability-registry declaration. UI never calls raw SDKs. AI calls, where needed, use the existing Vercel AI SDK Effect facade and mocked providers in CI.

## Decisions

1. Proposed (pending Ramiro): use host local time and system timezone with 24h as the default, matching the recovered component; remote timezone selection is deferred.

2. Proposed (pending Ramiro): share one clock schedule per visible desktop session and recompute from wall-clock time on resume, rather than accumulating elapsed ticks.

### Data model

Proposed (pending Ramiro): ClockConfig belongs to its profile key and contains hourFormat as 12h or 24h. ClockSnapshot contains host-local date, hour, minute and optional meridiem, computed from an injected instant and timezone.

### Data flow and lifecycle

Proposed (pending Ramiro): The profile owner persists configuration; pure clock invariants compute labels. Desktop owns one cancellable schedule for visible consumers and refreshes immediately after activation/resume/timezone changes. Panel and management render the same snapshot under the shared theme/motion contract.

### Failure contract

Proposed (pending Ramiro): use operation-specific catalog leaves, initially QUAKE.CLOCK.CONFIG_INVALID and QUAKE.CLOCK.SCHEDULE_FAILED. Final code names must be reconciled with the shared catalog before implementation; never introduce a second catalog. Each leaf is a catalog-derived Schema.TaggedError with private original cause and bounded, scrubbed diagnostic projection. Consumers branch on tag/code, never text. Verify exact identity, cause retention, safe serialization and broken-dependency paths through real consumers.

## Recommended phase and dependencies

Basic display clock is first-release cut item 3. The configurable DK-Desktop-Clock profile can ship alongside Later phases item 1, after display and profile foundations.

Dependencies are contracts supplied by their owning changes. An unavailable dependency yields an explicit unavailable state; this change does not duplicate its implementation or modify its specs.

## Risks / Trade-offs

Timers pause during sleep and DST changes invalidate accumulated ticks. Always recompute current wall-clock time; do not replay missed animations.

The proposed package placement keeps current workspace boundaries but grows `packages/edge`; retain cohesive domain files and split a new package only when ownership or dependency constraints justify it. No npm dependency is selected here; future dependency proposals must name exact versions and approval needs.

## Migration plan

Create versioned local settings/repository records behind a capability gate. Validate imported shapes before writing and preserve the last valid snapshot on failure. Enable only the verified capability subset after its acceptance scenarios pass. Roll back by disabling the capability and retaining readable user records; destructive native side effects need their own recovery flow.

## Verification and outstanding evidence

Exercise midnight, noon, minute/date rollover and a timezone change under an injected clock. Mount management and panel consumers, change the format through the profile API, and assert matching labels plus zero timers after teardown. Physical panel layout remains unverified.

Implementation closure requires scenario evidence and parent-managed Beads updates. The tasks in tasks.md remain unchecked in this design lane. Do not launch DK-Suite; use independent fixtures and the open-quake application for future verification.
