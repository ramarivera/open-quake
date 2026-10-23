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

`profile-invariants.ts` derives occupancy from anchors and `[width,height]`,
rejects duplicate anchors, off-grid spans, visible overlaps, and executable
empty placeholders. Covered placeholders do not claim a second occupied
cell. `moveOrSwapProfileKeys` preserves configuration objects, rejects drag
locks, and returns a result without changing its input. The editor and the
other four edit-lock operations remain task 2.2.

`ProfileRepository` is an Effect service over the `ProfileStorage` port.
`ProfileService` declares the repository and `ProfileFunctionContracts`
dependencies. Its named methods are `loadProfiles`, `getProfile`,
`saveProfile`, and `subscribeCommittedProfiles`. Save requests contain
`expectedRevision` and an encoded `profile` draft without `revision`.
The repository serializes the revision check, atomic write, and complete
snapshot publication under one semaphore. The committed revision increments
once, and failed writes or stale saves publish nothing. Snapshots are detached
and deeply frozen so callers cannot mutate committed dispatch state.

Compose one repository instance per local store in desktop main:

```ts
const dependencies = Layer.merge(
  ProfileRepository.Default.pipe(
    Layer.provide(desktopProfileStorageLayer(profileFilePath)),
  ),
  profileFunctionContractsLayer(functionContracts),
)
const profiles = ProfileService.DefaultWithoutDependencies.pipe(
  Layer.provide(dependencies),
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
An unreadable primary, such as a permission failure, never triggers seeding.
Atomic rename prevents partially written JSON; power-loss durability and
multiple independent processes writing the same file are not claimed.

`ProfileFunctionContracts` defaults to an empty registry. The actions lane
supplies validators and support declarations through
`profileFunctionContractsLayer`. New unknown functions are rejected.
Records marked `compatibility.unsupported:true` remain inert data, including
their original payloads. Registry availability never executes a function.
Window IPC, real action dispatch, import normalization, and knob validation
remain their owning tasks. The desktop adapter imports this module directly
to keep this lane inside its assigned paths without changing manifests.

Verification lives beside the implementation:

- `profile-contracts.test.ts` covers every common key/title field, nested
  round trips, optional/default behavior, and invalid fixtures.
- `profile-invariants.test.ts` uses fast-check through Effect to exercise
  coordinates, spans, anchor uniqueness, overlap, empty cells, and moves/swaps.
- `profile-service.test.ts` tests concurrent revision-4 saves, delayed and
  failed publication, frozen snapshots, field paths, error identity and cause
  privacy, invalid-selection repair, inert imports, and restart through the
  real desktop adapter.
- The desktop adapter tests use real temporary directories and inject primary
  and backup write/rename failures, corruption, and permission failures.

Only tasks 1.1–1.5 may be closed from this evidence. Editor/window delivery,
page navigation commands, physical mapping, device delivery, and later profile
features remain open.
