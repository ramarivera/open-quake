## ADDED Requirements

### Requirement: Shipped profile catalog
The app SHALL install Discord, MeetAI, Vivid, Quick, SysView, AI Chat, Music, Clock and DK Claw using recovered resource IDs, menu order, key layouts, titles and actions, and SHALL resolve built-in titles through the eight recovered locales. Quick SHALL use the host platform variant. Custom names SHALL remain literal. macOS SHALL omit Discord from its visible menu while retaining its resource. Existing profiles SHALL survive installation. Source: MGMT-315, 338–340, 343, 346–384. Decisions 12/13/15 govern exclusions, first-run shell approval and weather privacy; MGMT-341 vendor links become project links.

#### Scenario: Platform and locale selection
- **WHEN** a fresh macOS installation selects German
- **THEN** eight built-ins appear, the stored catalog contains nine resources, Quick uses Mac actions, and available title keys resolve to recovered German strings

#### Scenario: First shell execution
- **WHEN** a built-in cmd key runs without approval for its exact command
- **THEN** management shows a native confirmation with the command, cancellation executes nothing, and approval is persisted only after confirmation

### Requirement: Atomic profile management
The manager SHALL support create, rename, deep duplicate, selection and confirmed deletion of custom profiles, show/hide built-ins and preserve hidden data. It SHALL retain one visible built-in and enforce 30 visible defaults plus customs on every add, duplicate and unhide. It SHALL generate Custom<N>, trim names, count U+4E00–9FA5 as two UTF-16 units and all other units as one, truncate inline input to ten weighted units, and reject empty, over-limit or duplicate names. Source: MGMT-313–323, 345. Built-ins SHALL resist deletion/replacement. Deleting a selected transient custom profile SHALL restore its stable anchor if available, otherwise first remaining custom then first visible built-in. Every change SHALL persist atomically before publication, without losing concurrent key saves.

#### Scenario: Capacity and hidden restoration
- **WHEN** 30 profiles are visible and a hidden built-in is rechecked
- **THEN** the operation is rejected and the saved menu and hidden profile data remain unchanged

#### Scenario: Failed write
- **WHEN** a rename cannot persist
- **THEN** neither committed snapshots nor subscribers observe the rename

### Requirement: Profile properties and startup override
Profiles SHALL support an optional app path/identifier and all-device or serial-specific scope. One top-level profile MAY be the startup default; replacing another SHALL require confirmation. Subpages SHALL not be eligible. First connection SHALL apply the startup default once and ignore duplicate init reports; reconnection SHALL start a new session. Source: MGMT-091, 326–327, 329–336; MAIN-079.

#### Scenario: Duplicate first reports
- **WHEN** a connected device reports an old profile twice while a startup default is configured
- **THEN** only the startup default is delivered once and neither report replaces it

### Requirement: Foreground automatic switching
A scoped monitor SHALL probe immediately, poll every 3000 ms on macOS or 2000 ms elsewhere, cache results for 500 ms and bound native execution to 5000 ms. It SHALL react to window ID or owner-path changes, choose the best normalized bundle-path LCS match at similarity >=0.79, and send the profile to connected devices in scope after a 300 ms per-device debounce. It SHALL retain current selection on unmatched apps, avoid overlapping native probes and stop on disposal. Source: MGMT-333; MAIN-084–085.

#### Scenario: Focus changes during debounce
- **WHEN** two matching apps become foreground within 300 ms
- **THEN** each target device receives only the last matching profile

### Requirement: Functional manager and thumbnails
Management SHALL expose Knob Profile, Default Profile, Custom Profile, Add Item, profile settings, visibility and startup-default controls using recovered English strings. Each row SHALL show a generated profile thumbnail. Update all SHALL report done/total with Cancel; unsupported capture SHALL fail closed with the recovered message. Read-only panel IPC SHALL not grant management writes. Source: MGMT-314–324, 326, 329–337, 430–434.

#### Scenario: Thumbnail batch cancellation
- **WHEN** Cancel is requested during a batch
- **THEN** the in-flight capture may finish and no later profile capture starts

#### Scenario: Unauthorized mutation
- **WHEN** a panel or foreign frame requests a management mutation or command approval
- **THEN** the request is rejected before persistence, native dialogs or execution
