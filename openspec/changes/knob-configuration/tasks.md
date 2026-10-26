# Tasks

Create parent-owned Beads epic and one issue per checkbox, each linking this directory. First-release profile contracts and registry descriptors are dependencies; voice runtime implementation belongs to the voice lane.

## 1. First-release contracts and persistence

- [x] 1.1 Record Ramiro's decisions on stable slot sentinels, focus precedence, panel brightness target/step, and direct-route defaults; verify design.md still identifies unverified physical direction and target details.
- [x] 1.2 Add knob and route Schemas plus pure slot/route migrations in packages/device; verify right-only slot round-trip, duplicate rejection, model-reference migration, route field stripping, and normalization idempotence.
- [x] 1.3 Connect profile-scoped knob saves and the three-slot desktop editor to the profile conductor; verify edits preserve unrelated keys, page changes preserve the knob, and switching profiles discards old editor state.
- [x] 1.4 Add compatibility handling for known center presets and ambiguous compact arrays; verify explicit holes survive and ambiguous left/right data stays preserved but inactive, and document supported import shapes.

## 2. First-release rotation and navigation

- [ ] 2.1 Agree normalized rotate/detent/press/holdStart/release/session events with L1 and voice lanes; verify a written integration contract defines who classifies holds without changing L1 codecs here.
- [x] 2.2 Implement the knob conductor and single-route event precedence with catalog errors; verify focused-key priority, one route per detent, empty-slot no-op, and old-session rejection through the actual dispatch consumer.
- [ ] 2.3 Register canonical previousPage/nextPage/goToPage assignments and narrow pageUp/pageDown imports; verify page boundaries, invalid targets, and no cross-profile side effects using the profile selection consumer.
- [ ] 2.4 Qualify a panel-only brightness adapter and native-to-percent conversion with L1/desktop evidence, then implement clamped steps; verify 98 plus 5 yields 100, unknown current value writes nothing, and unrelated monitor/RGB values do not change; document target limitations.

## 3. First-release direct voice configuration handoff

- [x] 3.1 Add the direct provider/model editor and completeness checks without embedding credentials; verify missing model disables capture and route changes retain only allowed fields.
- [ ] 3.2 Compose the voice lane's capture capability and session cleanup into knob dispatch; verify one hold starts once, release ends once, profile change/disconnect cancels, and a consumed hold cannot also fire a short press; document the handoff.
- [ ] 3.3 Exercise real QUAKE rotation, brightness, page changes, and hold/release with the qualified voice runtime when hardware is available; verify firmware/session traces and visible/voice outcomes are attached, keeping hardware tasks open when unavailable.

## 4. Later route compatibility

- [ ] 4.1 Integrate dkclaw and legacyAssistant only after their runtime owners register capabilities; verify absent runtimes remain unavailable, imported route locks cannot override new custom profiles, and credentials stay outside profiles.

## 5. Integration close-out

- [ ] 5.1 Run knob/profile/action/voice integration scenarios and repository gates; verify saved configuration, runtime traces, diagnostic scrubbing, OpenSpec validation, and explicitly unresolved hardware/route evidence before closing issues.

## W4 implementation evidence

- 1.1: approval record reconciled in proposal/design/spec; `openspec validate knob-configuration` passes. Hardware direction, panel target/native range/readback, and hold timing remain unverified.
- 1.2 and 1.4: `packages/device/src/knob/knob-contracts.ts`, `knob-invariants.ts`, and `knob-voice-migration.ts`; property/fixture evidence in `packages/device/test/knob/knob-contracts.test.ts`. Supported import shapes and compatibility retention are documented in `packages/device/src/knob/README.md`.
- 2.1 contract side: `KnobSession`, `KnobEvent`, `KnobSnapshot`, and `KnobDispatchCommand` plus the written normalized integration contract in the module README. The checkbox remains open pending L1/voice adapter agreement and verification. No protocol files changed.
- 2.2: `packages/device/src/knob/knob-service.ts`, routing invariants, module-local catalog leaves, and registry validation. `packages/device/test/knob/knob-service.test.ts` drives the dispatch callback and proves focused precedence, one route per detent, empty no-op, short-release classification, stale ownership, and scrubbed dependency failures. Ports fail closed until the composition root supplies adapters.

Profile/editor saves (1.3), navigation/profile integration (2.3), panel qualification (2.4), voice runtime work, hardware checks, and cross-lane integration remain open. Beads are parent-owned; this lane does not run bd.

W4 gates: `pnpm install` passed with unchanged lockfile; `pnpm run lint` passed, 79 files; `pnpm run typecheck` passed, 6 tasks with 5 cache hits; `pnpm run test` passed, device 76 tests including 40 knob tests, protocol 25 and desktop 87 from unchanged-package cache hits. `openspec validate knob-configuration` passed; `openspec validate --all` passed, 28 changes; `git diff --check` passed. Desktop was untouched, so the conditional desktop build gate was not required.

## Knob-model parity reconciliation

Physical idle slot dispatch from historical task 2.2 is superseded by approved GAP-MAP decision 1. Implementation and current evidence live in openspec/changes/knob-model-parity/ under open-quake-lih.4.1. Historical W4 evidence describes the earlier policy. Hardware tasks remain open.

Backend continuation under knob-model-parity task 5.1 / open-quake-lih.4.2 adds
device-specific knob contexts, canonical manager-owned thumbnail production and
read-only volume observations. It does not complete this change's editor, page
assignment, monitor/hotkey, qualified voice, or physical acceptance tasks. Their
checkboxes remain unchanged. See knob-model-parity/design.md and the desktop knob
README for the parent composition contract and verification limits.

## Knob route lane evidence, 2026-10-26

Tasks 1.3 and 3.1 are implemented by `KnobEditor.tsx`, `knob-draft.ts`,
`knob-profile.ts` and the decoded `save-knob` IPC consumer. Profile save and
registration tests prove unrelated keys and pages survive revision-checked
saves. Hidden mock Electron acceptance exercises three slots, page draft
retention, profile draft discard, reviewed direct migration, provider/model
reset and missing credentials. Audit KNOB-024/027/035/036/037/038.

Beads open-quake-a74.3 and open-quake-a74.9 remain in progress for the lead to
close after merge. This evidence supersedes the earlier W4 editor gap only.
Hardware, brightness qualification, other slot types and later routes remain
outside this lane. Screenshots and native smoke scripts stay in
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/knob-route/`.

Delivery gates: Biome checked 1,155 files with zero errors and 14 existing
CSS warnings; typecheck passed 6 tasks; tests passed 2,893 with 4 skipped
across device 444, edge 669, protocol 63 and desktop 1,717. The suite used
`TMPDIR` in the lane scratch directory with
`pnpm test --env-mode=loose --concurrency=1 -- --maxWorkers=2` to pass that
directory through Turbo and avoid concurrent-lane CPU contention. No test
assertion or deadline changed. Production build, both bundle smoke modes and
strict OpenSpec validation passed. Hidden mock native acceptance produced
`delivery-screenshots/knob-{migration-preview,missing-credentials,saved-wide,saved-narrow}.png`
under the lane scratch directory. Its scratch-built entry explicitly sets the
production renderer URL and disables macOS app activation. No hardware IO.

## PR84 fix1

- [x] 6.1 Refuse knob saves while a grid key editor is open, explain how to save and close that editor, and retain the key draft without advancing its revision. Bead open-quake-a74.14, review 4376058979. Main IPC independently rejects same-profile pending drafts under its existing request lock. Registration and renderer regressions failed before the fix; they verify the unchanged revision, successful key save with the original target/title, and subsequent knob save. An extended hidden native regression also reproduced a stale knob revision after saving and closing the key editor. The knob editor now uses the latest revision only when committed knob content is unchanged, preserving its unsaved slot draft and retaining conflicts for concurrent knob changes.

- [x] 6.2 Share configured default/fallback model selection between the knob editor and production model resolution. Bead open-quake-a74.15, review 4376059141. The extracted readiness check reproduced role `none` reporting ready while the actual `pinKnobModel` rejected it. `knob-model-readiness.test.ts` verifies readiness and production pinning agree for `none`, `default` and `fallback`, using synthetic credentials without opening capture or sending inference requests.

Fix1 final gates on all functional changes: Biome checked 1,157 files with no errors and 14 existing CSS warnings; typecheck passed all 6 tasks; tests passed 2,904 with 4 skipped across desktop 1,728, device 444, edge 669 and protocol 63. Tests used `pnpm test --env-mode=loose --concurrency=1 -- --maxWorkers=2` with external-drive TMPDIR. Production build, both bundle modes and strict OpenSpec validation of 46 items passed. Hidden mock Electron acceptance verified the visible key-edit explanation, role-none exclusion, save-key/close/save-knob flow and preservation of an unsaved knob-slot change, plus wide/narrow screenshots. Build output and scratch-only module links were external to the checkout and are removed after verification; logs/screenshots remain under `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/knob-route/fix1/`. No real microphone, QUAKE or DK-Suite used. The original three review findings and two follow-up bot findings were addressed without resolving threads; the existing imported-route info thread was untouched.

## Agents burn-down lane, 2026-10-26

- [x] A.1 Expose DK Claw agent/model selectors with Default Agent and Default (Agent) fallbacks and persist typed payloads. Source MGMT-306; bead `open-quake-lih.17.12`; `KnobEditor.tsx`, shared `AgentRouteFields.tsx`, mounted `key-editor-interactions.test.tsx`. Real microphone/device activation remains unverified.
