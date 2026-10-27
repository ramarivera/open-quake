## ADDED Requirements

### Requirement: Shipped profile catalog
The app SHALL install Discord, MeetAI, Vivid, Quick, SysView, AI Chat, Music, Clock and DK Claw using recovered resource IDs, menu order, key layouts, titles and actions, and SHALL resolve built-in titles through the eight recovered locales. Quick SHALL use the host platform variant. Custom names SHALL remain literal. macOS SHALL omit Discord from its visible menu while retaining its resource. Existing profiles SHALL survive installation. Source: MGMT-315, 338–340, 343, 346–384. Decisions 12/13/15 govern exclusions, first-run shell approval and weather privacy; MGMT-341 vendor links become project links.

#### Scenario: DKClaw input stream stays with the selected assistant
- **GIVEN** the shipped DKClaw profile has the `quakeBotInput` tile at `1,7` with its `2x2` footprint and original default payload
- **WHEN** the panel selects another assistant and receives voice text, then changes profile
- **THEN** the mounted input follows the selected assistant, rejects text for the previous assistant, and clears its buffer and selection on the profile reset
- **AND** it cannot display late text from the previous profile until a new assistant is selected. This covers MGMT-350.

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
- **GIVEN** profile initialization cannot read or persist its catalog
- **WHEN** a manager request arrives before storage recovers
- **THEN** IPC returns the matching typed read or write failure without private cause details
- **AND** background initialization retries after two seconds and succeeds when storage recovers
- **AND** a subsequent authorized request uses the recovered controller and committed selection
- **AND** recovery tests control the clock and storage recovery explicitly, independently of filesystem latency and host load. Regression bead `open-quake-lih.9.10`.


### Requirement: Platform defaults and SysView preset

Quick SHALL select Linux, macOS or Windows defaults and SHALL use region-neutral project and issue URLs. SysView SHALL ship one visible systemMonitorPanel at 1,1, spanning 8 by 2, with glass style, style background mode, Celsius, sub-touch enabled, touch feedback and knob disabled, and title/grid/icon/delete/drag locks false. Previously installed legacy SysView metric grids SHALL migrate to this panel without replacing custom profiles. Evidence: MGMT-340, MGMT-384. Legacy-grid migration remains an implementation obligation.

#### Scenario: New catalog installation

- **WHEN** any supported platform installs the catalog
- **THEN** Quick points to the open-quake repository and issues independently of locale, and SysView has the exact full-panel preset

#### Scenario: Installed legacy SysView

- **WHEN** a previously installed SysView contains the legacy separate metric grid
- **THEN** that built-in upgrades to the full monitor panel while unrelated custom profiles remain intact

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

### Requirement: Exact saved DK Claw payloads
The DK Claw preset SHALL retain the 1,1 quakeBot conversation tile with agentId default, ttsEngine qwen, modeltype qwen-audio-3.1-tts-flash, 4 by 2 size, and top title size 6 (MGMT-348). Its four clawbot tiles SHALL occupy 1,5 materialfinder, 1,6 stockmaster, 2,5 dataorganizer, and 2,6 techex, each with voiceInput true and empty taskPrompt (MGMT-349). Save/reload SHALL retain preset protection and activation SHALL select the saved agent without inference.

#### Scenario: Round trip the protected preset
- **WHEN** the shipped DK Claw preset is installed, saved and reloaded through ProfileService
- **THEN** all exact tile payloads and protection flags remain and each agent tile activates its matching identity through the fake voice runtime


### Requirement: Page lifecycle and canonical legacy imports
Each profile SHALL keep stable page IDs, expose page add/delete controls with a ten-page limit and last-page guard, and repair all device selections to the adjacent surviving page on deletion without renumbering. The profile-level knob SHALL apply to every page; a newly created custom or a profile lacking a knob SHALL receive center legacyAssistant with icon 0-50 and animations 0-47, 0-48, 0-49, 0-51. New pages SHALL contain sixteen empty 2 by 8 cells with the canonical title defaults. Folder creation SHALL seed Back at 1,1 with icon 0-5 and a parentFolder reference, and nested navigation SHALL retain its parent profile menu identity. Sparse legacy imports SHALL pad uncovered cells, normalize empty actions and missing size/display, retain the knob separately and preserve DK Claw dkclaw/main routing and animations through save. Numeric page actions -1 and -2 SHALL become previousPage and nextPage. Sources: MGMT-086, MGMT-088, MGMT-089, MGMT-090, MGMT-342, MGMT-345, MGMT-352, MGMT-401.

#### Scenario: Page capacity and first-page deletion
- **WHEN** a user adds pages up to ten, attempts an eleventh, then deletes the first page
- **THEN** the extra add leaves the envelope unchanged, surviving IDs remain, selected devices fall back to a surviving page, and every new page has sixteen empty cells and the inherited center assistant

#### Scenario: Legacy sparse configuration and folder return
- **WHEN** sparse legacy keys with numeric page navigation and a knob are imported and a folder is created and opened
- **THEN** uncovered cells receive canonical defaults, page actions execute their named equivalents, Back returns to the parent page, and the selected profile remains the parent menu item

### Requirement: Complete manager creation and properties
Add Item SHALL allocate Custom<N> monotonically, preserve the stable selection anchor, select the new custom and use the exact default template. The live Add Item plus inline rename replaces the unused vendor name/color dialog; color is represented by the profile's rendered contents, not unused dialog metadata. The page-based manager SHALL expose a keyboard-accessible return to Keys. Selected properties SHALL follow committed selection. Linked apps SHALL support search, displayed app identity, None, installed apps and Other with serial scope; cancellation and failed persistence SHALL preserve the committed link. Sources: MGMT-314, MGMT-318, MGMT-326, MGMT-328, MGMT-329.

#### Scenario: Create, select and recover linked-app changes
- **WHEN** Add Item creates a custom, its linked app is selected or cleared, Other is cancelled, or saving a link fails
- **THEN** its name/order/template and anchor are correct, successful changes retain serial scope, and cancellation/failure leaves the prior properties selected

### Requirement: Region-neutral catalog and retained resource semantics
Quick's website and Help SHALL point to the open-quake repository and issues in every locale and region. OpenAI SHALL remain available independently of vendor region policy. Commented legacy 2 by 6 and AI presets SHALL remain importable as inert or supported canonical profiles, padded to the 2 by 8 grid; they SHALL NOT appear as additional shipped defaults. Resource imports SHALL preserve Icon, DeviceConfig, AlertTone, GIF, PluginIcon, Wallpaper and Emoji metadata and references through their existing owned storage and compatibility records. Sources: MGMT-341, MGMT-385, MGMT-398, MGMT-400.

#### Scenario: Portable catalog and resources
- **WHEN** platform catalogs and legacy resource fixtures are imported under supported locales
- **THEN** project/help URLs and OpenAI availability remain region-neutral, legacy layouts remain selectable after import, and resource kinds and references survive round trips

### Requirement: Foreground permission and logical device rules
The monitor SHALL check macOS Accessibility without prompting, provide guidance when denied, resume probing when granted, and reload links after committed manager edits even if the foreground identity is unchanged. Native serials and ws_ aliases SHALL identify one logical device; All Device rules SHALL address each connected logical device once. Failure reports SHALL be bounded to one warning per error code in thirty seconds without stopping polls or recovery. Sources: MAIN-084, MAIN-085, SETTINGS-109.

#### Scenario: Permission recovery and live rule edits
- **WHEN** a fake permission source changes denied to granted, or a linked rule changes while the app stays foreground
- **THEN** denial yields guidance without a native foreground query, granted permission resumes switching, and the edited link is delivered after debounce

#### Scenario: Aliases and sustained failures
- **WHEN** native/ws_ rules target connected twins, and repeated probes fail for thirty seconds before recovering
- **THEN** each logical device gets one selection, logs remain bounded per code, and polling resumes successful delivery

### Requirement: Bounded owned thumbnail pipeline
The six vendor thumbnail operations/events SHALL map to typed read, thumbnail, thumbnails, cancel-thumbnails, progress and snapshot messages. Read SHALL prefetch a map, progress and updates SHALL fan out to all live windows, and picker consumers SHALL decode before publication and discard cancelled or stale work. Captures SHALL produce owned 960 by 240 PNGs rather than vendor WebP q85 paths; opaque content/locale/border hashes replace generator-version filenames and numeric-only resource IDs. The thirty-visible-profile limit replaces the vendor sixty-four capture guard; existing retention SHALL keep current saved-profile hashes and prune obsolete owned files. Invalid or missing IDs, busy/unsupported capture, deadlines and IO errors SHALL fail closed through typed profile errors. Capture SHALL wait for fonts, decoded images and video frames, then compare up to six frames for two consecutive equal frames. Platform capture SHALL use a hidden window on macOS/Windows and offscreen rendering on Linux, avoiding foreground activation. Load, execution and capture SHALL be bounded to thirty, five and eight seconds. Optional startup sweep SHALL run after eight seconds, disabled on Linux unless explicitly enabled. Sources: SCREEN-096, SCREEN-097, SCREEN-098.

#### Scenario: Decode, stabilize and cancel capture
- **WHEN** fake images/videos become ready and frames settle, or readiness/capture times out or is cancelled
- **THEN** only a current stable image is published, failed jobs publish no partial image, all windows receive progress/update messages, and cache retention remains bounded

### Requirement: Atomic bounded backup lifecycle
Imports SHALL enforce the shared thirty-visible-profile capacity before any publication, retain resource metadata and restore OBS key group identity. Exports SHALL time out after 120 seconds, cancel pending work and publish no partial archive; successful exports SHALL return native feedback. Import counts SHALL use the active locale. Sources: MGMT-322, MGMT-428, MGMT-429.

#### Scenario: Over-capacity import and export deadline
- **WHEN** an archive would exceed thirty visible profiles, or export passes 120 seconds or is cancelled
- **THEN** no profile/resource mutation or partial destination is published, and success paths still report their result

### Requirement: Wizard profile visibility
Wizard profile choices SHALL start from persisted built-in visibility, default to all eligible built-ins on fresh installations, lock the final enabled built-in, persist the complete choice and refresh the visible menu while preserving a valid active selection. Connected mock devices SHALL receive the updated menu through the existing profile manager delivery path. Source: SETTINGS-059.

#### Scenario: Wizard deselection
- **WHEN** a user disables built-ins in the wizard and advances
- **THEN** the last enabled choice cannot be disabled and saved visibility and connected menus reflect the choices without duplicating profiles

### Requirement: Profile switch key
Switch Profile SHALL expose Next Profile with sentinel -1, explicit profile and page selection. Next SHALL wrap across visible profiles; invalid or hidden destinations SHALL not change selection. Source: MGMT-297.

#### Scenario: Next and explicit destinations
- **WHEN** a saved switch key selects Next at the final visible profile or names a missing profile/page
- **THEN** Next wraps to the first visible profile and invalid references fail without selection changes
