# Design

## Context

See proposal.md for the capability boundary. This is a spec-only proposal; every product choice below marked "Approved (Ramiro, 2026-10-23)" was accepted by Ramiro on that date. The delta spec records the recommended acceptance contract, not existing implementation or verified hardware parity.

Inventory: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, sections 7–9, Later phases and the cited open questions.

## Evidence and source paths

Path roots are local-only, read-only research inputs. S means recovered source for the stated behavior, P means partial analysis/dependency evidence, and N means name-only evidence. Source availability does not prove runtime or hardware success. Replacement limits and new failure behavior are proposed, not recovered facts.

- ATLAS = `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion`
- ART = `ATLAS/artifacts`
- RS = `ART/recovered_sources`

- **S** `RS/webpack:__dk-suite_src_views_AIAssistant_MeetingMinutesRecorder.vue`: meeting-minutes-start, mic/system audio streams, Opus MediaRecorder chunks, stop/finalization and device-change cleanup.
- **S** `RS/webpack:__dk-suite_src_views_Setting_MeetingMinutesHistory.vue`: history, transcription/minutes display, retry/delete and copy behavior.
- **P** `RS/webpack:__dk-suite_src_main_ai_AIManager.js`: meeting transcription adapter orchestration; `_markdownToDoc` proves generic Markdown-to-DOCX conversion, not an integrated meeting-history export action.
- **N** `ART/ipc_channels.txt`: generate-meeting-minutes and meeting-minutes-start entry names.
- **S** `RS/webpack:__dk-suite_src_plugins_KeyConfiguration.js`: liveAudioTranslate and liveAudioTranslateDisplay menu entries are commented out; this does not establish a supported translation workflow.
- **N** `ART/store_keys.txt`: aiData.meetingMinutes persistence name; DOCX library presence is not an export integration test.
- **P** `ART/package.json`: html-docx-js dependency supports inventory export claim but not a proven history-page export action.

## Goals / Non-Goals

Goals: give implementers one owned contract, observable failure states and a verification path for this capability.

Non-goals: implementation in this lane, new dependencies, changes to other lanes' artifacts, guessed device opcodes, or claiming unresolved integrations work.

## Package ownership

`packages/edge` meeting contracts, repository, lifecycle invariants and conductor; `packages/client` typed meeting API; `apps/desktop` capture/permission, local files, export adapters and history/capture UI. AI/speech lanes own provider facades; panel animation consumes meeting state through existing display delivery.

Approved (Ramiro, 2026-10-23): keep domain modules in the existing packages rather than adding feature packages now. In `packages/edge`, each domain separates contracts, pure invariants, repository interfaces and an Effect.Service conductor. Electron-specific APIs live in `apps/desktop/src/main` adapters supplied at the composition root; renderers consume `packages/client` through a narrow typed preload bridge. `packages/protocol` stays pure; `packages/device` owns hardware I/O. `packages/cli` is an optional client, not another domain owner.

Native control contracts are Schema-first `@effect/rpc`; external third-party protocols stay boundary adapters. Services declare dependencies, use named `Effect.fn` methods with explicit success/error types and scoped cleanup. User/automation actions have one capability-registry declaration. UI never calls raw SDKs. AI calls, where needed, use the existing Vercel AI SDK Effect facade and mocked providers in CI.

## Decisions

1. Approved (Ramiro, 2026-10-23): one user-visible capture session at a time. Microphone is required; system audio is optional and requires an explicit choice of available source.

2. Approved (Ramiro, 2026-10-23): preserve transcript when summarization fails, and retry only the failed stage. Provider output is labeled generated and is editable/exportable without being represented as a verbatim transcript.

3. Approved (Ramiro, 2026-10-23): question 11, liveAudioTranslate, stays deferred. A commented-out menu and name evidence do not justify continuous translation capture in this recorder.

4. Approved (Ramiro, 2026-10-23): keep finalized recordings locally until the user deletes the meeting; partial buffers are removed after cancel. DOCX conversion library choice waits for output fixture evaluation.

### Data model

Approved (Ramiro, 2026-10-23): MeetingRecord carries stable ID, title, timestamps/duration, capture source metadata, stage state, local audio/transcript/minutes resource references and failure stage. A session generation identifies callbacks; finalized chunks have ordered unique IDs. Generated minutes carry provider/model provenance distinct from transcript text.

### Data flow and lifecycle

Approved (Ramiro, 2026-10-23): Explicit start acquires selected capture sources in desktop adapters; the meeting conductor owns the lifecycle. Stop closes tracks and finalizes chunks once, then speech and AI facades process stages. The repository commits transcript before generation. Retry restarts only a failed stage. History and panel status use the same meeting state, while export reads a selected saved artifact and writes a user-selected file.

### Failure contract

Approved (Ramiro, 2026-10-23): use operation-specific catalog leaves, initially QUAKE.MEETING.CAPTURE_DENIED, QUAKE.MEETING.SOURCE_LOST, QUAKE.MEETING.TRANSCRIPTION_FAILED, QUAKE.MEETING.GENERATION_FAILED and QUAKE.MEETING.EXPORT_FAILED. Final code names must be reconciled with the shared catalog before implementation; never introduce a second catalog. Each leaf is a catalog-derived Schema.TaggedError with private original cause and bounded, scrubbed diagnostic projection. Consumers branch on tag/code, never text. Verify exact identity, cause retention, safe serialization and broken-dependency paths through real consumers.

## Recommended phase and dependencies

Later phases item 3, soundboard/DK-Player and meeting minutes, after speech and chat provider interfaces. Physical trigger parity still requires device verification.

Dependencies are contracts supplied by their owning changes. An unavailable dependency yields an explicit unavailable state; this change does not duplicate its implementation or modify its specs.

## Risks / Trade-offs

Audio acquisition differs per OS and recording is sensitive. Require explicit source selection, release tracks on every terminal path, and keep content out of logs. The history source does not prove an integrated DOCX button; export is proposed from inventory/dependency evidence.

The proposed package placement keeps current workspace boundaries but grows `packages/edge`; retain cohesive domain files and split a new package only when ownership or dependency constraints justify it. No npm dependency is selected here; future dependency proposals must name exact versions and approval needs.

## Migration plan

Create versioned local settings/repository records behind a capability gate. Validate imported shapes before writing and preserve the last valid snapshot on failure. Enable only the verified capability subset after its acceptance scenarios pass. Roll back by disabling the capability and retaining readable user records; destructive native side effects need their own recovery flow.

## Verification and outstanding evidence

With fake capture/provider/file adapters, drive the real recorder and history consumers through duplicate stop, source removal, summary failure, retry, restart and delete. Open a generated DOCX fixture with an independent DOCX reader to confirm title/text/escaping. Native system-audio capture, paid providers and physical start triggers remain unverified.

Implementation closure requires scenario evidence and parent-managed Beads updates. The tasks in tasks.md remain unchecked in this design lane. Do not launch DK-Suite; use independent fixtures and the open-quake application for future verification.
