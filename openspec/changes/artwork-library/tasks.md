# Tasks

The original foundation tasks below include work beyond key icons and remain separate from the icons burn-down tasks in section 4. The parent creates one epic for this change and one issue per numbered task, using each task's text as its description and this OpenSpec path as its reference. Do not close implementation issues on planning-only evidence.

## 1. Resource contract

- [ ] 1.1 Resolve file limits/duplicate policies and question 13 delivery boundary with the profile/display/emoji owners; verify a recorded agreement that local assignments do not imply verified 0xA2 output.
- [ ] 1.2 Add resource/assignment schemas, format/limit/reference invariants and import documentation; verify stable IDs, supported decoded types, invalid dimensions and immutable built-ins.

## 2. Files and assignment lifecycle

- [ ] 2.1 Implement import/copy/sanitization and metadata repository with catalog errors; verify unsafe SVG/external loads, size limits, moved originals and per-item partial batch results.
- [ ] 2.2 Implement duplicate resolution, reference-aware deletion and target-bound assignment; verify cancellation, stale picker targets, backing-file failure and referenced-resource rejection.

## 3. Library acceptance

- [ ] 3.1 Wire icon groups/search/import, template units and key/wallpaper picker through the typed client with user documentation; verify only the selected target changes and all consumers refresh after deletion.
- [ ] 3.2 Run every artwork-library scenario using local fixtures and the actual picker/template consumers; leave emoji packaging and physical delivery unverified pending owning-lane evidence.


## 4. Icons burn-down lane

- [x] 4.1 MGMT-414, MGMT-415, MGMT-416, MGMT-417, MGMT-418, MGMT-421, MGMT-422, MGMT-424, MGMT-425: mounted picker readiness, search, progressive groups, selected/pending cells, paging/release, deletion dialogs, empty recovery and readable dedicated appearance. Bead open-quake-lih.10.3.
- [x] 4.2 MGMT-254, MGMT-426, SCREEN-132: retained PNG/JPEG/GIF/WebP/static SVG inputs, hash reuse, safe resolution, stale-generation suppression and listener disposal through production consumers. Bead open-quake-lih.10.5.
- [x] 4.3 MGMT-252, MGMT-430, WIDGETS-008: bounded selected cards/clock arrows, six thumbnail states and batch locks, emoji/game geometry and owned foreground-app artwork. Bead open-quake-lih.10.4. Hardware and real OS foreground acceptance remain unverified.
- [x] 4.4 Run repository gates, hidden mock native acceptance and EN/DE screenshot inspection; leave beads open for the lead. All gates and 22 native acceptance groups passed on 2026-10-26. PR delivery and review state are recorded on the beads.
- [ ] 4.5 MGMT-413 is blocked pending lead/user ownership or an explicit approved exclusion for generic merge/deletion, download, port-probe and timestamp helpers. Bead open-quake-lih.10.6. No completion claim.

- [x] 4.6 Fix PR87 review findings 4377852029, 4377851690/4377887120, 4377887146, 4377887129, 4377887137 and 4377851879 with red/green regressions, separate commits/pushes/replies and full gates. Keep foreground paths in main, preserve artwork across metric samples, make previews inert, wait for thumbnail artwork, guard stale clock completion and protect application-prefixed references. Bead open-quake-lih.10.2.9.1. Six fixes pushed individually with replies. Red/green regressions, 3,140 unit tests passed with four skips, 24 hidden native icon groups, lint/types/build/bundle and 47 strict spec items passed. Desktop tests used direct SSD TMPDIR with two workers after Turbo temp-path failures and one parallel timeout. Required media smoke failed at the previously reported main-branch OBS screenshot step; left to its owner. Logs and screenshots: `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/burndown/icons/fix1/`.
