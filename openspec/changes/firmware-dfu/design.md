# Design

## Context

See proposal.md for the capability boundary. This is a spec-only proposal; every product choice below marked "Approved (Ramiro, 2026-10-23)" was accepted by Ramiro on that date. The delta spec records the recommended acceptance contract, not existing implementation or verified hardware parity.

Inventory: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, sections 7–9, Later phases and the cited open questions.

## Evidence and source paths

Path roots are local-only, read-only research inputs. S means recovered source for the stated behavior, P means partial analysis/dependency evidence, and N means name-only evidence. Source availability does not prove runtime or hardware success. Replacement limits and new failure behavior are proposed, not recovered facts.

- ATLAS = `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion`
- ART = `ATLAS/artifacts`
- RS = `ART/recovered_sources`

- **S** `ATLAS/SUBAGENT_PROTOCOL_ANALYSIS.md`: observed DFU opCode 0x01, cmdID 0x2F, subData 0x03 and report/checksum structure.
- **P** `ATLAS/SUBAGENT_FIRMWARE_ANALYSIS.md`: 1480 UF2 blocks, RP2040 family 0x1aa143c7 and nonstandard first magic byte variant.
- **S** `RS/webpack:__dk-suite_src_views_Setting_DeviceSettings.vue`: enter-download-mode and target selection UI.
- **S** `RS/webpack:__dk-suite_src_views_Components_UpgradeInfoDialog.vue`: upgrade information presentation; firmware write flow still needs verification.
- **N** `ART/store_keys.txt`: system.firmware.dfuVolumeBookmark and system.upgradeInfo.

## Goals / Non-Goals

Goals: give implementers one owned contract, observable failure states and a verification path for this capability.

Non-goals: implementation in this lane, new dependencies, changes to other lanes' artifacts, guessed device opcodes, or claiming unresolved integrations work.

## Package ownership

`packages/protocol` pure DFU encoding and UF2 validation; `packages/device` selected-device DFU lifecycle; `packages/edge` firmware workflow and catalog errors; `packages/client` typed update API; `apps/desktop` file/volume/bookmark adapters and update UI. `packages/cli` can reuse explicit inspect/DFU actions without owning flash logic.

Approved (Ramiro, 2026-10-23): keep domain modules in the existing packages rather than adding feature packages now. In `packages/edge`, each domain separates contracts, pure invariants, repository interfaces and an Effect.Service conductor. Electron-specific APIs live in `apps/desktop/src/main` adapters supplied at the composition root; renderers consume `packages/client` through a narrow typed preload bridge. `packages/protocol` stays pure; `packages/device` owns hardware I/O. `packages/cli` is an optional client, not another domain owner.

Native control contracts are Schema-first `@effect/rpc`; external third-party protocols stay boundary adapters. Services declare dependencies, use named `Effect.fn` methods with explicit success/error types and scoped cleanup. User/automation actions have one capability-registry declaration. UI never calls raw SDKs. AI calls, where needed, use the existing Vercel AI SDK Effect facade and mocked providers in CI.

## Decisions

1. Approved (Ramiro, 2026-10-23): never write firmware automatically. User selects image and boot volume, reviews decoded target/size and explicitly starts the update. The raw research image is not bundled by this change.

2. Approved (Ramiro, 2026-10-23): accept standard RP2040 UF2 by default; support the recovered first-header UF2 newline variant only through a narrowly tested compatibility mode, not a permissive magic check.

3. Approved (Ramiro, 2026-10-23): retain bookmark as a hint, re-resolve and validate the boot volume every time, and require explicit selection if multiple candidates exist.

4. Approved (Ramiro, 2026-10-23): define success as reconnected selected device with verified expected firmware identity; otherwise report written/unverified or needs-recovery. A copied file or vanished volume is insufficient.

### Data model

Approved (Ramiro, 2026-10-23): FirmwareImageInfo carries validated block metadata, family, bounded target ranges, content fingerprint and optional expected firmware identity. UpdateSession binds selected device identity, image fingerprint, chosen volume identity and terminal/interrupted state. The image itself and OS volume bookmark remain outside public status.

### Data flow and lifecycle

Approved (Ramiro, 2026-10-23): Pure protocol functions validate UF2 and encode the known short-command intent through the SDK framing contract. The device service serializes DFU with other hardware work and pauses conflicting writes. The firmware conductor waits for a selected verified boot volume, revalidates it, obtains final explicit write confirmation and invokes the filesystem adapter. Reconnect verification matches the intended target and expected firmware identity before completed status.

### Failure contract

Approved (Ramiro, 2026-10-23): use operation-specific catalog leaves, initially QUAKE.FIRMWARE.IMAGE_INVALID, QUAKE.FIRMWARE.TARGET_MISMATCH, QUAKE.FIRMWARE.VOLUME_INVALID, QUAKE.FIRMWARE.WRITE_FAILED and QUAKE.FIRMWARE.VERIFICATION_FAILED. Final code names must be reconciled with the shared catalog before implementation; never introduce a second catalog. Each leaf is a catalog-derived Schema.TaggedError with private original cause and bounded, scrubbed diagnostic projection. Consumers branch on tag/code, never text. Verify exact identity, cause retention, safe serialization and broken-dependency paths through real consumers.

## Recommended phase and dependencies

Raw DFU entry supports first-release protocol cut item 1 after hardware validation. Full flashing UX is Later phases item 8 and must not block the local first release.

Dependencies are contracts supplied by their owning changes. An unavailable dependency yields an explicit unavailable state; this change does not duplicate its implementation or modify its specs.

## Risks / Trade-offs

RP2040 family ID does not alone prove QUAKE-compatible board/pin layout; require a trusted QUAKE image provenance/target descriptor and declared writable flash range before write enablement. UF2 metadata is partial evidence, and the known header variant must not relax other checks.

The proposed package placement keeps current workspace boundaries but grows `packages/edge`; retain cohesive domain files and split a new package only when ownership or dependency constraints justify it. No npm dependency is selected here; future dependency proposals must name exact versions and approval needs.

## Migration plan

Create versioned local settings/repository records behind a capability gate. Validate imported shapes before writing and preserve the last valid snapshot on failure. Enable only the verified capability subset after its acceptance scenarios pass. Roll back by disabling the capability and retaining readable user records; destructive native side effects need their own recovery flow.

## Verification and outstanding evidence

Use independently generated UF2 fixtures for magic/family/block/address failures and the narrow newline variant. Drive the real update dialog/client through fake HID, volumes, copy and reconnect events; assert cancel writes nothing and copy alone never completes. Validate exact outgoing DFU report bytes against the SDK contract. DFU timing, BOOTSEL volume identity, flashing and version readback remain hardware-unverified.

Implementation closure requires scenario evidence and parent-managed Beads updates. The tasks in tasks.md remain unchecked in this design lane. Do not launch DK-Suite; use independent fixtures and the open-quake application for future verification.
