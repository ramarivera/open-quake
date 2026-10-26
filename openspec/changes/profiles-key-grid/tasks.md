# Tasks

## PR107 import-link follow-up

- [x] Remap imported folder, emoji-folder, Back and string page links after allocating all page IDs; diagnose and preserve unresolved links as inactive compatibility data. Verify colliding IDs through ProfileService and the mounted key-editor-interactions fixture, then run typecheck, Biome, root tests, strict OpenSpec, build, bundle and hidden geometry smoke. Bead `open-quake-lih.10.14`, MGMT-077/090, review 4380208827.

Completed checkboxes record implemented and verified work. The parent maintains one epic for this change and one issue per checkbox, using the task text and verification as its description and linking this OpenSpec path. Do not close implementation issues from spec validation alone.

## 1. First-release contracts and local persistence

- [x] 1.1 Record Ramiro's decisions on the proposed envelope, logical row,col map, page boundaries, and import policy in design.md; verify the decision record distinguishes accepted policy from remaining physical evidence gaps.
- [x] 1.2 Add profile/page/key/title/edit-policy Schemas and the 2x8 logical descriptor in packages/device; verify round-trip and rejection fixtures cover every field in the common key and title schema tables.
- [x] 1.3 Add pure occupancy, anchor uniqueness, coordinate, span, and empty-cell invariants; verify property tests reject off-grid/overlapping layouts and preserve move/swap configuration.
- [x] 1.4 Add the profile repository interface and desktop atomic local adapter, with first-launch seeding and backup behavior; verify save/restart preserves nested values and injected write failure leaves the previous envelope readable.
- [x] 1.5 Add the profile conductor with expected revisions, distinct catalog errors, and named methods; verify two concurrent revision-4 saves produce one revision 5 and one conflict, with scrubbed diagnostics and no partial publication.
- [x] 1.6 Amend occupancy for approved parity decision 2: forced spans per type and inward edge spans through `profile-footprint.ts`; verify with the property tests in `profile-invariants.test.ts` (strip-key-grid, bead `open-quake-lih.2.1.2`).

## 2. First-release editor and page selection

- [ ] 2.1 Add typed preload commands/events and full-snapshot synchronization to both windows; verify a saved revision reaches the real panel and management consumers and the old draft-only path cannot affect dispatch.
- [x] 2.2 Add assign/replace/remove/move/swap/span/title/artwork editing with all five edit locks; verify the locked-swap, overlap-confirmation, and move-preserves-configuration scenarios through the editor.
- [x] 2.3 Add page creation, selection, wrapping previous/next, clamped go-to navigation, and safe removal; verify boundary and last-page scenarios plus knob retention across page changes.
- [x] 2.4 Add inert compatibility records and import diagnostics for unknown types, missing optional fields, and legacy sentinels; verify an unsupported camera record survives an unrelated save without runtime calls and document the import format.
- [ ] 2.5 Connect the committed selection snapshot to the key and knob dispatch capabilities and display delivery status; verify offline saves persist while remaining pending for the device and document the schema/selection API.

## 3. First-release physical mapping gate

- [ ] 3.1 Agree the normalized logical-touch versus physical-input contract with L1 without editing two-layer-sdk; verify the adapter rejects an unmapped physical event and the integration document cites the L1 capability/fixture.
- [ ] 3.2 On available QUAKE hardware, record every physical press/release, knob direction/hold, touch corners, firmware, and coordinate mapping; verify the trace against the logical descriptor and keep this task open as unverified until hardware evidence exists.

## 4. Later multiple-profile and folder work

- [ ] 4.1 Add create/rename/deep-duplicate/select/confirmed-delete with stable IDs and last-profile protection; verify nested duplicate isolation and active-deletion fallback in both windows, and document CRUD behavior.
- [ ] 4.2 Add validated folder/page compatibility references when folder navigation is enabled; verify imported per-page resource IDs round-trip without becoming canonical profile IDs and cyclic/missing references remain inactive.
- [ ] 4.3 Add optional app association metadata and handoff to the monitor runtime; verify absent runtime never triggers profile changes and document device-serial scoping.

## 5. Integration close-out

- [ ] 5.1 Run the profile/key/knob/display integration scenarios and repository gates; verify source plus test/evidence paths are attached to each completed issue, openspec validate --all passes, and pending hardware or product decisions remain open.

## 6. PR81 review fixes

- [x] 6.1 Reuse dispatch function validation during import inspection to diagnose and quarantine identifier/visual mismatches; regress the exact hotkey childrenName mismatch. Correct the localized title-style disclosure, selected Function label and readable move/swap destinations. Verify EN/DE rendered labels, six repository gates and hidden mock Keys/media smokes. Bead `open-quake-jy0.17`; MGMT-061/070/073/074/258/261.

PR81 fix-round evidence lives in `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/key-grid-editor/fix1/`. `profile-editor-scenarios.test.ts` adds four import/dispatch regressions, including valid hotkeys with `childrenName: timer` and `childrenName: text`, alternate visuals, and actual dispatch projection. `editor-labels.test.ts` adds two EN/DE rendering regressions. Three import checks and both label tests failed before the fix. `smoke-geometry.ts` verifies all three labels in each locale and diagnosed mismatch quarantine through the mounted editor, retaining its 16 geometry/page/import scenarios. Screenshots are `editor-geometry-en.png` and `editor-geometry-de.png` and were visually inspected.

`git show origin/main:<file>` at `a529b80` confirmed that the malformed title-style disclosure and raw selected Function ID pre-existed on main. Raw move/swap coordinates came from PR81. Function labels reuse the bundled DK-Suite 0.4.95 `hotkey` translations, `Hotkey` and `Tastenkürzel`. Dedicated title-style and destination strings use the same eight-language dictionary.

Delivery gates passed: 2,905 tests with four existing skips, six typecheck tasks, build, both bundle smoke modes, 46 strict OpenSpec items, and Biome across 1,158 files with 14 existing CSS warnings and no errors. Tests ran with scratch `TMPDIR`, Turbo `--env-mode=loose --concurrency=1` and Vitest `--maxWorkers=2`, retaining the default timeout after a concurrent profile-manager timeout. Hidden mock geometry and media fixtures passed, including synthetic touch and five built-in-like profiles. An exploratory full Keys smoke stopped in its unrelated icon-reset fixture before the targeted geometry probe; this round claims the targeted Keys and required media fixtures, not full icon acceptance. All launch artifacts and failure logs remain outside git. No real QUAKE or DK-Suite access.

- [x] 6.2 Inspect and import with the desktop composed function contracts. Verify homeAssistant, clawbot, quakeBot and quakeBotInput survive import and dispatch, invalid integration configurations are quarantined, and unknown functions remain inert. Bead `open-quake-jy0.19`; review 4376109485, MGMT-073/074.
PR81 round 2 import evidence: `registration.test.ts` has five IPC/import/dispatch scenarios. All four supported integrations failed before the fix; unknown functions stayed quarantined. Inspection and persistence now share the composed management contracts, including renderer identity and config validation. Home Assistant also reaches the mocked KeyRuntime owner. Focused 21 registration tests, 473 device tests, both package typechecks and scoped Biome pass. Full package and repository results are recorded with task 6.3. External logs: `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/key-grid-editor/r2/`.

- [x] 6.3 Compare the full native Keys smoke against main with the navigation selector corrected. Record the verdict under external scratch, fix the product or stale expectations without weakening assertions, and pass the full mock smoke and repository gates. Bead `open-quake-jy0.20`.


PR81 round 2 smoke evidence: main `8e4172e` was built in a disposable external worktree with only the two Keys navigation entry selectors patched. Its unchanged icon fixture passed reset/Save, retained source protection, viewport/search and raster Save before a later null-selector failure. The branch also passed the full smoke with only those navigation corrections. The historical icon timeout could not be reproduced on either fresh build; its exact cause remains unverified, so no product change was justified. Final smoke helpers use route attributes and wait for options, selection completion and the mounted hotkeySwitch editor. Save-success, busy-state, persistence and dispatch assertions are unchanged. Both full branch runs passed end to end without a probe filter. Comparison patch, logs, screenshots and `VERDICT.md` are under `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/key-grid-editor/r2/`.

Round 2 final gates: 2,910 tests passed with four existing skips across 306 passing files and two skipped files; all six typecheck tasks; Biome 1,158 files with 14 existing CSS warnings and no errors; build; both default/mock bundle modes; and all 46 strict OpenSpec items passed. Full tests used external TMPDIR, loose Turbo environment, one package at a time and Vitest `--maxWorkers=2`. Native windows stayed hidden with the existing external launcher. The fixtures still log missing unrelated settings/agent/weather IPC handlers, so this proves the complete Keys smoke, not console-clean application startup. The temporary main worktree was removed, owned Electron processes exited, and created build output was removed after verification. No hardware/DK-Suite access, merge or thread resolution.

## Lane W2 verification evidence

Tasks 1.1–1.5 are implemented in `packages/device/src/profiles/` and
`apps/desktop/src/main/profiles/`. The module README documents composition and
scope. `profile-contracts.test.ts` covers every common key/title field;
`profile-invariants.test.ts` provides fast-check occupancy/move/swap coverage;
`profile-service.test.ts` covers concurrent revisions, full-snapshot
publication, catalog identity, scrubbed causes, and restart through the real
desktop adapter. `local-profile-storage.test.ts` injects primary/backup write
and rename failures and exercises seeding and corruption recovery. Repository
gate results and the source commit accompany the lane PR. The parent records
these references on `open-quake-jy0.1` through `open-quake-jy0.5`; this lane does
not run Beads commands. Hardware mapping and tasks 2–5 remain open.

PR #12 review round 2 adds `profile-json.test.ts` and
`profile-json-integration.test.ts`. Both JSON Schemas preserve own reserved
property names in null-prototype records, including compatibility payloads,
action values, subactions, and knob config. Coverage includes arbitrary JSON,
snapshot detachment and freezing, unrelated saves through the real desktop
adapter, fresh-service reload, dispatch exclusion, and typed rejection of
non-JSON values before writing. Verification after merging `origin/main`
`b530a61`: `pnpm install`, `pnpm install --frozen-lockfile`, `pnpm run lint`,
`pnpm run typecheck` (6 tasks), `pnpm run test` (427 passing tests, 2 unchanged
package suites from Turbo cache), `pnpm run build`,
`node apps/desktop/src/main/test/bundle-smoke.mjs`, and
`openspec validate --all` (27 changes) passed. No dependencies were added and
the lockfile matches main. This strengthens tasks 1.2, 1.4 and 1.5 without
completing the import workflow in task 2.4 or hardware verification.

## Editor completion evidence, 2026-10-26

- 2.2, open-quake-jy0.7: `packages/device/src/profiles/key-geometry.ts`, `key-editing-service.ts`, and `apps/desktop/src/renderer/src/keys/KeyGeometryControls.tsx` wire coordinate-only move/swap, inward spans, forced sizes and all five locks. `profile-editor-scenarios.test.ts` covers locked swaps, covered-key locks, unconfirmed Save refusal, cancellation and confirmed replacement. Audit rows MGMT-061/062/063/070/073/074/076.
- 2.3, open-quake-jy0.8: `profile-pages.ts`, `profile-service.ts`, typed `shared/key-library.ts` commands and `KeyPageControls.tsx` add/remove pages, repair all affected selections, refuse the last deletion and retain nested knob data. Previous/next wrap and go-to clamps, superseding the original wording per `key-library-parity`, MAIN-077/078.
- 2.4, open-quake-jy0.9: `profile-import.ts` and `KeyImport.tsx` inspect JSON files/pasted profiles or legacy key arrays, report paths for unknown functions, missing optional fields and legacy sentinels, reject invalid required fields and import only on explicit confirmation. Unsupported camera JSON survives unrelated Save and is absent from dispatch. Format documented in `packages/device/src/profiles/README.md`.
- Consumer evidence for these paths of 5.1, open-quake-jy0.16: `apps/desktop/src/main/key-library/registration.test.ts` exercises authorized typed requests and unauthorized panel requests. `smoke-geometry.ts` drives 16 mounted editor/preload/main scenarios, with English/German geometry and import screenshots in `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/key-grid-editor/native/`. The required media smoke also passes, including synthetic touch through the mounted panel.
- Gate logs are in `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/key-grid-editor/`. Full tests use `TMPDIR` there with Turbo `--env-mode=loose` and `--maxWorkers=2`, preserving assertions and the default timeout. Default concurrency hit existing five-second timeouts; strict Turbo strips `TMPDIR`, which causes existing symlink-sensitive storage tests to reject macOS temporary paths.
- Final repository gates: 2,899 tests passed, four existing skips; 31 editor scenario tests and 16 typed registration tests passed. Biome checked 1,156 files with 14 existing CSS warnings and no errors; all six typecheck tasks, build, both bundle modes and all 46 strict OpenSpec items passed. Native fixtures log missing unrelated settings/agent handlers, so this is feature-path evidence rather than a console-clean root acceptance claim.
- Leave jy0.7/.8/.9 open for the lead to close after merge. Task 5.1 remains unchecked for device delivery, folders and broader integration; physical acceptance remains unverified. No real QUAKE or DK-Suite access.

## Grid-editor burn-down lane

- [x] Implement grid-editor import overflow recovery and canonical replacement/swap checks with tests. Beads open-quake-lih.10.7/.9.

Lane evidence: 45 mounted editor regressions in `key-editor-interactions.test.tsx`, four canonical placement/overflow regressions in `profile-grid-placement.test.ts`, and the hidden mock native `smoke-geometry.ts` scenarios cover the new rows. Native checks include English/German replacement, 680px multi-action and knob layouts, folder entry and Space activation of vivid configuration. The full media smoke passes after scrolling the new editor layout into view before its visibility-gated OBS assertion. No hardware, microphone or audible audio was used. Gate totals and all 25 spec/code/test mappings accompany the lane PR.
