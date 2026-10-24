# Design

## Context

See proposal.md for the capability boundary. Every product choice below marked "Approved (Ramiro, 2026-10-23)" was accepted by Ramiro on that date. The delta spec records the acceptance contract; implementation evidence and remaining physical gates are listed below.

Inventory: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, sections 7–9, Later phases and the cited open questions.

## Evidence and source paths

Path roots are local-only, read-only research inputs. S means recovered source for the stated behavior, P means partial analysis/dependency evidence, and N means name-only evidence. Source availability does not prove runtime or hardware success. Replacement limits and new failure behavior are proposed, not recovered facts.

- ATLAS = `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion`
- ART = `ATLAS/artifacts`
- RS = `ART/recovered_sources`

- **S** `RS/webpack:__dk-suite_src_views_Wizard_wizardConstants.js`: eight step IDs and supported locales; source orders OpenClaw install/init before Profiles, unlike the inventory summary.
- **S** `RS/webpack:__dk-suite_src_views_Wizard_WizardWindow.vue`: one flow with display/profile validation, runtime skip behavior and debug support.
- **S** `RS/webpack:__dk-suite_src_views_Wizard_steps_WizardStepLocaleRegion.vue`: locale and region selectors.
- **S** `RS/webpack:__dk-suite_src_main_managers_aiEngineProviderFromGeo.js`: separate speech and AI default seeding.
- **S** `RS/webpack:__dk-suite_src_main_managers_regionService.logic.js`: region derivation from country metadata.
- **S** `RS/webpack:__dk-suite_src_views_Setting_GeneralSettings.vue`: locale, openAsHidden, monitor controls and AI provider selection.
- **S** `RS/webpack:__dk-suite_src_views_Setting_AIConfigSettings.vue`: provider keys, model and speech parameters.
- **S** `RS/webpack:__dk-suite_src_views_ManagementCenter_utils_ai-config-utils.js`: temperature 0–2 and topP 0–1 validation.
- **S** `RS/webpack:__dk-suite_src_views_ManagementCenter_utils_ai-provider-defaults.js`: provider base URL/API defaults.
- **S** `RS/webpack:__dk-suite_src_main_utils_ai-engine-provider-catalog.js`: provider catalog and user-chosen preservation.
- **S** `RS/webpack:__dk-suite_src_views_Setting_DeviceSettings.vue`: QUAKE/QMK target selection, backlight, lighting and upgrade entry.
- **S** `RS/webpack:__dk-suite_src_views_Setting_services_QMKLightingService.js`: lighting get/set/save/probe boundaries.
- **S** `RS/webpack:__dk-suite_src_views_Components_ColorfulScreenSettings.vue`: per-serial wallpaper interval/fill/play settings.
- **S** `RS/webpack:__dk-suite_src_views_QuakeGuide_QuakeGuideDialog.vue`: usage guide dialog.
- **S** `RS/webpack:__dk-suite_src_views_QuakeGuide_quakeGuideContent.js`: guide content data.
- **S** `RS/webpack:__dk-suite_src_views_ARIS-68_Componets_CalibrationAris68.vue`: calibration belongs to an ARIS-68 view, not demonstrated QUAKE calibration.
- **N** `ART/ipc_channels.txt`: ReportCalibrationData and DoManualCalibration names do not establish a QUAKE command.
- **S** `RS/webpack:__dk-suite_src_plugins_KeyConfiguration.js`: liveAudioTranslate key-library menu entries are disabled; 0.4.95 instead ships live translation as a Meet AI profile key (`AI-136/292`), so the action is profile-provided rather than added from the key library or settings.

## Goals / Non-Goals

Goals: give implementers one owned contract, observable failure states and a verification path for this capability.

Non-goals: account/cloud migration, a real app-release endpoint, ARIS-68 calibration, changes to other lanes' artifacts, or claims of physical acceptance.

## Package ownership

`packages/edge` settings/wizard contracts, invariants, repositories and conductors; `packages/client` typed settings API; `apps/desktop` OS preference/secret adapters, wizard/settings/guide UI and composition root. `packages/device` owns capability-backed brightness/lighting writes; `packages/protocol` owns verified encodings. AI, wallpaper, profiles, firmware and runtime lanes retain their respective implementation ownership.

Approved (Ramiro, 2026-10-23): keep domain modules in the existing packages rather than adding feature packages now. In `packages/edge`, each domain separates contracts, pure invariants, repository interfaces and an Effect.Service conductor. Electron-specific APIs live in `apps/desktop/src/main` adapters supplied at the composition root; renderers consume `packages/client` through a narrow typed preload bridge. `packages/protocol` stays pure; `packages/device` owns hardware I/O. `packages/cli` is an optional client, not another domain owner.

Native control contracts are Schema-first `@effect/rpc`; external third-party protocols stay boundary adapters. Services declare dependencies, use named `Effect.fn` methods with explicit success/error types and scoped cleanup. User/automation actions have one capability-registry declaration. UI never calls raw SDKs. AI calls, where needed, use the existing Vercel AI SDK Effect facade and mocked providers in CI.

## Decisions

1. Approved (Ramiro, 2026-10-23): question 8, recommend QUAKE-only scope. ARIS-68 is a separate keyboard with axle-body/performance/calibration/script/linkage views. Adding it would require a second device identity, protocol and hardware acceptance suite. Keep its views and calibration commands out of QUAKE parity; revisit as a separate product change.

2. Approved (Ramiro, 2026-10-23): no QUAKE touch/knob calibration write until a QUAKE-specific capability and command contract is recovered and verified. Display unsupported state rather than borrowing ARIS-68 IPC semantics.

3. Approved (Ramiro, 2026-10-23): local onboarding is Welcome → Locale/region → Display → Profiles → optional OpenClaw install/init → Complete. The recovered source puts runtime steps before Profiles. Prefer immediate local usability and record this deliberate ordering change.

4. Approved (Ramiro, 2026-10-23): seed locale/provider suggestions once from OS locale and an explicitly selected region. Avoid a network geo lookup; user choices win permanently and unsupported provider suggestions remain unselected.

5. Approved (Ramiro, 2026-10-23): offer the recovered locale IDs zh, en, es, fr, ko, de, it and ja only when translations exist; use en as replacement fallback. Record launch-at-login and start-hidden separately because openAsHidden proves only hidden-start storage.

6. Approved (Ramiro, 2026-10-23): question 11 remains deferred in meeting-minutes; settings must not enable a liveAudioTranslate action from disabled menu evidence. Superseded 2026-10-24 by the 0.4.95 audit: live translation ships in the default Meet AI profile (`AI-136/292`), so question 11 is resolved in meeting-minutes. Settings still does not add its own liveAudioTranslate entry; the action is reached through the Meet AI profile's keys.

### Data model

Approved (Ramiro, 2026-10-23): Versioned SettingsSnapshot separates general, locale/region, provider secret references and device-scoped preferences. WizardProgress stores step ID, draft choices, skipped optional capabilities and completion status per OS user/machine installation. Capability status comes from owners, not a settings-only boolean.

### Data flow and lifecycle

Approved (Ramiro, 2026-10-23): The settings conductor decodes and validates a draft before an atomic repository write, then applies the affected OS or owning-domain operation and reports saved/requested/confirmed status accurately. Wizard completion commits only after required local choices validate. Device changes carry a selected-device generation ID so late responses cannot affect a newly selected unit. Guide text is bundled locally and follows the shared theme/motion contract.

### Failure contract

Approved (Ramiro, 2026-10-23): use operation-specific catalog leaves, initially QUAKE.SETTINGS.INVALID, QUAKE.SETTINGS.PERSIST_FAILED, QUAKE.SETTINGS.OS_APPLY_FAILED, QUAKE.WIZARD.INCOMPLETE and QUAKE.DEVICE.CAPABILITY_UNAVAILABLE. Final code names must be reconciled with the shared catalog before implementation; never introduce a second catalog. Each leaf is a catalog-derived Schema.TaggedError with private original cause and bounded, scrubbed diagnostic projection. Consumers branch on tag/code, never text. Verify exact identity, cause retention, safe serialization and broken-dependency paths through real consumers.

## Recommended phase and dependencies

Minimum local wizard, locale, AI and device controls support the first-release cut. Expanded settings and guide follow those capabilities; optional runtime steps wait for Later phases item 5. Full firmware UI remains Later phases item 8 in firmware-dfu.

Dependencies are contracts supplied by their owning changes. An unavailable dependency yields an explicit unavailable state; this change does not duplicate its implementation or modify its specs.

### Inventory coverage and decision ownership

- Section 7 monitor tiles, app/window monitoring and the monitoring override: `system-monitor-tiles`; desktop clock: `desktop-clock`; global hotkeys/input hooks: `host-input-hooks`.
- Section 7 HA: `home-assistant-integration`; channels hub: `integration-channels`; plugin server/management: `stream-deck-compat`; camera and printer gateway views: `camera-and-printer-views`.
- Section 8 recording/history/export: `meeting-minutes`; DK-Player: `soundboard-player`.
- Section 9 first run, locale/region, general/AI/device settings, local guide and calibration gating: this change. Artwork/templates: `artwork-library`; DFU and firmware: `firmware-dfu`. Wallpaper and QMK transports remain delegated to their existing owners.
- Question 5 is an evidence gate in camera-and-printer-views. Questions 7 and 12 stay unresolved in stream-deck-compat. Question 8 has the QUAKE-only recommendation here. Question 9 is resolved by the six-channel catalog in integration-channels (`CENTER-072/073`); runtime pairing stays unverified. Question 11 is resolved by shipped Meet AI live translation in meeting-minutes (`AI-136/292`). Question 13 stays delivery-gated in artwork-library.

## Risks / Trade-offs

The inventory conflates openAsHidden with login startup and associates generic calibration IPC with QUAKE. Separate hidden-start/login fields, and require device capabilities before writes. Preserve unknown future settings fields on versioned migrations.

The proposed package placement keeps current workspace boundaries but grows `packages/edge`; retain cohesive domain files and split a new package only when ownership or dependency constraints justify it. Pinned runtime dependencies for this lane are documented below and in the maintenance README; Ramiro approved parity dependencies on 2026-10-24.

## Migration plan

Create versioned local settings/repository records behind a capability gate. Validate imported shapes before writing and preserve the last valid snapshot on failure. Enable only the verified capability subset after its acceptance scenarios pass. Roll back by disabling the capability and retaining readable user records; destructive native side effects need their own recovery flow.

## Verification and outstanding evidence

Drive the actual wizard/settings client with fake repository, OS and device layers through first-run resume, failed completion save, explicit choices surviving region changes, secret redaction and selected-target races. Confirm delegated wallpaper/monitor/firmware actions hit their real owner. Native launch-at-login behavior, lighting readback and QUAKE calibration remain unverified.

Implementation closure requires scenario evidence and parent-managed Beads updates. Only implemented and verified lane tasks are checked in tasks.md; physical acceptance remains open. Do not launch DK-Suite; use independent fixtures and the open-quake application for future verification.

## cloud-features-out-of-scope

Inventory section 10 is CLOUD-SKIPPED: account/login/session and multi-account switching, MQTT, DecoKee model proxy/region routing, device-log upload, and agent market/sharing are excluded. The recovered account wizard step is omitted. No section 10 capability specs are created.

## Settings additions, 2026-10-24

Source: v0.4.95 recovered_sources/src/views/Setting/GeneralSettings.vue and app-resources/background.js bytes 6595513, 6603890, 364307. SETTINGS-014 uses WinZip AES-256 encrypted ZIP, deflate level 9, account_config.json, export_index.json {originalBasePath, originalPlatform}, and app/assets/resources.conf. Compatibility password derivation concatenates account, @, the app name DK-Suite lowercased without punctuation, then the four-digit format year 2026. This is public format compatibility, not confidentiality against someone with the app. Never log derived passwords. Export includes managed app data and a DK-compatible resource projection. Imports authenticate every entry, enforce bounded sizes and safe paths, skip built-in/deleted resources, deduplicate configurations, assign fresh profile/resource IDs, and remap cross-platform paths. Stage and atomically commit validated state; quit/relaunch after restore so cached writers cannot overwrite it. Secrets and account credentials are excluded.

Use pinned @zip.js/zip.js for maintained authenticated ZIP parsing instead of a bespoke ZIP implementation, and koffi@3.3.3 for fixed-path in-process permission checks. Dependency approval is blanket per Ramiro 2026-10-24. Live statuses are granted/denied/unknown/unsupported; System Audio registration success is never interpreted as grant. Poll at 2000ms and on focus, deep link only on user click.

Clear-data backups have a 60000ms deadline. Failed/cancelled backup requires a fresh native confirmation. Stop writers before deleting the app-owned userData root; retain it if stopping writers or staging reset fails. Clear exits. No arbitrary path is accepted by IPC.

Self-update uses an open-quake-owned feed abstraction, disabled production feed and injectable deterministic fake feed. Future release manifest must bind app id, semantic version, platform, architecture, HTTPS artifact location, byte length and SHA-256 under a signed/pinned release policy before enabling a real endpoint. No DK-Suite feed or real endpoint is configured. Main owns a single-flight state machine, first background check at 5000ms then every 43200000ms; background download precedes the prompt, manual checks can prompt before download. Dispose timers/fibers on quit. Download/install is an adapter capability, unavailable with the disabled feed.

Account files also use electron-store 7 / conf 9 encryption. The record is 16 random IV bytes, a colon byte, then AES-256-CBC ciphertext. The key is PBKDF2-SHA512 with 10000 iterations, 32 output bytes, the IV decoded as UTF-8 as salt, and the account-derived app identifier documented in account-config.ts. A plain ZIP entry containing JSON alone is insufficient. Independent Node fixtures verify both layers; DK-Suite was never launched. Legacy import projects profile titles, keys, knob and resource references into the native profile model. Vendor account/cloud credentials are excluded. Native snapshots preserve managed settings and rebase archived paths when restoring to another installation. Unknown missing archive-relative resources reject the import instead of fabricating a path.


## Review round 4 safety boundaries

Task 5.10 retains SETTINGS-014..016 and the firmware-dfu contracts. Backup success requires syncing the staged file before atomic replacement and syncing its parent directory on POSIX before reset may proceed. OS sync success is not proof against hardware power loss. Firmware reads use a single no-follow descriptor with file metadata and a strict read bound, including concurrent growth. Destination descriptors and their validated parent identity are checked before the first firmware byte; Node lacks descriptor-relative open/unlink, so hostile concurrent path replacement cannot be made race-free. Never remove an unrelated swapped destination during cleanup. Discovery probe failures are empty polls, while final live validation stays fail-closed.

Malformed or unreadable persisted sessions retain evidence and emit scrubbed catalog diagnostics while starting an empty, nonflashing recovery state. Genuine remaining runtime initialization failure returns a typed IPC failure and retains the awaited cleanup/quit guarantees. Scoped bookmark access is registered immediately and released exactly once on failed hint persistence or write, terminal completion, or disposal. Reset confirmation repeats the chosen backup mode. Native smoke requires an explicit portable scratch root and rejects paths outside it or overlapping the app's real data; host runs still use the approved ExtSSD scratch. Generic hardware sends reject DFU before I/O, leaving enterDfu as the sole locked no-ack transition.


## Review round 5 export and app-link invariants

Task 5.11 keeps the archive writer's numeric limits as the single authority. Export has separate cumulative raw read byte/count limits and retained archive byte/count accounting. Check descriptor sizes against remaining read capacity before allocating or reading, bound reads against growth, and retain only stable regular files. JSON normalization can reduce retained bytes but never refunds raw read work. Map replacement subtracts the previous entry, and content-addressed deduplication charges each retained archive path once. External clock reads share the raw budget; rewritten settings and each generated compatibility projection/index entry use the same retained budget. Reject at the first disallowed read or addition rather than building an invalid full archive. Tests use small shared limits and observe actual filesystem reads.

Native restore records source-to-final profile IDs for both added profiles and complete-content matches. Import only persistent app links from the source manager, rebased through that mapping. Preserve destination profile-manager settings, active selections, command approvals and runtime/default state. Destination links win both an existing profile association and an overlapping app identity; remaining source links are imported in order, at most one per final profile, without dangling targets. Compare app identity using the platform's switching contract and device scope. Same-platform links retain their path/identifier; cross-platform app identities are not portable and are skipped. Repeated import must preserve the resulting envelope. Test a real linked export/reset/import through ProfileSwitching.probe in addition to deduplication, profile-ID collisions and destination conflicts.
