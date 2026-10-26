# Tasks

Execution is tracked by open-quake-def under open-quake-lih.14. Section 5 is the settings-firmware lane. Settings contracts, general adapters and local setup are delivered; selected-device settings, provider sampling controls and broader acceptance remain open. Source and automated evidence are recorded below. Parent clusters retain their remaining acceptance requirements.

## 1. Scope and persistent contracts

- [x] 1.1 Record Ramiro's decision on question 8, the QUAKE calibration gate, wizard ordering, locale/provider seeding and question 11 deferral; verify design/spec/tasks remain coherent and section 10 has only the design note.
- [x] 1.2 Add versioned settings/wizard schemas, validation/migration invariants and repository documentation; verify atomic completion failure, unknown-field preservation and user choices surviving reseed.

  Backend implementation is in `packages/edge/src/settings/`, reusing the canonical locale repository and `settings-v1.json`. General/wizard sections migrate additively, retain unknown fields and reject inconsistent completion markers. `onboarding.test.ts` covers shared commits, failed completion, restart/replay, preserved provider choices, owner failure and both cancellation boundaries. Root composition and actual wizard controls were integrated in reviewed PR49/50; the delivery reconciliation below closes this task.

## 2. Settings owners and host adapters

- [x] 2.1 Implement general OS preference/window adapters and protected provider secret references with catalog errors; verify login/start-hidden separation, unreachable-window correction, denied OS writes and secret-free serialization.

  Backend implementation is in `general-service.ts` and `apps/desktop/src/main/settings/os-adapter.ts`. Fake native tests cover separate login/hidden intent, OS readback, denial, unsupported operations, abort and timeout; file tests cover corruption and restart. Model/speech credentials remain with their existing protected owners. Reviewed PR49/50 completed root, IPC and renderer consumption. Live login-item writes and physical acceptance remain task 4.2, independently of this adapter implementation.
- [ ] 2.2 Integrate selected-device brightness/lighting capabilities and owner-delegated wallpaper/monitor/artwork/firmware actions; verify invalid values do no IO and device-selection races cannot redirect a write.

## 3. Wizard and settings UI

- [x] 3.1 Wire resumable local wizard, explicit desktop preview, idempotent profile selection and optional runtime skip; verify close/relaunch/replay, failed completion writes and offline completion through actual controls.
- [ ] 3.2 Wire locale/general/AI/device settings and local QUAKE guide with support-state documentation; verify hot locale updates, numeric provider bounds, unavailable adapters and no ARIS-68 calibration call.

  Existing provider validation now rejects advertised temperature ranges outside 0..2 and topP ranges outside 0..1. Request validation also enforces those product bounds independently of a provider's advertised range, while preserving narrower limits. The regression failed before the fix; 120 focused AI/chat tests, edge typecheck, scoped Biome and strict change validation pass. A real AiRepository/AiProviderService regression proves the existing `AiConfigInvalid` identity is returned before credential resolution or adapter dispatch. No saved-model/RPC schema, credentials or UI changed. The corresponding model controls still need the proposed optional-field schema approval; lighting and aggregate acceptance remain incomplete. Tracked in `open-quake-def.6.1`.

  Local guide evidence (Opus 5.5, 2026-10-26): Settings › General opens a bundled, reopenable QUAKE guide with en/de copy (`settings/QuakeGuide.tsx`, `guide-content.ts`). Focused tests cover dictionary completeness and placeholder parity, offline rendering with no images or links, guide controls limited to reading and navigation, clamped topic movement, sidebar-label places, the optional navigation seam, availability without the settings service, and focus restoration. A hidden production-root Electron run used a mock device and isolated userData, with presentation and focus suppressed, at `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-finish/settings-guide/run-2/`. It captured 33 screenshots at 1180x625 and 390x625 in Graphite, Midnight and Paper, in English and German. The dialog was modal, fit the window and had no horizontal overflow, unnamed controls or console errors. Focus moved to the topic heading when the guide opened, and Esc and × returned focus to Open guide. Reopening resumed at the last topic. Switching the language with the guide open re-rendered it in German, and the OS login item was unchanged. The hidden capture doesn't paint the modal backdrop, but its computed style was checked. Provider sampling bounds, unavailable adapters and lighting remain open (see design.md), so 3.2 stays unchecked. The parent now passes the shell navigation callback to GeneralSettings. A fresh hidden production-root run on the main-based integration captured 34 states, rechecked all guide states, language/focus/reopening, and clicked the guide link to Device › Keys. It confirms navigation closes the dialog and opens the destination, no horizontal overflow or unnamed controls, no console errors, and unchanged OS login settings. Evidence stays external at settings-guide/parent-run/. Parent checks pass all 52 settings tests, desktop typecheck, scoped Biome, strict validation and the production-root build.

## 4. Acceptance and handoff

- [ ] 4.1 Run all settings-and-wizard scenarios through real consumers with fake OS/device/repository layers; verify pending/unverified device state is not shown as confirmed.
- [ ] 4.2 Capture native login/window/lighting and physical onboarding evidence when available; keep QUAKE calibration unverified/unavailable and update parent-managed Beads with source plus verification links.

## 5. Settings-firmware parity lane

- [x] 5.1 Implement authenticated DK-compatible archive export/import, bounded validation and transactional profile/resource merge with independent interoperability fixtures (SETTINGS-014).
- [x] 5.2 Implement optional-backup reset with 60s deadline, second confirmation and writer shutdown tests (SETTINGS-016).
- [x] 5.3 Implement five live macOS permission statuses, focus/2s refresh and fixed deep links with mock/native loading evidence (SETTINGS-015).
- [x] 5.4 Implement app-owned disabled/fake feed, 5s/12h scheduler, single-flight download/install state machine and TestClock coverage (SETTINGS-049/050).
- [x] 5.5 Wire settings controls through authenticated typed IPC, run all repository gates, capture native mock screenshots and report hardware acceptance separately (SETTINGS-014..016, SETTINGS-049/050).
- [ ] 5.6 After merge, verify a consented legacy backup and packaged macOS permission attribution/deep links with the acceptance owner; retain the disabled release feed until signing/publishing policy exists.
- [x] 5.7 Reconcile PR #32 with current main, preserving maintenance, monitor, clock, profile and lifecycle ownership; handle new actionable review findings, run repository gates and both native mock smokes, inspect combined registration behavior and fresh screenshots, and push without closing physical acceptance or parent tasks.
- [x] 5.8 Fix PR #32 round 2 by deduplicating complete ordered legacy profiles with referenced asset content, making firmware persistence failures retryable, and identifying boot drives in selection and confirmation; merge current main, run fresh gates and both native mock smokes, and resolve handled review threads with evidence (open-quake-def.18).

- [x] 5.9 Fix PR #32 round 3 by archiving explicitly referenced external clock image/video bytes with portable restored paths, reporting reset shutdown/clear failures from main with guaranteed exit, and completing runtime/writer cleanup and quit after maintenance initialization failure; preserve previous regressions, integrate current main, run all six fresh gates and three sequential native mock smokes, and resolve the three handled threads with source and verification evidence (open-quake-def.19).

- [x] 5.10 Address PR #32 round 4 with durable backup commit ordering, bounded descriptor firmware reads, retryable discovery probes, post-open destination validation, recoverable session loading and typed initialization failures, exactly-once scoped bookmark release, accurate reset confirmation, portable opt-in smoke scratch, and rejection of generic DFU sends; preserve earlier fixes, run six fresh gates and three sequential native mocks, reply and resolve nine threads with evidence (open-quake-def.20).

- [x] 5.11 Address PR #32 round 5 by bounding cumulative raw export reads and retained archive bytes/entries before disallowed reads, including nested imports, external clock assets and generated projections; preserve native app links through added/deduplicated profile ID mapping with destination-first conflicts and retained manager state. Prove regressions, run six fresh gates and sequential maintenance/media/voice native mocks, reply and resolve both findings with source evidence (open-quake-def.21).

Task 5.8 evidence: source a684eea02c8a4cb59825841b9975c4307cf65c4a integrates main ec7d66b05ef19f6b10e141aa0876ba79468ddda3. All six gates pass with 1,173 uncached tests, 37 strict OpenSpec items and both bundle modes. Maintenance, media and voice native mocks pass; nine maintenance captures and representative media/voice captures were inspected. The four round-2 threads were replied to with Codex attribution and resolved. Logs, commands, capture hashes and failure-path evidence: `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/settings-firmware/review-round-2/`. Physical and packaged acceptance, earlier wizard tasks and parent clusters remain open.

Task 5.9 evidence: fix 0299ce693c79c1097de54f8681cde0e9d23cbeb8 and verified source 2a1582fa2f9ca1e9fdc73137bbda795f635bb2b7 retain main ec7d66b05ef19f6b10e141aa0876ba79468ddda3. All six fresh gates pass with 1,194 uncached tests, 37 strict OpenSpec items and both bundle modes. Combined maintenance, baseline media and voice native mocks pass; restored external clock media loads through the production protocol after its original is removed. Fifteen counterfactual regressions fail on original 4593cf6 for the intended bugs, and an injected native assertion exits 1. All three round-3 threads were replied to with fix SHA and Codex attribution and resolved. Source, exact commands, capture hashes, visual inspection, exit probe and cleanup evidence: `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/settings-firmware/review-round-3/`. Only def.19/task 5.9 close; parent independent verification, physical and packaged acceptance, wizard tasks and epics remain open.

Task 5.10 evidence: fix 1f90a0c442401a0015a825cba931b8f898cbcf27 and verified source c8df89f1f45799191483e82d67f06e240c39c8ff retain main ec7d66b05ef19f6b10e141aa0876ba79468ddda3. All six fresh gates pass with 1,219 uncached tests across 132 files, 37 strict OpenSpec items and both bundle cases. Sequential maintenance/media/voice native mocks pass with actual PASS markers; maintenance has zero missing-owner warnings and only scratch helper userData paths. All ten maintenance captures and representative media/voice captures were inspected. Eighteen regressions fail on the original source; an additional active-copy disposal regression fails on the first fix. Injected native assertion and missing-opt-in runs exit 1. Nine round-4 threads received fix/evidence replies with Codex attribution and were resolved. Exact commands, retained initial failures and first-run observations, capture hashes, sync-source research, limitations and cleanup: `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/settings-firmware/review-round-4/RESULT.md`. Only def.20/task 5.10 close; lead verification, physical/packaged acceptance, wizard tasks and parents remain open.


Task 5.11 evidence: source 9b049cb9c4aa11d271c0d992baf09c0fccff4ab2 retains main ec7d66b05ef19f6b10e141aa0876ba79468ddda3. Shared raw and retained export budgets reject before disallowed managed/external content reads and account for projection/replacement/deduplication; native persistent app links follow added/deduplicated final profile IDs with destination-first conflicts. All six fresh gates pass with 1,241 uncached tests across 135 files, 37 strict OpenSpec items and both bundle cases. Sequential maintenance/media/voice native mocks pass; combined maintenance has zero missing-handler warnings, baseline media/voice record 19/6 in this run. All ten maintenance captures and two representative media/voice captures were inspected at full size. Nineteen regressions fail on original fbf5ac6 production; the native injected assertion exits 1. Both round-5 threads received source/verification replies with Codex attribution and were resolved. Exact commands, earlier fixture/typecheck failures, warning counts, capture hashes, privacy-handling disclosure and limits: `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/settings-firmware/review-round-5/RESULT.md`. Only def.21/task 5.11 close; parent independent verification and final-head review, lead closure, physical/packaged acceptance, wizard tasks and parents remain open.

## Parent backend integration evidence, 2026-10-25

General preferences, wizard progress and locale now share one SettingsRepository and ManagedRuntime in desktop registration. A management-main-frame-only encoded RPC/preload bridge exposes the schema-defined methods; the panel retains locale-only access. OS login writes occur only for an explicit launchAtLogin patch. Saved intent and OS readback remain distinct after denial. Root supplies bounded Electron adapters and canonical device/profile/runtime probes, applies reachable startup bounds before showing management, preserves a visible fallback when hidden startup cannot be reopened, and owns coalesced window persistence with awaited disposal. Native errors retain catalog identity, safe diagnostics and reason across actual RPC decoding.

Combined verification: 1,400 desktop tests, 487 edge tests with three external-container skips, both typechecks, production build, scoped Biome and strict settings-and-wizard validation passed. Subsequent root/settings focused checks passed 55 tests; an actual denial through RPC also proves correlated failed spans, catalog code and exclusion of private cause text.

A hidden production-root acceptance used real Electron/preload/RPC and mock device, isolated data at `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-finish/settings-acceptance/run-20261025`. First launch completed offline preview setup with canonical profiles and runtime explicitly skipped; second launch retained German and completion, corrected intentionally unreachable window bounds, replayed and completed without losing choices. Both launches verified unchanged OS login state and clean diagnostic shutdown, 378 and 333 spans respectively with zero drops/storage failures. Window presentation was suppressed only in the external acceptance launcher. No real login writes, providers, hardware or microphone calls ran.

Tasks 1.2/2.1 remain in progress for reviewed integration delivery. Opus owns tasks 3.1/3.2 UI and control-driven acceptance. Region suggestions remain empty rather than guessing supported providers; no provider credentials/configuration are changed by setup. Native login-item changes and physical lighting/onboarding acceptance remain task 4.2.


## PR49 review fixes, 2026-10-25

Replacement management windows now drain pending geometry, restore reachable saved bounds and only then respond to explicit activation. Setup validates visible manager profiles, the current hardware snapshot serial in both mock and real paths, and saved HTTP connection configuration independently of live connectivity. Explicit region changes refresh advisory suggestions while leaving chosen locale/provider/speech settings intact. Preload projects catalog failures to plain allowlisted objects so Electron contextBridge preserves code/reason without private causes. The bundle fixture now implements the real window listener/show lifecycle and waits for settings restoration before quitting.

Verification passed 60 focused desktop settings/root/HTTP tests, 25 onboarding tests, both typechecks, production build, both bundle-smoke modes, scoped Biome and strict validation. Hidden real Electron acceptance at `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-finish/settings-acceptance/run-review-20261025` completed setup using simulated QUAKE and a saved offline Hermes connection, received `QUAKE.WIZARD.INCOMPLETE` with only tag/code across the real contextBridge, and reopened management at clamped saved bounds. OS login items were unchanged. Shutdown retained 583 diagnostic records with zero drops/storage failures. No providers, real hardware or microphone were used.

Shared revision remains a monotonic settings-document version, not a locale-change counter. The real RPC regression proves a window save increments it without a locale broadcast, and a later language change remains accepted. Renderer locale consumers compare revisions for ordering and use locale itself for language changes. This review observation needs no counter split. UI integration and reviewed merge remain open.

### Parent setup UI integration verification, 2026-10-25

Opus 5.5's setup and General UI is integrated in `finish/settings-wizard-ui` above the canonical settings backend fixes. Parent review also makes General reloads ignore obsolete OS readback and validates every selected profile ID. Focused regressions pass. The full desktop suite passes 1,438 tests with external TMPDIR; desktop typecheck, scoped Biome and strict validation pass.

A hidden Electron run imports the production root and drives the actual renderer controls through preload and RPC with isolated userData. It proves first-run setup, reload resumption at Display, live English/German switching, simulated QUAKE completion, saved offline Hermes configuration, explicit preview completion, General background-start persistence, replay and Finish later/resume. It captured 54 screenshots at 1180x625 and 390x625 across Graphite, Midnight and Paper. The 57 audit entries report no horizontal overflow or unnamed controls, and there are no renderer console errors. OS login state is unchanged. Evidence and reproducible external harness are under `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-finish/settings-ui/parent-run2/` and `capture/parent-root.ts`. An initial harness attempt put chunks one directory too deep and failed before bridge availability; corrected output paths passed.

Task 3.1 remains pending reviewed delivery and task 3.2 remains incomplete for AI/device/guide settings. This mock-device control proof does not establish physical onboarding, native login-item writes, packaged attribution or calibration. No microphone/provider requests, real-device ownership, OS preference changes or automatic runtime installation occurred.

PR50 review follow-up in progress: General settings now refreshes native login readback on focus/visible return, defers a refresh across an explicit save, and preserves catalog refusal feedback after successful background reads. Lifecycle/store tests prove external readback updates, hidden-event suppression, cleanup, deferred save reconciliation and retained refusal without changing real OS settings. Opus separately owns stale setup-language synchronization, retryable profile reads and truthful profile preference copy. Keep review delivery and aggregate tasks open until the combined fixes pass actual-root controls and are pushed/reviewed.


PR50 review follow-up source is integrated. General now offers an in-place retry after its first setup read fails, using the existing sentence and button copy approved by Opus. Setup reads the canonical app locale, retries profiles with newest-request guards, exposes connected-device refresh, and states that profile choices do not activate profiles. A failed HTTP owner initialization now installs an authorized existing-protocol unavailable responder. Only its exact catalog code omits the optional runtime step; storage and transport failures from a constructed owner keep their original meaning. No transport schema or bridge method changed.

Combined verification passes 1,450 desktop tests, typecheck, production build and scoped Biome after moving the render provider wrapper to a test-only JSX fixture. The hidden production-root failure-controls run at `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-finish/settings-ui/review-controls-v2Oxbh/` proves in-place initial-read recovery, General-to-setup German preservation, profile retry and default seeding, a synthetic device swap through the actual hardware IPC handler, and successful completion with an intentionally failed runtime owner. Its 16 screenshots at 1180x625 and 390x625 have no horizontal overflow or unnamed controls. The separate `review-general-root/` run proves focus-event OS readback reconciliation without changing the native login item. Fault injection is confined to the scratch launcher and isolated userData. The real runtime startup fault retains correlated `AgentConnections.create` / `agent.connection` failure spans and the matching warning with the original catalog identity, before recovery.

These controls do not prove physical HID swapping, real OS login-item mutation, providers, microphone capture or packaged attribution. The refreshed full-theme run at `settings-ui/review-full/shots/` also passes with 54 screenshots and 57 audits across Graphite, Midnight and Paper, desktop and narrow widths, English/German, normal initialized offline Hermes, simulated QUAKE and explicit preview completion, resume/replay and General controls. Reviewed delivery remains pending. Task 3.2 and the aggregate remain incomplete.

PR50 current-head review found that the sidebar Resume setup action bypassed drawer dismissal. It now receives the shell's existing navigation callback, so it closes the narrow drawer and returns focus through the same path as ordinary navigation. A hidden production-root Electron run at `settings-ui/resume-drawer-HLbt7Q` opened Menu at 390x625, resumed setup, and confirmed the sidebar is closed and inert, the scrim is absent, focus is on Menu and setup is visible without horizontal overflow. The launcher used an isolated mock device and no microphone, provider, OS login change or foreground input. Shutdown emitted existing missing-handler messages for in-flight meetings/maintenance reads after disposal; this run proves the navigation path only.

PR62 keyboard navigation review: guide destination links now move focus to the
stable destination page container after navigation, including Settings-to-Settings
links. The first attempted heading query found the mounted-but-hidden connection
heading, so the actual-root check rejected it. The stable content container keeps
focus through asynchronous page loads. A fresh hidden production-root run on
reviewed main passes 35 states across all themes and widths, en/de, focus return,
live locale, reopening, Device Keys navigation and same-page Settings navigation.
No overflow, unnamed controls or console errors; OS login item unchanged. The
external final evidence is settings-guide/final-run2/. The design note now
describes the integrated callback. All52 settings tests, desktop typecheck, scoped
Biome and strict validation pass. Task3.2 remains incomplete for its other gaps.


## Reviewed delivery reconciliation, 2026-10-26

Tasks 1.1, 1.2, 2.1 and 3.1 are complete. The approved decisions are already
recorded in design.md, including QUAKE-only scope, no borrowed ARIS-68
calibration command, local-first ordering, explicit locale/region seeding and
the subsequent Meet AI resolution of question 11. Section 10 remains an
exclusion note rather than a new capability.

The settings backend was squash-merged in PR49 as `0d0bf6d`; setup and General
controls were squash-merged in PR50 as `3c1ad0f`. The versioned shared repository,
atomic completion and preserved unknown/provider fields are exercised through
`packages/edge/src/settings/onboarding.test.ts` and desktop storage/RPC tests.
The OS adapters distinguish saved login intent, confirmed OS readback and
start-hidden, retain catalog failures and correct unreachable window geometry.
The actual hidden-root control runs already recorded above prove incomplete
resume, explicit replay, offline preview/simulated-QUAKE completion, profile
eligibility and retry, failed-save behavior and locale preservation. The final
UI run in `settings-ui/review-full/shots/report.json` has 54 captures and 57
audits with no reported layout or console failures; the separate narrow-drawer
regression proves Resume uses the shared navigation path. Both PRs received
current-head clean reviews and passed the complete package/download matrix.

This reconciliation changes recorded completion only. Tasks 2.2, 3.2, 4.1 and
4.2 remain open for selected-device lighting, saved sampling controls, all
remaining scenario coverage and native/physical acceptance. The guide is now
also merged through PR62, but that alone does not complete task 3.2. Beads
`open-quake-def.1`, `.2`, `.3` and `.5` correspond to the four checked tasks;
`open-quake-def.22` owns this reconciliation delivery.

Fresh verification on the merged source passes 36 settings-domain tests and
79 desktop settings/RPC/renderer tests plus strict OpenSpec validation.

- [x] 3.5 Wire approved optional saved-model temperature 0..2 and topP 0..1 through model RPC/persistence, per-row advanced settings and inference. Blank preserves provider defaults; invalid values prevent saving. Verify persisted values, actual request sampling and renderer edits. Bead: open-quake-def.6.2.

Sampling implementation, 2026-10-26: the approved optional finite fields flow through the existing model/RPC/state contracts and common inference profile. Existing rows omit them and preserve defaults. Per-row Advanced inputs use en/de copy, label errors and prevent all saves while invalid. Pending acknowledgments retain newer edits and clearing. Verification: 649 edge and 1669 desktop tests pass, with three external edge skips and one platform-native desktop skip; both typechecks, desktop build, scoped Biome and strict validation pass. The actual SDK transport regression fails on the preceding projection. A hidden production-root run proves invalid role-autosave is blocked, actual disk storage retains zero/one, SDK requests carry temperature=0 and top_p=1, clearing omits both, and live en/de layouts at 1180x625 and 390x625 have no overflow or unlabelled fields. Captures and logs stay external under open-quake-finish/provider-sampling. Reviewed delivery remains pending in open-quake-def.6.2. Broader task 3.2 remains open for lighting and acceptance.


### Saved-model sampling review verification

PR77 review found that the editor accepted OpenAI overrides which the provider workflow rejected. The new real desktop RPC/SDK regressions reproduced that failure on all three original GPT-4o cases before the correction. A shared pure policy now enables documented GPT-4o and GPT-4.1 text model overrides, preserves the existing default-only policy for other OpenAI models, and validates Kimi mandatory values consistently at save and inference time. Unsupported drafts show an en/de explanation, remain editable and block manual and role-triggered saves before credential or state writes. Clearing both fields restores defaults.

Verification after correction: 46 focused edge tests and 32 focused desktop tests pass, both typechecks and the production build pass, scoped Biome and strict OpenSpec validation pass. The hidden production-root run uses an OpenAI-labelled GPT-4o row and a synthetic local HTTP provider. It confirms persisted zero/one values reach the actual SDK request, unsupported model edits block both save paths without changing revision, the explanation switches live to German, clearing permits saving again, and 1180x625/390x625 layouts have no horizontal overflow or unlabelled fields. The run leaves real device, microphone, login preferences and live providers untouched. Screenshots and logs remain external under `open-quake-finish/provider-sampling`. Reviewed delivery remains pending; broader task 3.2 is incomplete.


## 6. Locale burn-down lane

- [x] 6.1 Bundle eight recovered locales, normalization/endonyms, mounted window/strip/profile/picker/voice/native propagation and all-six-role precedence tests. Rows AI-149, CENTER-006, MGMT-327, SCREEN-011, SCREEN-099, SETTINGS-007, SETTINGS-063, SETTINGS-064. Bead open-quake-def.23.
- [x] 6.2 Add local regional chat/speech suggestions, explicit-choice-safe legacy migration/bootstrap and eighteen translation languages through real settings controls/owners. Rows AI-015, SETTINGS-065, SETTINGS-067, SETTINGS-098, SETTINGS-099, SETTINGS-111. Bead open-quake-def.24.
- [x] 6.3 Localize all clock/settings/enrichment labels, verify rendered eight-locale copy and independent weather/spoken routing, run lane gates and mock native EN/DE smoke. Row WIDGETS-063. Bead open-quake-def.23.
- [x] 6.4 Preserve pending mounted city verification across app language changes, with debounce and in-flight regressions. PR #105 comment 4379719107, bead open-quake-def.23.1.
- [x] 6.5 Propagate the validated profile capture locale before passive clock rendering, with a non-English mounted capture regression. PR #105 comment 4379719124, bead open-quake-def.23.2.


Locale lane implementation, 2026-10-26: all fifteen assigned software rows now
have requirements/scenarios, production consumers and regression coverage. Eight
UI languages propagate without replacing mounted drafts; translation has its own
eighteen-code catalog; local region suggestions never switch configured providers;
bootstrap preserves explicit/unknown settings and removes only documented transient
keys. Main lifecycle prompts and the macOS Dock background menu use saved locale.
The supported Qwen ASR suggestion is 3.1 rather than the recovered retired 3.0 name.

Final integration includes main `97ab6656`. Windows Extend consent, arrangement
persistence and explicit Disconnect remain intact and read the saved locale at
action time. Live macOS/Windows/hidden-mirror prompt and startup tests pass 61
cases. Main's newly expanded provider catalog required the existing agent-picker
test to expect its five added providers and Flash-before-Pro DeepSeek order;
production provider behavior is unchanged. That isolated regression passes all
three tests after reconciliation.

Verification: the required root Turbo command with `--env-mode=loose` and SSD
TMPDIR passes 3,853 tests with four existing skips: desktop 2,413, edge 865,
device 512 and protocol 63. Six package typechecks pass. Biome checks 1,346 files
with no errors and 14 existing warnings. Production build, both bundle smoke
cases and all 47 strict OpenSpec items pass. The unmodified hidden native media
smoke passes eight groups on the merged renderer with mock devices and muted
windows. Its 22 screenshots include EN/DE wallpaper controls. Earlier additional
Settings captures show en/de at 1180px and 390px with all eight controls and no
horizontal overflow; the German clock capture shows localized seconds, theme
and enrichment copy. The extended capture script later hit the known OBS
scene-selector timeout, so its extra captures are separate from the passing
unmodified smoke gate.

Evidence stays under the SSD lane scratch directory
`open-quake-parity/burndown/locale/`, including `merge-root-tests-verified.log`,
`merge-native-smoke.log`, `screenshots-merged/` and `screenshots/`. Physical
hardware, live microphone, paid-provider, OS-login and foreground native-menu
acceptance remain unverified. PR #105 carries all fifteen row mappings. Beads
open-quake-def.23 and open-quake-def.24 remain open for lead merge; the parent
change's unrelated incomplete tasks are unchanged.

PR #105 review fix 4379719107 keeps the mounted city verifier across locale changes and reads the current language when a lookup starts. Two mounted offline regressions fail on the previous implementation, covering a debounce that would be cancelled and an in-flight result that would be discarded. All 28 focused city/weather/live-locale cases pass.

PR #105 review fix 4379719124 seeds AppLocaleProvider from the schema-validated profile capture locale before mounting App. The real renderer-entry regression fails with English MON on the preceding implementation and passes with German MO, OKT 26 and localized theme navigation, including every observed ready preview. Fourteen focused profile/live-locale cases and desktop typecheck pass. Capture windows still use no management/panel locale bridge.
