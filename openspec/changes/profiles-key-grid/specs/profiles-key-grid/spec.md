# Spec Delta

## Purpose

Define local profiles and editable QUAKE key grids so saved layouts, panel rendering, and action dispatch use the same validated revision.

Approved (Ramiro, 2026-10-23): the recommendations in `design.md` are the implementation contract. Sections marked later phase do not expand the first-release cut.

## ADDED Requirements

### Requirement: Versioned local profile model

The system SHALL store `schemaVersion:1`, an ordered nonempty `profiles` array, and `activeByDevice` selections. Each profile SHALL contain nonempty stable string `id`, nonblank string `name`, nonnegative integer `revision`, nonempty ordered `pages`, and optional `knob`. Each page SHALL contain nonempty stable string `id` and a flat `keys` array. IDs SHALL be unique within their owning collection. Each device selection SHALL contain existing `profileId` and `pageId`. Profile names SHALL NOT be used as IDs. Optional compatibility metadata SHALL retain legacy resource identifiers separately from canonical identity.

#### Scenario: First local launch

- **WHEN** no valid local envelope exists on first launch
- **THEN** the system creates one editable profile with one page and revision 0 without requesting a DecoKee account

#### Scenario: Invalid active reference

- **WHEN** a stored selection references a missing profile or page
- **THEN** the system reports the invalid selection and selects the first valid profile and its first page without deleting profile data

### Requirement: Common key record schema

Every newly saved grid key SHALL satisfy the following schema. Optional fields SHALL be omitted when absent; raw null SHALL NOT be emitted. Recognized legacy extensions SHALL remain in compatibility data unless their owning capability validates them.

| Field | Required type and behavior |
|---|---|
| `keyCode` | Required canonical decimal string `row,col`; each coordinate is a positive integer within the logical descriptor, without spaces or leading zeros |
| `childrenName` | Optional string catalog identifier; required for nonempty newly authored keys, omitted for empty placeholders |
| `config` | Required object |
| `config.type` | Required string discriminator; `''` means an empty placeholder, otherwise a registered function or preserved unsupported import |
| `config.title` | Required title object as specified below |
| `config.size` | Required tuple `[width,height]` of positive integers in grid-cell units, constrained to fit the descriptor |
| `config.display` | Required boolean controlling tile visibility; false also prevents direct tile activation |
| `config.supportKnob` | Optional boolean, normalized to false when absent; true requires a function whose registry permits focused knob control |
| `config.supportTouchEffect` | Optional boolean, normalized to false; controls touch feedback, not permission to execute |
| `config.icon` | Required string artwork reference, empty string for no artwork; resource IDs, imported data URLs, and local references are decoded by the artwork adapter, not executed |
| `config.alterTitle` | Optional complete title object for a registered two-state function |
| `config.alterIcon` | Optional string artwork reference for that alternate state |
| `config.actions` | Ordered array of `{type:string,value:<function-defined JSON value>}`; required for leaf keys, empty for empty placeholders; no arbitrary unvalidated JSON value is executable |
| `config.subActions` | Optional ordered nested entries for a registered composite or knob; a composite uses this field instead of leaf actions; knob schema is governed by `knob-configuration` |
| `config.basicEditableItems` | Optional edit-policy object with optional boolean fields `title`, `grid`, `icon`, `allowDelete`, `allowDrag`; absent flags permit that edit |
| Compatibility extensions | Fields such as `defaultIcon`, `animations`, `hasTouchableSubElements`, `gap`, and `pressTime` SHALL round-trip for recognized imports but SHALL NOT gain runtime meaning without the owning registry schema |

#### Scenario: Complete key round trip

- **WHEN** a key with both title variants, both artwork references, span `[2,1]`, support flags, typed actions, and all five edit flags is saved and reloaded
- **THEN** every field retains its value and action order and no optional field becomes raw null

#### Scenario: Empty placeholder

- **WHEN** a cell has `config.type:''`, `icon:''`, `actions:[]`, and no childrenName
- **THEN** it is a valid empty cell and activation performs no action

#### Scenario: Malformed executable action

- **WHEN** a new key has an action missing its type or a value rejected by that function's schema
- **THEN** save fails with the field path and leaves the previous saved revision unchanged

### Requirement: Title schema

Each title object SHALL contain `text:string`, `pos:'top'|'bot'`, `size:positive finite number`, `color` as `#RRGGBB` or `#RRGGBBAA`, `display:boolean`, `style:string`, and optional `resourceId` as a nonnegative integer or nonempty resource-reference string. Style SHALL be empty or a pipe-separated sequence of distinct `bold`, `italic`, and `underline` tokens. `title.display` SHALL control the label independently of `config.display`. New empty cells SHALL use text `''`, pos `'bot'`, size 8, color `'#FFFFFF'`, display true, style `'bold|italic|underline'`, and resourceId 0. Unsupported imported title values SHALL produce an import diagnostic rather than an implicit reinterpretation.

#### Scenario: Hidden label on visible tile

- **WHEN** config.display is true and title.display is false
- **THEN** the tile remains visible and activatable while its label is hidden in both panel and preview

#### Scenario: Invalid title tokens

- **WHEN** a new key has size 0, color `'red'`, or style `'bold|blink'`
- **THEN** save rejects each invalid field and retains the last valid title

### Requirement: Logical coordinates and occupied cells

The initial QUAKE descriptor SHALL contain two rows and eight columns using one-based `row,col`; `1,8` SHALL mean row 1 column 8. `0,1` SHALL be reserved for the profile knob outside page keys. A key's occupied cells SHALL come from the shared footprint defined by `strip-key-grid`. Forced spans by type override `config.size`. A span that would run past column 8 or row 2 SHALL grow inward, left or up, from its anchor, as DK-Suite does (approved parity decision 2, Ramiro 2026-10-23; SCREEN-026, SCREEN-027, MGMT-062, MGMT-063). The system SHALL reject duplicate anchors, invalid anchors, and visible overlapping footprints. Covered placeholder cells SHALL NOT execute a separate action. Physical HID controls SHALL activate logical cells only through a separately verified mapping supplied by the device capability.

#### Scenario: Last column and reserved entry

- **WHEN** a page contains a key at `1,8` and the profile has knob code `0,1`
- **THEN** the key occupies the top row's last column and the knob occupies no panel grid cell

#### Scenario: Mapping unavailable

- **WHEN** an unmapped physical key event arrives while logical preview activation is available
- **THEN** the system reports physical mapping unavailable and executes no guessed grid action

#### Scenario: Edge span grows inward

- **WHEN** a `[2,1]` tile is anchored at `1,8` and a `[1,2]` tile at `2,3`
- **THEN** the first occupies `1,7` and `1,8`, the second `1,3` and `2,3`, and neither is rejected as out of bounds

#### Scenario: Forced footprint

- **WHEN** a `dkDesktopClock` key with size `[1,1]` is saved at `1,1` beside a visible hotkey at `2,8`
- **THEN** the save is rejected as an overlap because the clock occupies all sixteen cells

#### Scenario: Span collision

- **WHEN** a `[2,1]` tile anchored at `1,7` would overlap another visible tile at `1,8`
- **THEN** the edit is rejected unless the user explicitly confirms replacement of the overlapping tile

### Requirement: Atomic layout edits and edit locks

The editor SHALL support assign, replace, remove, move to an empty cell, swap two occupied cells, and span editing subject to edit flags. Move and swap SHALL change only coordinates unless a separate explicit edit changes configuration. `grid:false` SHALL reject span changes, `title:false` label edits, `icon:false` artwork edits, `allowDelete:false` removal/replacement, and `allowDrag:false` moves/swaps. A failed edit SHALL leave all affected cells unchanged.

#### Scenario: Move preserves configuration

- **WHEN** a movable hotkey tile moves from `1,1` to empty `2,8`
- **THEN** its title, icon, actions, support flags, and edit policy are unchanged and `1,1` becomes empty

#### Scenario: Locked swap

- **WHEN** a swap targets a tile with allowDrag false
- **THEN** neither tile changes coordinates or configuration

### Requirement: Save and publication use a complete revision

A save SHALL carry the expected profile revision, validate the complete result, atomically persist it, increment its revision once, and publish that complete revision to management, panel, and dispatch consumers. Stale saves SHALL fail as revision conflicts. Drafts SHALL NOT change active dispatch. Device delivery status SHALL remain distinct from local persistence status.

#### Scenario: Concurrent saves

- **WHEN** two editors save against revision 4 and the first succeeds as revision 5
- **THEN** the second receives a revision conflict and cannot overwrite revision 5

#### Scenario: Device offline after save

- **WHEN** a valid layout saves while the device is disconnected
- **THEN** it survives restart, both desktop windows show the saved revision, and delivery remains pending rather than reported as hardware-applied

### Requirement: First-release page navigation

The system SHALL support adding an empty page, selecting a one-based page number, previous page, next page, and removing a page while retaining at least one page. Previous and next SHALL clamp at the first and last page. Explicit go-to requests outside `1..pageCount` SHALL fail without changing selection. Deleting the selected page SHALL choose the page now at its former index, or the last remaining page when that index no longer exists. Profile-scoped knob settings SHALL survive page changes.

#### Scenario: Navigation boundaries

- **WHEN** next-page is activated on page 2 of a two-page profile, then go-to-page 3 is requested
- **THEN** selection stays on page 2 and only the go-to request reports an invalid page

#### Scenario: Delete last page

- **WHEN** the user tries to remove the only remaining page
- **THEN** removal is rejected and keys and knob settings remain intact

### Requirement: Unsupported imports remain inert

The system SHALL retain unsupported imported key records with original identifiers and payloads in compatibility data, display their unsupported status, and refuse their execution. It SHALL NOT silently turn unknown fields into host automation, discard the record on an unrelated save, or execute imported profiles merely by importing them.

#### Scenario: Later function in first-release profile

- **WHEN** an imported page contains a camera key while another cell's title is edited
- **THEN** the camera record survives save and reload, shows unsupported status, and never starts a camera connection

#### Scenario: Reserved JSON property names in compatibility payloads

- **WHEN** an unsupported imported record contains own `__proto__`, `constructor`, or `prototype` JSON properties, including nested objects and arrays, and another field is edited
- **THEN** those properties retain their original JSON values through save, snapshot publication, and reload without changing object inheritance or becoming executable

### Requirement: Later-phase profile CRUD and associations

When multiple-profile support is enabled, the system SHALL support create, rename, deep duplicate, select, and confirmed delete, while retaining at least one profile. Duplicate SHALL allocate new profile/page IDs and independent nested key and knob data. Deleting the active profile SHALL select the first remaining profile and its first page. Optional app associations SHALL contain a stable app identifier and optional device serial; their activation SHALL remain unavailable until the app-monitor capability is installed.

#### Scenario: Duplicate isolation

- **WHEN** a profile is duplicated and a nested knob action is edited in the copy
- **THEN** the original profile's keys, knob actions, and revision remain unchanged

#### Scenario: Active profile deletion

- **WHEN** the user confirms deletion of the active profile and at least one other profile exists
- **THEN** both windows and dispatch select the first remaining profile's first page using one complete snapshot

### Requirement: Later-phase folder navigation

When folder support is enabled, a folder key SHALL reference an existing page ID in its own profile and retain an explicit return-page association. Entering SHALL select the linked page and push the current page onto a return stack; back SHALL restore the most recent valid page. A folder SHALL NOT reference itself, another profile, a missing page, or a link cycle. Deleting a referenced page SHALL require removing or retargeting its folder links in the same atomic save.

#### Scenario: Enter and return

- **WHEN** a folder on page A links to page B and the user enters then chooses back
- **THEN** selection moves to B then returns to A without changing key configuration or the profile knob

#### Scenario: Cyclic folder import

- **WHEN** imported folder links form A to B to A
- **THEN** the links remain preserved as unsupported compatibility data and cannot create an executable navigation cycle
