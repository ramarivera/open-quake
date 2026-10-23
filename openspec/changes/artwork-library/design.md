# Design

## Context

See proposal.md for the capability boundary. This is a spec-only proposal; every product choice below marked "Approved (Ramiro, 2026-10-23)" was accepted by Ramiro on that date. The delta spec records the recommended acceptance contract, not existing implementation or verified hardware parity.

Inventory: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, sections 7–9, Later phases and the cited open questions.

## Evidence and source paths

Path roots are local-only, read-only research inputs. S means recovered source for the stated behavior, P means partial analysis/dependency evidence, and N means name-only evidence. Source availability does not prove runtime or hardware success. Replacement limits and new failure behavior are proposed, not recovered facts.

- ATLAS = `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion`
- ART = `ATLAS/artifacts`
- RS = `ART/recovered_sources`

- **S** `RS/webpack:__dk-suite_src_views_IconSelect_IconSelectContent.vue`: built-in/app/custom groups, local imports, key target selection and lazy MDI loading.
- **S** `RS/webpack:__dk-suite_src_views_ManagementCenter_TemplatePicsPanel.vue`: multi-file import, duplicate-name detection and template resource registration.
- **S** `RS/webpack:__dk-suite_src_views_ManagementCenter_TemplateUnit.vue`: template selection and removal entry points.
- **S** `RS/webpack:__dk-suite_src_views_Components_LibraryPanel.vue`: key-function/plugin/EmojiCustomLib entries; action catalog belongs to the profile lane.
- **N** `ART/ipc_channels.txt`: emoji-package-changed establishes notification name only.
- **P** `ATLAS/DK_SUITE_INSIGHTS.md`: 0xA2 image payload and key-code mapping need device validation.

## Goals / Non-Goals

Goals: give implementers one owned contract, observable failure states and a verification path for this capability.

Non-goals: implementation in this lane, new dependencies, changes to other lanes' artifacts, guessed device opcodes, or claiming unresolved integrations work.

## Package ownership

`packages/edge` artwork contracts, metadata repository and validation conductor; `packages/client` typed library API; `apps/desktop` file import/preview adapters, icon picker and templates UI. Profile and wallpaper services consume resource IDs; `packages/device` owns delivery and `packages/protocol` pure framing, with no new payload inference here.

Approved (Ramiro, 2026-10-23): keep domain modules in the existing packages rather than adding feature packages now. In `packages/edge`, each domain separates contracts, pure invariants, repository interfaces and an Effect.Service conductor. Electron-specific APIs live in `apps/desktop/src/main` adapters supplied at the composition root; renderers consume `packages/client` through a narrow typed preload bridge. `packages/protocol` stays pure; `packages/device` owns hardware I/O. `packages/cli` is an optional client, not another domain owner.

Native control contracts are Schema-first `@effect/rpc`; external third-party protocols stay boundary adapters. Services declare dependencies, use named `Effect.fn` methods with explicit success/error types and scoped cleanup. User/automation actions have one capability-registry declaration. UI never calls raw SDKs. AI calls, where needed, use the existing Vercel AI SDK Effect facade and mocked providers in CI.

## Decisions

1. Approved (Ramiro, 2026-10-23): question 13 remains open. Emoji package notification is not evidence that generated output is a ready-to-send 0xA2 resource. Persist a local image reference; no physical-send claim until the display/protocol lane proves its conversion.

2. Approved (Ramiro, 2026-10-23): initial local imports accept decoded PNG/JPEG and sanitized static SVG; cap files at 20 MiB and raster dimensions at 8192 per axis. These are replacement limits, not recovered constants.

3. Approved (Ramiro, 2026-10-23): built-in metadata is immutable; imported artwork is copied to application storage and addressed by stable ID. Referenced resources require replacement/unlink before deletion.

### Data model

Approved (Ramiro, 2026-10-23): ArtworkRecord stores stable ID, kind, name, provenance, managed file reference, checksum and validated dimensions/type. Built-in references are immutable. Assignment lives in profile/wallpaper configuration and stores artwork ID, while delivery status belongs to the display owner.

### Data flow and lifecycle

Approved (Ramiro, 2026-10-23): Desktop selects files; an artwork conductor validates/decode-checks, sanitizes SVG, copies accepted files to managed storage and commits metadata only after a successful copy. Batch results report each item. The picker returns the selected ID and explicit target identity to its owner. Deletion checks references before removing metadata/file. Emoji generation can register an image through this same import contract but cannot declare transport completion.

### Failure contract

Approved (Ramiro, 2026-10-23): use operation-specific catalog leaves, initially QUAKE.ARTWORK.INVALID, QUAKE.ARTWORK.LIMIT_EXCEEDED, QUAKE.ARTWORK.NAME_CONFLICT, QUAKE.ARTWORK.IN_USE and QUAKE.ARTWORK.FILE_FAILED. Final code names must be reconciled with the shared catalog before implementation; never introduce a second catalog. Each leaf is a catalog-derived Schema.TaggedError with private original cause and bounded, scrubbed diagnostic projection. Consumers branch on tag/code, never text. Verify exact identity, cause retention, safe serialization and broken-dependency paths through real consumers.

## Recommended phase and dependencies

Basic icon selection supports first-release cut items 2–3. Template/emoji library breadth is Later phases item 3; physical delivery depends on the separate resource payload investigation.

Dependencies are contracts supplied by their owning changes. An unavailable dependency yields an explicit unavailable state; this change does not duplicate its implementation or modify its specs.

## Risks / Trade-offs

Untrusted vector files may load external data and imported file names can collide. Decode/sanitize in the adapter, store under generated IDs and keep display-delivery status separate from local persistence.

The proposed package placement keeps current workspace boundaries but grows `packages/edge`; retain cohesive domain files and split a new package only when ownership or dependency constraints justify it. No npm dependency is selected here; future dependency proposals must name exact versions and approval needs.

## Migration plan

Create versioned local settings/repository records behind a capability gate. Validate imported shapes before writing and preserve the last valid snapshot on failure. Enable only the verified capability subset after its acceptance scenarios pass. Roll back by disabling the capability and retaining readable user records; destructive native side effects need their own recovery flow.

## Verification and outstanding evidence

Drive actual picker/template consumers through imports, unsafe SVG, limit cases, duplicate names, partial batch failure and stale target selection. Assert managed copies survive moving originals and referenced deletion fails. Physical 0xA2 delivery and emoji packaging, question 13, remain unverified and belong to display/emoji owners.

Implementation closure requires scenario evidence and parent-managed Beads updates. The tasks in tasks.md remain unchecked in this design lane. Do not launch DK-Suite; use independent fixtures and the open-quake application for future verification.
