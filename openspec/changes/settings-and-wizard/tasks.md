# Tasks

These are future implementation tasks. This lane creates specs only; no checkbox is complete. The parent creates one epic for this change and one issue per numbered task, using each task's text as its description and this OpenSpec path as its reference. Do not close implementation issues on planning-only evidence.

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
