# Design

## Context

See proposal.md for the capability boundary. This is a spec-only proposal; every product choice below marked "Proposed (pending Ramiro)" awaits a decision. The delta spec records the recommended acceptance contract, not existing implementation or verified hardware parity.

Inventory: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, sections 7–9, Later phases and the cited open questions.

## Evidence and source paths

Path roots are local-only, read-only research inputs. S means recovered source for the stated behavior, P means partial analysis/dependency evidence, and N means name-only evidence. Source availability does not prove runtime or hardware success. Replacement limits and new failure behavior are proposed, not recovered facts.

- ATLAS = `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion`
- ART = `ATLAS/artifacts`
- RS = `ART/recovered_sources`

- **S** `RS/webpack:__dk-suite_src_plugins_hotKeyFun.js`: start-record-hotkey, hotkey-recorded, stop-record-hotkey focus/blur lifecycle and UiohookKey mapping.
- **P** `ART/package.json`: uiohook-napi, @nut-tree/nut-js, active-win and clipboard dependencies establish libraries, not complete automation semantics.

## Goals / Non-Goals

Goals: give implementers one owned contract, observable failure states and a verification path for this capability.

Non-goals: implementation in this lane, new dependencies, changes to other lanes' artifacts, guessed device opcodes, or claiming unresolved integrations work.

## Package ownership

`packages/edge` host-input contracts, chord invariants, capability registry and conductor; `packages/client` typed requests/events; `apps/desktop` main-process keyboard, clipboard and permission adapters plus recorder UI. `packages/cli` may consume explicit actions; protocol/device packages do not capture host keys.

Proposed (pending Ramiro): keep domain modules in the existing packages rather than adding feature packages now. In `packages/edge`, each domain separates contracts, pure invariants, repository interfaces and an Effect.Service conductor. Electron-specific APIs live in `apps/desktop/src/main` adapters supplied at the composition root; renderers consume `packages/client` through a narrow typed preload bridge. `packages/protocol` stays pure; `packages/device` owns hardware I/O. `packages/cli` is an optional client, not another domain owner.

Native control contracts are Schema-first `@effect/rpc`; external third-party protocols stay boundary adapters. Services declare dependencies, use named `Effect.fn` methods with explicit success/error types and scoped cleanup. User/automation actions have one capability-registry declaration. UI never calls raw SDKs. AI calls, where needed, use the existing Vercel AI SDK Effect facade and mocked providers in CI.

## Decisions

1. Proposed (pending Ramiro): input recording is active only while its field owns focus; all global bindings are explicit opt-ins and conflicting registrations fail without replacing OS shortcuts.

2. Proposed (pending Ramiro): selected text is read on an explicit action only, through a platform adapter; clipboard restoration occurs only if no intervening clipboard update happened.

3. Proposed (pending Ramiro): this change owns host mechanisms. Profile hotkey actions, translation triggers and bot authorization consume them through their existing capability contracts.

### Data model

Proposed (pending Ramiro): Chord stores a canonical modifier set and physical key identity; platform translation happens at the adapter boundary. RecorderSession has an owner window/field ID and recording/closed state. Binding has capability ID and enabled/available state. SelectionResult distinguishes selected text, empty selection, unsupported and denied.

### Data flow and lifecycle

Proposed (pending Ramiro): A renderer requests a focused recorder through the typed bridge; the conductor acquires a scoped native hook, normalizes chords and emits recorder-only events. Explicit global bindings and host actions pass through the capability registry. Selected-text extraction may use a scoped temporary clipboard snapshot, with conditional restoration after checking for intervening changes.

### Failure contract

Proposed (pending Ramiro): use operation-specific catalog leaves, initially QUAKE.INPUT.PERMISSION_DENIED, QUAKE.INPUT.BINDING_CONFLICT, QUAKE.INPUT.UNSUPPORTED and QUAKE.INPUT.CAPTURE_FAILED. Final code names must be reconciled with the shared catalog before implementation; never introduce a second catalog. Each leaf is a catalog-derived Schema.TaggedError with private original cause and bounded, scrubbed diagnostic projection. Consumers branch on tag/code, never text. Verify exact identity, cause retention, safe serialization and broken-dependency paths through real consumers.

## Recommended phase and dependencies

Supporting infrastructure for first-release cut item 2 hotkey keys and Later phases item 2 PC-operation and key-config bots. Advanced automation remains with its owning lane.

Dependencies are contracts supplied by their owning changes. An unavailable dependency yields an explicit unavailable state; this change does not duplicate its implementation or modify its specs.

## Risks / Trade-offs

Global hooks can leak input or persist after a window closes. Scope ownership to session/window, register no ambient text logging, and release hooks on every terminal path.

The proposed package placement keeps current workspace boundaries but grows `packages/edge`; retain cohesive domain files and split a new package only when ownership or dependency constraints justify it. No npm dependency is selected here; future dependency proposals must name exact versions and approval needs.

## Migration plan

Create versioned local settings/repository records behind a capability gate. Validate imported shapes before writing and preserve the last valid snapshot on failure. Enable only the verified capability subset after its acceptance scenarios pass. Roll back by disabling the capability and retaining readable user records; destructive native side effects need their own recovery flow.

## Verification and outstanding evidence

Use hook and clipboard fakes for blur cleanup, held-key de-duplication, conflict rollback and concurrent clipboard edits. Drive the real focused field and an authorized profile action through the client to adapter calls; prove recording never invokes execution. Native OS permission prompts, selection mechanics and device triggers remain unverified.

Implementation closure requires scenario evidence and parent-managed Beads updates. The tasks in tasks.md remain unchecked in this design lane. Do not launch DK-Suite; use independent fixtures and the open-quake application for future verification.
