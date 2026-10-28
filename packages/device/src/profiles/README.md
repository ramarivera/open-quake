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
cell. `moveOrSwapProfileKeys` preserves configuration objects and rejects
displacement of structurally protected targets without changing its input.

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

The Keys editor imports one canonical profile object or one legacy flat key array, including knob `0,1`. The user chooses a JSON file or pastes JSON, inspects the report, then explicitly imports a new local profile. Fresh profile/page IDs keep the source identifiers separate in compatibility data. The complete source JSON remains inert in `profile.compatibility.source` and each key's `compatibility.source`. Unknown functions and invalid registered actions receive `unsupported:true` and never enter dispatch. Invalid required fields block import. Missing optional fields and normalized null/empty-action sentinels produce field-path diagnostics. No DK-Suite storage or hardware is accessed.

Inspection and dispatch share `profileKeyFunctionIssues` and the caller-provided function contracts, including `childrenName` and alternate-visual validation. The desktop supplies `managementProfileContracts` to both inspection and import so supported Home Assistant and agent keys remain dispatchable. Device-only callers default to the action contracts. A mismatch reports its field path as `invalid-action` and marks the retained key unsupported. Raw action validation also runs before schema normalization so unsupported action fields cannot disappear before inspection.

The typed Keys boundary adds `preview.geometry` for move/swap and confirmed span replacement, `add-page`/`delete-page` with expected revision, and `inspect-import`/`import-profile`. Preview does not persist. Save commits the complete page once; failed or unconfirmed edits cannot save a stale preview. Title, icon and move edits ignore saved DK-Suite locks. Structural targets cannot be replaced or displaced, including through covered cells. Page creation selects the new page for the requesting device; deletion repairs all affected selections atomically while retaining the profile knob. Previous/next wrap and explicit go-to clamps, as specified in `key-library-parity`.

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

`profile-editor-scenarios.test.ts` covers geometry, saved-lock overrides, structural protection, replacement confirmation, page repair, diagnosed imports and dispatch exclusion. Desktop `key-library/registration.test.ts` drives typed IPC authority and mutation paths. `key-library/smoke-geometry.ts` drives mounted editor controls through preload/main with hidden mock windows and records English/German screenshots. Run its existing smoke entry with `OPEN_QUAKE_KEY_REVIEW_PROBE=geometry-pages-import`.

Physical mapping, device delivery, folders and broader profile/knob/display integration remain separate acceptance work.

## Editing policy

`key-edit-policy.ts` owns the policy consumed by the real editing service,
geometry and renderer. Every key permits title, icon and move/swap edits.
Stored `basicEditableItems.title`, `icon` and `allowDrag` flags are ignored,
including after reload. Flags remain in the file as compatibility data;
there's no migration. Ordinary keys, including every Quick control and the
shared microphone action, also ignore stored resize/delete restrictions.

The remaining restrictions protect structure:

- Vivid's `colorfulScreen` draws the entire panel. Its footprint is always
  8 by 2, and resize, removal and replacement are forbidden. Moving its anchor
  is allowed and preserves the full-screen display.
- Fixed-span widgets in `FORCED_TILE_SPANS` cannot resize. Their renderers and
  nested touch controls use those dimensions. This includes the full-screen
  `dkDesktopClock`, player, system monitor and composite AI/camera/OBS tiles.
  Stored deletion locks still apply to these composite widgets. The shipped
  clock's delete lock preserves its full-screen settings and media host.
- Dedicated MeetAI controls `meetingMinutes`, `tempMeetingMinutes`,
  `meetingRecordMark` and `liveAudioTranslate` retain stored grid/delete locks.
  `MeetingKey.tsx` renders the Start timer/status and workflow controls as a
  composed meeting panel. `liveAudioTranslateDisplay` also retains structural
  flags for its nested transcript controls. The shared `mic` action is a
  standalone action and doesn't retain these locks.
- `back`, `emojiBack`, `functionwheel` and `colorfulScreenSettings` remain
  undeletable even when a stored policy permits deletion. They own navigation
  or settings entry points. Moving and customizing them is allowed.

A key is a protected destination when resize or delete is structurally locked.
Its owner can move it to free space, but another key cannot swap it out,
replace it or remove it through a resized footprint, even after confirmation.
The main process returns `structural-key-locked`; the editor explains the
protection. Normal bounds, equal-span swap and overlap checks still apply.
