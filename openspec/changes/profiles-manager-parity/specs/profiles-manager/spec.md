## ADDED Requirements

### Requirement: Shipped profile catalog
The app SHALL install Discord, MeetAI, Vivid, Quick, SysView, AI Chat, Music, Clock and DK Claw using recovered resource IDs, menu order, key layouts, titles and actions, and SHALL resolve built-in titles through the eight recovered locales. Quick SHALL use the host platform variant. Custom names SHALL remain literal. macOS SHALL omit Discord from its visible menu while retaining its resource. Existing profiles SHALL survive installation. Source: MGMT-315, 338–340, 343, 346–384. Decisions 12/13/15 govern exclusions, first-run shell approval and weather privacy; MGMT-341 vendor links become project links.

#### Scenario: Platform and locale selection
- **WHEN** a fresh macOS installation selects German
- **THEN** eight built-ins appear, the stored catalog contains nine resources, Quick uses Mac actions, and available title keys resolve to recovered German strings

#### Scenario: First shell execution
- **WHEN** a built-in cmd key runs without approval for its exact command
- **THEN** management shows a native confirmation with the command, cancellation executes nothing, and approval is persisted only after confirmation

#### Scenario: Localized strip geometry
- **WHEN** MeetAI or SysView is previewed or captured in any of the eight locales, including from an older installed catalog
- **THEN** stable resource identity preserves its strip theme and tile geometry

#### Scenario: Fresh macOS preview
- **WHEN** macOS has no saved preview selection, or its saved selection references hidden Discord
- **THEN** the strip renders the first visible profile, matching the manager, and valid visible saved selections remain active

### Requirement: Atomic profile management
The manager SHALL support create, rename, deep duplicate, selection and confirmed deletion of custom profiles, show/hide built-ins and preserve hidden data. It SHALL retain one visible built-in and enforce 30 visible defaults plus customs on every add, duplicate and unhide. It SHALL generate Custom<N>, trim names, count U+4E00–9FA5 as two UTF-16 units and all other units as one, truncate inline input to ten weighted units, and reject empty, over-limit or duplicate names. Source: MGMT-313–323, 345. Built-ins SHALL resist deletion/replacement. Deleting a selected transient custom profile SHALL restore its stable anchor if available, otherwise first remaining custom then first visible built-in. Every change SHALL persist atomically before publication, without losing concurrent key saves.

#### Scenario: Capacity and hidden restoration
- **WHEN** 30 profiles are visible and a hidden built-in is rechecked
- **THEN** the operation is rejected and the saved menu and hidden profile data remain unchanged

#### Scenario: Failed write
- **WHEN** a rename cannot persist
- **THEN** neither committed snapshots nor subscribers observe the rename

#### Scenario: Delete an unrelated transient profile
- **WHEN** a custom profile is selected and another custom profile is deleted
- **THEN** the active selection and stable anchor remain unchanged

#### Scenario: Hidden deletion anchor
- **WHEN** the selected custom profile is deleted after its stable anchor was hidden
- **THEN** the manager restores a visible remaining custom or built-in profile

### Requirement: Profile properties and startup override
Profiles SHALL support an optional app path/identifier and all-device or serial-specific scope. One top-level profile MAY be the startup default; replacing another SHALL require confirmation. Subpages SHALL not be eligible. First connection SHALL apply the startup default once and ignore duplicate init reports; reconnection SHALL start a new session. Source: MGMT-091, 326–327, 329–336; MAIN-079.

#### Scenario: Duplicate first reports
- **WHEN** a connected device reports an old profile twice while a startup default is configured
- **THEN** only the startup default is delivered once and neither report replaces it

#### Scenario: Hidden startup and saved selection
- **WHEN** the startup default or saved selection is hidden before reconnect
- **THEN** connection selects a visible profile and never delivers the hidden profile

#### Scenario: Failed delivery
- **WHEN** delivering a requested selection fails
- **THEN** persisted selections and repository subscribers retain the previous selection

### Requirement: Foreground automatic switching
A scoped monitor SHALL probe immediately, poll every 3000 ms on macOS or 2000 ms elsewhere, cache results for 500 ms and bound native execution to 5000 ms. It SHALL react to window ID or owner-path changes, choose the best normalized bundle-path LCS match at similarity >=0.79, and send the profile to connected devices in scope after a 300 ms per-device debounce. It SHALL retain current selection on unmatched apps, avoid overlapping native probes and stop on disposal. Source: MGMT-333; MAIN-084–085.

#### Scenario: Focus changes during debounce
- **WHEN** two matching apps become foreground within 300 ms
- **THEN** each target device receives only the last matching profile

#### Scenario: Device-scoped app matching
- **WHEN** the closest app link targets another serial and a weaker qualifying link targets this serial
- **THEN** this serial switches using its own eligible link

### Requirement: Functional manager and thumbnails
Management SHALL expose Knob Profile, Default Profile, Custom Profile, Add Item, profile settings, visibility and startup-default controls using recovered English strings. Each row SHALL show a generated profile thumbnail. Update all SHALL report done/total with Cancel; unsupported capture SHALL fail closed with the recovered message. Read-only panel IPC SHALL not grant management writes. Source: MGMT-314–324, 326, 329–337, 430–434.

#### Scenario: Thumbnail batch cancellation
- **WHEN** Cancel is requested during a batch
- **THEN** the in-flight capture may finish and no later profile capture starts

#### Scenario: Unauthorized mutation
- **WHEN** a panel or foreign frame requests a management mutation or command approval
- **THEN** the request is rejected before persistence, native dialogs or execution

#### Scenario: Management navigation
- **WHEN** the management window navigates away from its exact authorized app URL, including same-origin query or fragment navigation
- **THEN** the new document cannot mutate profiles or execute commands

#### Scenario: Recoverable initialization failure
- **WHEN** initial profile storage fails and later recovers
- **THEN** IPC returns a typed failure reason and a subsequent request retries initialization successfully

### Requirement: Mounted manager and retained Quick payloads
The manager SHALL render every visible platform default with localized names, settings and selection affordances, and SHALL support custom selection, confirmed deletion, duplicate, thumbnail refresh and inline weighted-name commit/rejection. External publications SHALL refresh selected properties. The standalone manager SHALL preserve active resource/device identity when reached from Keys and on return. Sources: MGMT-313, MGMT-315, MGMT-317, MGMT-319.

#### Scenario: Default rows and custom editing
- **WHEN** the manager is opened on each host platform and switched to German
- **THEN** every eligible default appears with its localized label and settings, custom row actions persist through the real controller, and Enter/blur commit valid ten-unit names while empty or duplicate input reverts

#### Scenario: Return to Keys
- **WHEN** the user navigates from Keys to Knob Profile, selects a custom resource, then returns to Keys
- **THEN** Keys shows that selected resource on the same device

### Requirement: Immutable Quick action regressions
Quick SHALL retain each platform's project and Help destinations, Clipboard shortcut and settings action. All preset edit locks SHALL apply on every platform. Native command execution SHALL require approval and cancellation SHALL execute nothing. Sources: MGMT-370, MGMT-371, MGMT-381, MGMT-382.

#### Scenario: Saved Quick dispatch
- **WHEN** committed project, Help, Clipboard and settings keys are activated on their platform
- **THEN** the real action consumer receives the exact saved URL, keyboard encoder emits the recovered chord press/release, macOS Expose emits Control+Down, and Windows/Linux settings commands run only after native approval

### Requirement: Readable responsive profile properties
Profile property fields and dropdowns SHALL remain readable and keyboard-focusable at desktop and narrow widths, without horizontal overflow. Source: MGMT-337.

#### Scenario: Narrow localized properties
- **WHEN** English or German profile properties render at 390 pixels and desktop width
- **THEN** labels and fields remain visible, keyboard focus has a visible indicator, and the management document has no horizontal overflow
