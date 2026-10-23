# Tasks

Completed checkboxes record implemented and verified work. The parent maintains one epic for this change and one issue per checkbox, using the task text and verification as its description and linking this OpenSpec path. Do not close implementation issues from spec validation alone.

## 1. First-release contracts and local persistence

- [x] 1.1 Record Ramiro's decisions on the proposed envelope, logical row,col map, page boundaries, and import policy in design.md; verify the decision record distinguishes accepted policy from remaining physical evidence gaps.
- [x] 1.2 Add profile/page/key/title/edit-policy Schemas and the 2x8 logical descriptor in packages/device; verify round-trip and rejection fixtures cover every field in the common key and title schema tables.
- [x] 1.3 Add pure occupancy, anchor uniqueness, coordinate, span, and empty-cell invariants; verify property tests reject off-grid/overlapping layouts and preserve move/swap configuration.
- [x] 1.4 Add the profile repository interface and desktop atomic local adapter, with first-launch seeding and backup behavior; verify save/restart preserves nested values and injected write failure leaves the previous envelope readable.
- [x] 1.5 Add the profile conductor with expected revisions, distinct catalog errors, and named methods; verify two concurrent revision-4 saves produce one revision 5 and one conflict, with scrubbed diagnostics and no partial publication.

## 2. First-release editor and page selection

- [ ] 2.1 Add typed preload commands/events and full-snapshot synchronization to both windows; verify a saved revision reaches the real panel and management consumers and the old draft-only path cannot affect dispatch.
- [ ] 2.2 Add assign/replace/remove/move/swap/span/title/artwork editing with all five edit locks; verify the locked-swap, overlap-confirmation, and move-preserves-configuration scenarios through the editor.
- [ ] 2.3 Add page creation, selection, clamped previous/next, explicit go-to validation, and safe removal; verify boundary and last-page scenarios plus knob retention across page changes.
- [ ] 2.4 Add inert compatibility records and import diagnostics for unknown types, missing optional fields, and legacy sentinels; verify an unsupported camera record survives an unrelated save without runtime calls and document the import format.
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
