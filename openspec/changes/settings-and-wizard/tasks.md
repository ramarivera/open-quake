# Tasks

Execution is tracked by open-quake-def under open-quake-lih.14. Section 5 is the settings-firmware lane; earlier wizard/general tasks stay open. Source and automated evidence are in apps/desktop/src/main/maintenance/README.md and the lane report. Parent clusters remain open until merge and acceptance.

## 1. Scope and persistent contracts

- [ ] 1.1 Record Ramiro's decision on question 8, the QUAKE calibration gate, wizard ordering, locale/provider seeding and question 11 deferral; verify design/spec/tasks remain coherent and section 10 has only the design note.
- [ ] 1.2 Add versioned settings/wizard schemas, validation/migration invariants and repository documentation; verify atomic completion failure, unknown-field preservation and user choices surviving reseed.

## 2. Settings owners and host adapters

- [ ] 2.1 Implement general OS preference/window adapters and protected provider secret references with catalog errors; verify login/start-hidden separation, unreachable-window correction, denied OS writes and secret-free serialization.
- [ ] 2.2 Integrate selected-device brightness/lighting capabilities and owner-delegated wallpaper/monitor/artwork/firmware actions; verify invalid values do no IO and device-selection races cannot redirect a write.

## 3. Wizard and settings UI

- [ ] 3.1 Wire resumable local wizard, explicit desktop preview, idempotent profile selection and optional runtime skip; verify close/relaunch/replay, failed completion writes and offline completion through actual controls.
- [ ] 3.2 Wire locale/general/AI/device settings and local QUAKE guide with support-state documentation; verify hot locale updates, numeric provider bounds, unavailable adapters and no ARIS-68 calibration call.

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
- [ ] 5.8 Fix PR #32 round 2 by deduplicating complete ordered legacy profiles with referenced asset content, making firmware persistence failures retryable, and identifying boot drives in selection and confirmation; merge current main, run fresh gates and both native mock smokes, and resolve handled review threads with evidence (open-quake-def.18).
