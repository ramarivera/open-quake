# Profile contracts and local persistence

This module implements `openspec/changes/profiles-key-grid` tasks 1.1–1.5.
Logical coordinates are one-based `row,col` on a 2×8 grid. The profile knob
uses `0,1` outside page keys. Physical HID mapping remains unverified.

`profile-contracts.ts` owns the version-1 envelope, profile, page, key, title,
edit-policy, and selection Schemas. Decode JSON before using it. Optional
fields become `Option`; absent support flags become false and absent edit
flags permit editing. `Schema.encode` omits absent optional values. Composite
records can supply `subActions` without leaf `actions`; their decoded leaf
array is empty. Function-defined values remain JSON data until their registry
validates them. Knob configuration is retained as JSON for the knob domain to
validate, with no dispatch in this module.

`ProfileJson` and `ProfileJsonObject` decode and encode JSON objects into
detached records with null prototypes. Own keys such as `__proto__`,
`constructor`, and `prototype` remain data at every nesting level, including
action values, knob config, subactions, and compatibility payloads. They never
set object inheritance. Unsupported import payloads survive unrelated saves
and restart without gaining runtime meaning. Non-JSON values still fail
Schema validation and become `ProfileValidationFailed` at the repository.

`profile-invariants.ts` derives occupancy from `profile-footprint.ts`: forced
spans per tile type override `[width,height]`, and spans that would run past
column 8 or row 2 grow inward (strip-key-grid, parity decision 2). It rejects
duplicate anchors, invalid anchors, visible overlaps, and executable empty
placeholders. Covered placeholders do not claim a second occupied
cell. `moveOrSwapProfileKeys` preserves configuration objects, rejects drag
locks, and returns a result without changing its input. The editor and the
other four edit-lock operations remain task 2.2.

`ProfileRepository` is an Effect service over the `ProfileStorage` port.
`ProfileService` declares the repository dependency; the repository declares
`ProfileFunctionContracts`. Its named methods are `loadProfiles`, `getProfile`,
`saveProfile`, `subscribeCommittedProfiles`, and `subscribeDispatchProfiles`.
Save requests contain `expectedRevision` and an encoded `profile` draft
without `revision`.
The repository serializes the revision check, full draft decoding, function
validation, atomic write, and complete snapshot publication under one semaphore.
Only the profile ID and expected revision are decoded before checking the
stored revision. A stale save returns `ProfileRevisionConflict` even when its
draft is malformed or its function values are invalid. The committed revision
increments once, and failed writes or stale saves publish nothing. Snapshots are detached
and deeply frozen so callers cannot mutate committed dispatch state.

Compose one repository instance per local store in desktop main:

```ts
const repository = ProfileRepository.DefaultWithoutDependencies.pipe(
  Layer.provide(Layer.merge(
    desktopProfileStorageLayer(profileFilePath),
    profileFunctionContractsLayer(functionContracts),
  )),
)
const profiles = ProfileService.DefaultWithoutDependencies.pipe(
  Layer.provide(repository),
)
```

The desktop adapter is `apps/desktop/src/main/profiles/local-profile-storage.ts`.
It writes a unique same-directory temporary file, saves the previous valid
envelope as an atomically written `.bak` copy, then renames the new temporary
file over the primary. It seeds one local profile and one empty page on first
launch. On corruption it preserves the primary verbatim in `.corrupt.<id>`,
restores a valid backup when available, or seeds while retaining invalid data.
Recovery reasons are available on the adapter's `recoveries` collection.
The repository reports invalid device selections in `repairedSelections` and
persists their fallback to the first profile and page before publication.
Selection repair collects own entries in a `Map`. The envelope Schema rejects
the serial `__proto__` before Effect's record decoder can invoke the plain-object
prototype setter. `constructor` and `prototype` are valid own serial keys and
survive repair and encoding.
An unreadable primary, such as a permission failure, never triggers seeding.
Atomic rename prevents partially written JSON; power-loss durability and
multiple independent processes writing the same file are not claimed.

`ProfileFunctionContracts` defaults to an empty registry. The actions lane
supplies validators and support declarations through
`profileFunctionContractsLayer`. New unknown functions are rejected.
Records marked `compatibility.unsupported:true` remain inert data, including
their original payloads. Registry availability never executes a function.

`loadProfiles`, `getProfile`, save results, and `subscribeCommittedProfiles`
retain the complete stored records for editing and rendering. These envelopes
are not dispatch input. Stored functions can be missing from the current
registry or fail its current validators without losing their original data.
Dispatch consumers must use `subscribeDispatchProfiles`, which derives a
detached, frozen envelope from each complete committed revision. Its page keys
include only visible, nonempty, supported records accepted by the current
registry, including function values and support declarations. Unknown types,
invalid function values, throwing validators, and explicitly unsupported
compatibility records are excluded. Filtering never writes the projection to
storage or changes a revision. Knob configuration remains opaque and must be
validated by its owning domain before execution.

This is the fail-closed boundary for tasks 1.1–1.5. Automatic conversion of
unknown imports to flagged compatibility records, import diagnostics, and
normalization of legacy sentinels remain task 2.4. Stored unknown keys cannot
execute through the dispatch subscription while that task is pending. An
unrelated save containing an unflagged unknown key still fails validation;
task 2.4 will provide the import path that preserves it as explicitly inert.

Window IPC, real action dispatch, import normalization, and knob validation
remain their owning tasks. The desktop adapter imports this module directly
to keep this lane inside its assigned paths without changing manifests.

Verification lives beside the implementation:

- `profile-contracts.test.ts` covers every common key/title field, nested
  round trips, optional/default behavior, and invalid fixtures.
- `profile-json.test.ts` property-tests arbitrary JSON and nested reserved
  keys through both JSON Schemas. `profile-json-integration.test.ts` checks
  preservation through snapshots, disk and restart, dispatch exclusion, and
  catalog validation failure before persistence.
- `profile-invariants.test.ts` uses fast-check through Effect to exercise
  coordinates, spans, anchor uniqueness, overlap, empty cells, and moves/swaps.
- `profile-service.test.ts` tests concurrent revision-4 saves, delayed and
  failed publication, frozen snapshots, field paths, error identity and cause
  privacy, invalid-selection repair, inert imports, and restart through the
  real desktop adapter.
- `profile-review.test.ts` checks validation/conflict priority in both save
  orders and during a pending write, plus stored-key filtering at the dispatch
  subscription. `profile-repository.test.ts` property-tests reserved serials,
  own entries, schema rejection, and round trips.
- The desktop adapter tests use real temporary directories and inject primary
  and backup write/rename failures, corruption, and permission failures.

Only tasks 1.1–1.5 may be closed from this evidence. Editor/window delivery,
page navigation commands, physical mapping, device delivery, and later profile
features remain open.
