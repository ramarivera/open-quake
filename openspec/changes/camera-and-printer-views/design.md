# Design

## Context

See proposal.md for the capability boundary. This is a spec-only proposal; every product choice below marked "Proposed (pending Ramiro)" awaits a decision. The delta spec records the recommended acceptance contract, not existing implementation or verified hardware parity.

Inventory: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, sections 7–9, Later phases and the cited open questions.

## Evidence and source paths

Path roots are local-only, read-only research inputs. S means recovered source for the stated behavior, P means partial analysis/dependency evidence, and N means name-only evidence. Source availability does not prove runtime or hardware success. Replacement limits and new failure behavior are proposed, not recovered facts.

- ATLAS = `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion`
- ART = `ATLAS/artifacts`
- RS = `ART/recovered_sources`

- **S** `RS/webpack:__dk-suite_src_views_Components_CameraIconView.vue`: RTSP/proxy/MJPEG inputs, gateway-state gating, stream start/stop and camera-pan event.
- **S** `RS/webpack:__dk-suite_src_views_Components_CameraControlIconView.vue`: camera control UI establishes a control entry, not a proven device protocol.
- **S** `RS/webpack:__dk-suite_src_views_Components_PrinterStatusIconView.vue`: gateway running/ready, gcode state, percent, layers, temperatures and remaining time.
- **S** `RS/webpack:__dk-suite_src_utils_DefaultProfileData.js`: cameraView/cameraControlView/printerStatusView and rtspUrl configuration.
- **P** `ART/gateway_file.txt`: binary identification only; executable protocol unproven.
- **P** `ATLAS/DK_SUITE_INSIGHTS.md`: gateway/printer_3d_gateway is unpacked but not fully analyzed.

## Goals / Non-Goals

Goals: give implementers one owned contract, observable failure states and a verification path for this capability.

Non-goals: implementation in this lane, new dependencies, changes to other lanes' artifacts, guessed device opcodes, or claiming unresolved integrations work.

## Package ownership

`packages/edge` camera/printer contracts, gateway repository interface and feed conductors; `packages/client` typed status/frame APIs; `apps/desktop` local gateway process adapter and panel renderers. Existing display services deliver composed output; protocol/device packages gain no guessed opcodes.

Proposed (pending Ramiro): keep domain modules in the existing packages rather than adding feature packages now. In `packages/edge`, each domain separates contracts, pure invariants, repository interfaces and an Effect.Service conductor. Electron-specific APIs live in `apps/desktop/src/main` adapters supplied at the composition root; renderers consume `packages/client` through a narrow typed preload bridge. `packages/protocol` stays pure; `packages/device` owns hardware I/O. `packages/cli` is an optional client, not another domain owner.

Native control contracts are Schema-first `@effect/rpc`; external third-party protocols stay boundary adapters. Services declare dependencies, use named `Effect.fn` methods with explicit success/error types and scoped cleanup. User/automation actions have one capability-registry declaration. UI never calls raw SDKs. AI calls, where needed, use the existing Vercel AI SDK Effect facade and mocked providers in CI.

## Decisions

1. Proposed (pending Ramiro): question 5 blocks a production gateway adapter. Record start/stop, readiness, framing, auth and shutdown fixtures before enabling it; never run the opaque binary merely to display placeholders.

2. Proposed (pending Ramiro): begin with read-only printer telemetry and camera frames. Pan/tilt remains unavailable unless an adapter advertises a verified control contract.

3. Proposed (pending Ramiro): bound streams to one in-flight frame and 10 fps maximum; mark printer status stale after ten seconds without a valid sample. These are replacement budgets.

### Data model

Proposed (pending Ramiro): GatewayState separates stopped/starting/ready/failed. CameraConfig stores endpoint/credential references and adapter ID; Frame carries sequence, timestamp and bounded decoded image. PrinterSnapshot stores timestamp, normalized state and optional progress/layers/temperatures/remaining/job fields, keeping absent values distinct from zero.

### Data flow and lifecycle

Proposed (pending Ramiro): A verified gateway adapter owns process readiness, feed subscriptions and shutdown. Feed conductors translate adapter payloads into client contracts; desktop panel renderers consume only normalized frames/status. Subscribers acquire/release streams by active view. Backpressure drops obsolete camera frames; clock-based health marks printer snapshots stale.

### Failure contract

Proposed (pending Ramiro): use operation-specific catalog leaves, initially QUAKE.GATEWAY.UNVERIFIED, QUAKE.GATEWAY.START_FAILED, QUAKE.CAMERA.STREAM_FAILED, QUAKE.CAMERA.CONTROL_UNSUPPORTED and QUAKE.PRINTER.STATUS_INVALID. Final code names must be reconciled with the shared catalog before implementation; never introduce a second catalog. Each leaf is a catalog-derived Schema.TaggedError with private original cause and bounded, scrubbed diagnostic projection. Consumers branch on tag/code, never text. Verify exact identity, cause retention, safe serialization and broken-dependency paths through real consumers.

## Recommended phase and dependencies

Later phases item 7, camera RTSP and printer status views, after gateway binary analysis. Mock-driven UI work can precede protocol recovery but cannot satisfy hardware parity.

Dependencies are contracts supplied by their owning changes. An unavailable dependency yields an explicit unavailable state; this change does not duplicate its implementation or modify its specs.

## Risks / Trade-offs

An opaque gateway can outlive its UI and stream indefinitely. Never launch an unverified adapter; bind process lifetime to explicit ownership and last subscription.

The proposed package placement keeps current workspace boundaries but grows `packages/edge`; retain cohesive domain files and split a new package only when ownership or dependency constraints justify it. No npm dependency is selected here; future dependency proposals must name exact versions and approval needs.

## Migration plan

Create versioned local settings/repository records behind a capability gate. Validate imported shapes before writing and preserve the last valid snapshot on failure. Enable only the verified capability subset after its acceptance scenarios pass. Roll back by disabling the capability and retaining readable user records; destructive native side effects need their own recovery flow.

## Verification and outstanding evidence

Use fake gateway readiness/frame/status events to exercise actual camera/printer tiles, 10 fps/latest-frame bounds, staleness, profile teardown and late-event rejection. Question 5 requires a recorded executable protocol contract before real gateway tests. RTSP playback, pan/tilt, printer devices and physical QUAKE output remain unverified.

Implementation closure requires scenario evidence and parent-managed Beads updates. The tasks in tasks.md remain unchecked in this design lane. Do not launch DK-Suite; use independent fixtures and the open-quake application for future verification.
