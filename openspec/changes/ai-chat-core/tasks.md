# Tasks

Contracts and durable normal-mode history are implemented; the remaining integration and acceptance items are listed below. Depends on ai-provider-facade and the shared localization/panel contracts. The parent creates one child Beads issue per checkbox.

## 1. First-release session and stream contracts

- [ ] 1.1 Record decisions on v1 events, concurrency, deadlines, idle retention, repository format, and window staging; verify updated artifacts with `openspec validate ai-chat-core --strict` and document approved/deferred choices.
- [x] 1.2 Implement Schema contracts and pure chunk/session reducers; verify identity isolation, contiguous seq, suggestion separation, exactly one terminal, duplicate/gap recovery, and cancellation at each state with unit/property tests, and document protocol v1.
- [ ] 1.3 Implement ChatService deadlines, profile snapshots, and bounded fan-out; verify real mock-provider dispatch, 60s/300s boundaries, one-turn busy, late-delta suppression, and slow-subscriber snapshot restoration using a fake clock and real client, and document subscription recovery.

## 2. First-release history and presentation, macOS

- [x] 2.1 Implement local versioned history and context budgeting; verify atomic finalization, restart interruption, deletion races, whole-exchange pruning, over-budget rejection, and usage provenance through the next real outbound request, and document retention/export behavior.
- [ ] 2.2 Wire Schema-first RPC/preload clients to management and panel chat; verify shared assembled content, inert HTML/file/command handling, user-gesture links, preserved scroll position, and closed-window cleanup, and document the no-hardware demo procedure.
- [ ] 2.3 Consume the shared General Translation infrastructure with bundled en/de chat strings and local fallback title/rename; verify offline locale switching, missing-key fallback, unchanged user text/provider selection, and stale title callbacks, and document localization ownership.
- [ ] 2.4 Exercise the full macOS mock-provider chat path and physical panel when available; capture stream/cancel/history/locale evidence, label synthetic versus hardware observations, and leave hardware acceptance open until it is actually run.

## 3. Day 2 and later assistant additions

- [ ] 3.1 Exercise Linux windows, stream cleanup, local persistence, and locale behavior with the same contract suite; document platform gaps and retain failed acceptance items as open work.
- [ ] 3.2 Add the optional floating assistant and optional generated-title job after approval; verify display-bound restoration, closed-window chat/capture, rename/delete races, and title-failure isolation, and document the opt-in behavior.

Parent integration evidence, 2026-10-25: direct provider SDK, durable normal
ChatService and protected desktop model selection are wired through the real
Effect RPC/preload and management React UI. Synthetic Electron acceptance
covers continuation, physical socket cancellation, provider failure,
rename/deletion, inert generated markup and privacy-safe correlated diagnostics;
Actual 1180px and 390px viewport assertions pass via Electron device emulation. Rerun `src/main/test/direct-chat-smoke.ts` using the build and launch procedure in `packages/edge/src/chat/README.md`; it writes `chat-1180.png`, `chat-390.png` and `result.json` beneath the supplied external `OPEN_QUAKE_E2E_SCRATCH` directory. These are synthetic viewport observations, not physical device captures.
Direct strip text and finalized transcripts share the service, with regression
coverage for cancellation reentry and external-runtime fallback source identity.
Task 2.1 is verified by real SDK/service/repository and outbound continuation
checks. Tasks 1.3, 2.2 and 2.3 remain open for enabled long-mode acceptance,
fully shared management/panel presentation and General Translation integration.
No physical microphone, audible playback or hardware acceptance is inferred.

Offline locale infrastructure, 2026-10-25: shared SettingsService, encoded
RPC/preload, private versioned persistence and bundled General Translation
provider are implemented. Focused tests prove saved-choice preservation, failed
writes, corruption/restart, foreign-frame rejection and offline translated/source
fallback output. Actual production Electron root/preload/React updates both
windows without document reload using mock hardware and a local provider. Final
Opus-owned chat copy/control integration and its rendered acceptance remain open,
so task 2.3 remains unchecked.


Preload error identity correction, 2026-10-26, open-quake-ca2: direct-chat
unary failures and locale failures now reject with plain objects because
Electron contextBridge strips custom fields from Error subclasses. Chat
accepts only catalog codes from ChatErrors/AiErrors and uses their canonical
messages. Locale validates SettingsFailure before projecting its tag, code
and canonical message. Neither exposes diagnostics, causes, provider text or
transport details. Transport and unknown chat failures use fixed unavailable
projections. Six new regressions cover plain-object identity, canonical copy,
unknown codes and transport failure, with five original cases failing before
the fix. The real hidden production-root contextBridge read now retains
QUAKE.SETTINGS.READ_FAILED / SettingsReadFailed and
CHAT.HISTORY.STORAGE_FAILED / ChatRpcFailure in the renderer. Four corrupt
feature files stay byte-identical, maintenance remains usable and normal quit
completes. Evidence is error-identity-{baseline,fixed,types,build,native}.log
under the external open-quake-finish/service-graph scratch directory.
This addresses the failure boundary within 2.2/2.3; their broader unchecked
acceptance requirements remain open. No physical device, microphone, live
provider or OS preference mutation was used.
