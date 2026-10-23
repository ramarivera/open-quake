# Design

## Context

See `proposal.md` for scope. Inventory input is `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, section 3, First-release cut, Later phases, and Open questions. All recovered-source paths below use `RS` = `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion/artifacts/recovered_sources/`.

Evidence tiers describe the input, not hardware verification. S means recovered source, P means partial evidence, and N means names only. New open-quake policies have no recovered parity evidence. Ramiro approved all recommendations on 2026-10-23; approval does not establish hardware parity. No hardware was accessed.

## Goals / Non-Goals

Define one canonical local model shared by the panel, editor, function library, and knob. Keep logical touch cells separate from physical HID keys. Protocol byte framing belongs to `two-layer-sdk`; ARIS-68, account sync, and recreation of proprietary default artwork are outside this design.

## Evidence ledger

| Item | Tier | Source and observed behavior | Contract consequence |
|---|---|---|---|
| Profile menu | S | `RS/webpack:__dk-suite_src_utils_DefaultProfileData.js:1`, `DEFAULT_PROFILE_MENU_LIST` lists discord, meetingAssistant, colorfulScreen, shortcut, systemMonitor, aiCopilotChat, DK-Player, DK-Desktop-Clock, DKClaw; colorfulScreen has type 0, the others type 1 | Preserve labels as compatibility metadata; do not claim those runtimes ship in release one |
| Empty cells and reserved knob | S | `RS/webpack:__dk-suite_src_views_Components_MainScreen.vue:1323`, `addNewConfigInfo` creates one-based row/column cells and appends `0,1` | Empty type is valid; knob is separate |
| Per-key fields | S | `RS/webpack:__dk-suite_src_plugins_KeyConfiguration.js:36`, `ALL_MENU_SIDEBAR`; `RS/webpack:__dk-suite_src_utils_DefaultProfileData.js:40`, clock and player defaults | Common schema includes resourceId, support flags, locks, alternate visuals, and nested actions, not only inventory shorthand |
| Logical grid | S | `RS/webpack:__dk-suite_src_views_DKQuake_RemoteSocketClient.vue:18`, maxRow 2/maxCol 8; `convertTo2DArray` parses `[row,col]`; `RS/webpack:__dk-suite_src_views_DKQuake_QuakeScreenView.vue:950` uses the same order | Recommend row,col logical 2x8; inventory's col,row is contradicted by actual consumers |
| Physical input discrepancy | P | `RS/webpack:__dk-suite_src_main_DeviceControl_Connections_ProtocolUtil.js:60`, case 0x01 scans 15 positions as three rows of five; relationship to the 2x8 panel is unverified | Never equate logical coordinates with physical key IDs |
| Move, swap, coverage locks | S | `RS/webpack:__dk-suite_src_views_Components_ShortcutGrid.vue`, `handleInternalDrag`, `addNewShortcut`, `_doAddNewShortcut`, `getCoveredCells`, checks basicEditableItems | Validate moves and replacement before committing |
| Revision propagation | S | `RS/webpack:__dk-suite_src_views_DKQuake_RemoteSocketClient.vue`, `reportDeviceActiveProfile`, `processReceivedData` profile branch, `_configCacheKey`, `invalidateConfigInfoCache` | Cache invalidation on saved profile is required; atomic revision policy is approved by Ramiro on 2026-10-23 |
| Pages and deletion | S | `RS/webpack:__dk-suite_src_views_Components_MainScreen.vue`, `getConfigInfo`, `handleDeletePage`, `handleProfileDelete`; page resources are distinct resourceIds and active deletion selects index 0 | Local model needs an explicit adapter, not blind reuse of recovered resourceIds as profile IDs |
| App-linked properties | S | `RS/webpack:__dk-suite_src_views_Components_ProfileProperties.vue`, `doSetMonitorInfo` stores appIdentifier/appPath/deviceSN under resourceId | Later app-monitor lane owns triggering; this model holds optional association metadata |
| Change-device IPC | N | `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion/artifacts/ipc_channels.txt`, `ChangeDeviceProfile`, `device-menu-profile-change` | Names alone do not establish public wire schemas |

## Decisions

### Approved (Ramiro, 2026-10-23): ownership and local model

Put `profile-contracts`, `profile-invariants`, `profile-repository`, and `profile-service` in `packages/device`. The repository interface stays platform-neutral; `apps/desktop` supplies local storage and composes its Layer once in main. Use an `Effect.Service` conductor with declared dependencies, named `Effect.fn` methods, explicit success/error types, and the shared error catalog. Renderer mutations cross a Schema-decoded preload boundary. Future edge/client consumers derive from contract-first RPC if exposed; no new network API is required now.

The alternative, keeping schema and rules inside React, would let preview and hardware dispatch disagree. Putting profile state in `packages/protocol` would violate its pure wire-codec responsibility.

Canonical storage is a versioned local envelope: `schemaVersion:1`, `profiles`, and `activeByDevice`. A profile has a stable opaque `id`, a display `name`, monotonic nonnegative `revision`, `pages`, and one profile-scoped `knob`. A page has a stable `id` and flat `keys`; its array position supplies the one-based page number. Selection is `{profileId,pageId}` per serial. Legacy `resourceId`, `version`, `configIdx`, and per-page resource links live in explicit compatibility metadata. They are not assumed to equal new IDs or wire fields. See the spec for each field and absence policy.

### Approved (Ramiro, 2026-10-23): open question 2, mapping scope

Ship a QUAKE logical layout descriptor with two rows, eight columns, one-based `row,col`, and reserved knob code `0,1`. Keep physical mapping as a separately versioned L1/device capability keyed by hardware/firmware identity. A normalized event identifies its origin as logical touch or mapped physical input. Until L1 supplies a verified mapping, allow editor and panel interactions but report physical activation as unavailable. Do not transpose coordinates to match the inventory sentence or force the recovered 3x5 scan onto 2x8 cells.

Accept hardware mapping only after recording press and release for every physical control, knob directions and hold/release, corners of the touch grid, coordinate origin, and firmware version. Attach the evidence path to the mapping. This is a first-release physical-input gate, not an inferred geometry claim. A universal hardcoded matrix was considered and rejected because the recovered sources disagree.

### Approved (Ramiro, 2026-10-23): persistence, navigation, and editing

Use atomic whole-revision saves with expected-revision checks. Draft edits do not affect active dispatch. A successful save increments once and publishes one complete snapshot to panel, management, and device projection. Distinguish local saved state from device delivery state. A failed device send does not discard the local save.

Start with one named editable profile and one empty page; page add/select/remove supports first-release navigation. Clamp previous/next at boundaries, reject explicit out-of-range page requests, and refuse deletion of the last page. Multiple-profile create/rename/duplicate/delete follows later; deleting the active profile selects the first remaining profile and page. Keep the last profile. Later folders are validated links to existing pages in the same profile, with an explicit return-page stack; reject cyclic or missing links. Approved (Ramiro, 2026-10-23): these recommendations are the product decisions, including edge cases not established by the recovered UI.

For new edits, reject off-grid spans, duplicate anchors, overlap without explicit replacement, and forbidden edits. Preserve unknown imported functions in a compatibility envelope and show an unsupported tile. Only registered, fully validated actions can execute. New schemas use omitted optional fields in JSON and `Option` in domain code. Legacy null slots and empty action objects normalize at import only; do not turn unknown data into executable actions.

## Risks / Trade-offs

- Different page-resource and profile models could lose information. Preserve original identifiers and test import/export before enabling compatibility writes.
- Firmware mapping may stay unknown. Desktop tests prove logical behavior only; release evidence must keep physical input marked unverified.
- Large widgets may cover multiple cells. Use occupancy derived from anchors and spans; never delete covered data implicitly during a drag.
- Storage or IPC can fail between saves and rendering. Persist before publishing, reject stale revisions, and allow a renderer to request the latest snapshot after reconnect.

## Migration plan

Initialize new local data independently of DK-Suite. Import only a user-selected export, retain an untouched backup, report normalization changes, and never overwrite the proprietary store. Validate before atomically replacing a local revision. Roll back to the backup/envelope version on failure. Existing open-quake code has no persisted profile implementation to migrate.

## Approved decisions and remaining verification

Approved (Ramiro, 2026-10-23): adopt the recommended version-1 envelope, one-based row,col logical descriptor, one-profile/one-page seed, clamped previous/next with strict explicit page requests, last-page protection, atomic expected-revision saves, and inert preservation of unknown imported fields. The requirement scenarios describe these accepted policies. Hardware mapping and account-free operation on firmware remain unverified; mocks cannot close those gates.
