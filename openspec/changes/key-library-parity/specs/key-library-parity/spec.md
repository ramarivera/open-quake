# Key library parity

## Purpose

Define the editing, icon selection and key execution behavior needed to make the recovered key library usable on the desktop and strip.

## ADDED Requirements

### Requirement: Transactional live editing
The application SHALL publish a selected key draft immediately to previews and SHALL commit only on explicit Save, reverting on click-away, key/profile/page change or editor close. Icon reset SHALL remain a draft until Save. Clock settings SHALL retain auto-save. Sources: MGMT-078, MGMT-247, MGMT-255, MGMT-310, MGMT-311.

#### Scenario: Unsaved reset and title
- **WHEN** a user changes a title or resets an icon then selects another key
- **THEN** the old key returns to its committed appearance and no executable payload changes

#### Scenario: Inert selection preview
- **WHEN** pointer, keyboard, drag or native sub-touch input reaches a tile inside the key-selection preview
- **THEN** nested controls cannot send media, weather, voice, meeting, clock or other host actions, and pointer selection and accessible key buttons select the intended key
- **AND** Save retains its busy and disabled boundary while controls on the live strip remain interactive

#### Scenario: Save conflict
- **WHEN** another revision commits before Save
- **THEN** the save fails visibly and retains the draft without overwriting that revision

#### Scenario: Explicit replacement of unsupported imported function
- **WHEN** a user selects a supported Function for an unsupported imported key and saves
- **THEN** only its unsupported compatibility status is cleared, retained import fields survive, and the replacement executes without the obsolete payload
- **AND** cosmetic title, style and icon edits alone preserve the unsupported quarantine

#### Scenario: Selected alternate draft preview
- **WHEN** State 2 of a hotkeySwitch is selected in the editor
- **THEN** only that selected draft's grid artwork uses alternate title, style and icon with primary fallback for missing alternate fields
- **AND** switching states or saving does not project artwork into executable or persisted primary fields

#### Scenario: Single-state replacement after alternate editing
- **WHEN** a user replaces a State 2 hotkeySwitch with a single-state Function
- **THEN** subsequent title, style and icon edits target primary artwork while retained alternate fields stay untouched

### Requirement: Safe deletion
Delete SHALL remove the selected deletable key only when focus is outside editable fields and SHALL respect key edit locks and back keys. Source: MGMT-249, correcting its focused-field vendor bug; MGMT-248.

#### Scenario: Typing Delete
- **WHEN** Delete is pressed in an input, textarea, select or contenteditable
- **THEN** the selected key remains present

### Requirement: Localized titles with explicit user origin
Built-in key titles SHALL resolve using the recovered eight locales and the existing profile catalog. User-edited text including empty text SHALL survive locale switches. New title input SHALL stop at weight 20, counting U+4E00 through U+9FA5 as two and other UTF-16 units as one. Nonempty edits SHALL enable display, move the title to top and clear B/I/U style. Advanced style settings SHALL support bot/mid/top, size 6–18, B/I/U, color, and reset to true/bot/8/#FFFFFF/bold|italic|underline for either state. Source: MGMT-099, MGMT-100, MGMT-120, MGMT-258 through MGMT-261, MGMT-383.

#### Scenario: Locale and custom text
- **WHEN** a built-in key changes locale before and after a user edits its title
- **THEN** its default translates before the edit and the custom title remains after the edit

#### Scenario: Profile Manager locale ownership
- **WHEN** the Profile Manager requests a translated preview or thumbnail while the Keys locale differs or changes
- **THEN** the rendered titles retain the requested profile language from readiness through capture and locale-specific cache reuse
- **AND** later manager language changes update its preview while the live strip continues to follow Keys locale changes

#### Scenario: Title style edits
- **WHEN** a nonempty title is entered and then its advanced style is changed or reset
- **THEN** auto-style applies first, subsequent style changes remain drafts, and reset preserves text and user origin

### Requirement: Icon library and safe packs
The Icon Library SHALL offer Material Design Icons from the approved 7.4.47 set, local icons and installed packs, search names/tags/metadata after 500 ms, zoom from 40 to 120 px in steps of 8 with default 72, and append visible pages on scroll. Stream Deck manifest.json plus icons.json and iconfont.json plus symbol definitions SHALL import from ZIP without executing scripts. In-use icons and packs SHALL resist deletion, including draft and alternate references. TTF-only iconfont packs SHALL render through the native font decoder without executing pack code. Sources: MGMT-414 through MGMT-426.

#### Scenario: Search, zoom and selection
- **WHEN** a user searches an MDI tag, changes zoom and selects an icon for a key
- **THEN** only that current key draft changes, and stale selection cannot affect a newly selected key

#### Scenario: Hostile or referenced pack
- **WHEN** an archive contains traversal, executable SVG, excessive expansion, or an in-use pack is uninstalled
- **THEN** the operation fails without losing existing assets

#### Scenario: Local icon collection ownership
- **WHEN** the same icon belongs to an installed pack and the local collection and its unused local entry is deleted
- **THEN** the installed pack remains intact across restart and individual deletion of pack-only entries is rejected
- **AND** committed and draft references continue to prevent deletion

#### Scenario: Pending import chooser
- **WHEN** an import chooser or file preparation is pending while a sequence runs
- **THEN** panel cancellation and navigation complete before the chooser closes and cancellation stops remaining steps
- **AND** import commits remain serialized, recheck document authority and disposal, and shutdown awaits owned work without a late write

### Requirement: Stateful key execution
hotkeySwitch SHALL require two validated key actions, send chord zero on the first press and alternate thereafter. Timer/countdown/alarm keys SHALL start or cancel, survive profile switches and stop on disposal. Multi-actions SHALL await validated steps, use a default 100 ms gap plus delay values, publish per-step progress and stop on second press or first failure. Alerts SHALL be suppressed when their profile is inactive. Sources: MAIN-067, MAIN-075, MAIN-076, MAIN-081.

#### Scenario: Alternating presses
- **WHEN** press/release/press events reach a committed hotkeySwitch
- **THEN** exactly chord zero then chord one execute, with matching alternate artwork and no extra execution on release

#### Scenario: Timer across navigation
- **WHEN** a countdown starts and the active profile changes
- **THEN** it continues to expiry without showing an alarm on the unrelated profile

#### Scenario: Cancel sequence
- **WHEN** a running multi-action key is pressed again
- **THEN** remaining steps stop and progress completes without replay after reconnect

#### Scenario: Selected application reference
- **WHEN** an open-application action or sequence step uses an app: bundle identifier
- **THEN** macOS resolves it using structured platform launch arguments, unsupported platforms fail explicitly, and absolute filesystem paths retain their path launch behavior
- **AND** mock execution performs no operating-system calls

### Requirement: Wrapping page and slide navigation
Page up/down SHALL wrap and goToPage SHALL clamp. Strip slide 0/1 SHALL select previous/next page; 2/3 SHALL select previous/next visible profile group with wrapping. The merged recognizer SHALL preserve in-tile scroll and overlay ownership. Sources: MAIN-077, MAIN-078.

#### Scenario: Navigation bounds
- **WHEN** next page executes on the last page or previous page on the first
- **THEN** selection wraps to the first or last page respectively

### Requirement: Native icon picker and portable artwork
The icon picker SHALL open as an owned, resizable 600×550 child window with matching minimum dimensions. It SHALL keep search outside the loading overlay, use the recovered dark palette, and append ten rows per page using max(1, floor(viewport width / (icon size + 12))) columns. Loading stages SHALL reflect completed operations rather than fabricated elapsed progress. Management transitions SHALL remain at most 160 ms.

Selected artwork SHALL be rasterized to a 170×170 PNG through inert image decoding. Installed application artwork SHALL be extracted locally through the operating system and SHALL not be redistributed as a bundled pack. Unavailable proprietary resource references SHALL use an explicit open-source semantic fallback, preserving inline custom images and known defaults.

#### Scenario: Owned picker cancellation
- **WHEN** the editor changes key, profile, page, function, alternate state or navigates away while a picker or import is pending
- **THEN** the obsolete picker closes and cannot update the newer draft or commit a late import
- **AND** the child can list, import, remove and select icons but cannot activate keys, edit profiles or issue other management mutations

#### Scenario: Picker resize and selection
- **WHEN** the picker opens, resizes, searches or changes zoom
- **THEN** its ten-row batches follow the viewport formula, search stays usable while loading, and selecting artwork updates only the current draft with a decoded 170×170 PNG

#### Scenario: Portable application and fallback artwork
- **WHEN** a user selects an installed application's icon or resets an unavailable legacy resource
- **THEN** the saved key retains portable inline artwork without depending on a proprietary resource pack or an installed application on the restore host


#### Scenario: Picker scan and mutation isolation
- **WHEN** installed application artwork extraction is pending
- **THEN** live panel activation and navigation remain responsive, and a closed or replaced picker cannot receive the late scan result
- **AND** only the current owned picker can import or remove icons; the management window can open or cancel the picker but cannot bypass it to mutate icon storage

#### Scenario: Intentionally blank artwork
- **WHEN** a configured generic key has an empty icon string
- **THEN** the editor, strip and thumbnails preserve its blank artwork
- **AND** semantic fallback applies to unavailable nonempty resource references while inline custom artwork remains unchanged

#### Scenario: Reset without a default
- **WHEN** an imported key has no default artwork for either state and its icons are reset
- **THEN** each state without a default retains its artwork and original source identity through Save, preserving in-use pack protection
- **AND** resetting a state with a default updates only that state's artwork source

#### Scenario: Underfilled icon viewport
- **WHEN** the picker loads or its height, width, zoom, search or group changes and the current batch does not overflow
- **THEN** it appends complete ten-row batches until scrolling is possible or the selected group is exhausted

#### Scenario: Compressed raster expansion
- **WHEN** a raster import passes file and pixel limits but its decoded PNG exceeds the selection source limit
- **THEN** the import normalizes the image before storage, preserving aspect ratio and producing a selectable source
- **AND** selection and Save retain portable 170×170 artwork and source identity


### Requirement: Saved integration key activation
The committed key runtime SHALL route configured Home Assistant keys to the direct Home Assistant service consumer after applying its revision, visibility, compatibility and held-input guards. Direct keys SHALL use their explicit configuration independently of the AI entity allowlist. Missing or failed integration dependencies SHALL retain typed host errors. Mock-device execution SHALL never call the live integration.

#### Scenario: Saved Home Assistant key press
- **WHEN** a current visible supported Home Assistant key is pressed
- **THEN** its saved entity, service and service data reach the direct integration consumer once per press
- **AND** release permits a later press, while repeated held input, stale targets, hidden keys and quarantined keys cannot execute the service

#### Scenario: Slow Home Assistant request
- **WHEN** an authorized saved Home Assistant key awaits a slow or unreachable service
- **THEN** unrelated key activation, release, navigation and timer cancellation remain available
- **AND** the production panel dispatcher preserves same-key press/release ordering without waiting for another key's integration completion
- **AND** reset interrupts scoped pending integration work without waiting for the network response
- **AND** cancellation crosses the desktop Promise boundary into the integration runtime so queued service actions cannot execute after reset
- **AND** committed-key validation and held-press deduplication remain atomic


### Requirement: Default artwork reset precedence

Reset SHALL affect the current editor draft until explicit Save. Brightness SHALL restore its semantic brightness resource before plugin or template defaults, leaving its alternate state unchanged. Other keys SHALL prefer current default metadata, retained source defaults, then the matching built-in platform template; absent defaults SHALL preserve each state's artwork. Plugin primary and alternate defaults SHALL remain independent. Every built-in template, including Linux Quick and Clock, SHALL participate. An intentionally blank Clock default SHALL stay blank. Actions and titles SHALL remain unchanged. Evidence: MGMT-255, MGMT-340.

#### Scenario: Reset an imported platform template

- **WHEN** an unlocked imported Quick key without retained defaults resets on Linux, macOS or Windows
- **THEN** the real editor selects that platform's catalog, publishes its portable draft artwork and source identity, and does not send Save
- **AND** the Clock template can reset to blank without replacing its clock settings

#### Scenario: Brightness and plugin conflict

- **WHEN** brightness and an imported plugin have conflicting current and retained default metadata
- **THEN** brightness restores its brightness resource, the plugin uses current primary and alternate defaults, and neither operation changes actions or commits the draft

### Requirement: Mounted profile editor regressions
The Keys editor SHALL follow active-device profile and page publications, refresh externally changed profile labels and committed configuration, and resolve locale labels without saving translated text. Repeated publications SHALL retain an unchanged draft; a change to the selected device's profile/page SHALL discard it. Foreign-device selection SHALL not move the editor. Sources: MGMT-049, MGMT-096, MGMT-097.

#### Scenario: Device selection and external updates
- **WHEN** a draft is open and another device changes profile, then the current device selects a subfolder
- **THEN** only the current-device selection moves the editor and discards the draft, while later name/configuration and locale publications refresh labels without rewriting saved titles

### Requirement: Sequence removal and deletion ownership
The selected multi-action operation SHALL be removed through the real editor Save path while preserving the other operations and persisted revision. Delete outside fields SHALL respect edit locks, and nested contenteditable and textbox controls SHALL own their Delete input. Sources: MGMT-083, MGMT-249.

#### Scenario: Remove middle step and protect editable controls
- **WHEN** the middle of three operations is removed and saved
- **THEN** a repository reload contains only the first and third operations, and Delete in input, textarea, select, textbox or nested contenteditable cannot remove the selected key

### Requirement: Recovery of generic translated titles
Generic hotkey titles polluted with a default from any recovered locale SHALL resolve to the selected locale, and generic ClawBot titles SHALL resolve to the configured agent name. Explicit user text SHALL remain literal. Source: MGMT-100.

#### Scenario: Eight-locale default recovery
- **WHEN** a legacy generic hotkey or ClawBot title is localized without a user-origin marker
- **THEN** the selected locale or configured agent supplies the title, while a title marked as user-modified survives unchanged

### Requirement: Inline sequence entry and return
The inline Multiple Operations editor SHALL show the contained operation count, focus a newly added step, and provide Back and Edit operations controls without discarding the draft (MGMT-280).

#### Scenario: Add a step and return
- **WHEN** a user adds an operation and selects Back
- **THEN** the count increases and reopening Edit operations retains the added draft

### Requirement: Library placement and grid selection
The mounted Keys editor SHALL offer pointer drag and keyboard placement from the action library and coordinate-only grid moves. Starting a drag SHALL revert unsaved artwork/title previews and cancel obsolete picker callbacks. Drops SHALL require entry into a valid current grid, confirm every replaced occupied footprint including the target anchor, honor all edit locks and protect Back, emojiBack and colorfulScreen. Successful drops SHALL autosave one complete revision and retarget selection. Cancellation, invalid drops, failed writes and revision conflicts SHALL preserve the committed profile. Sources: MGMT-068, MGMT-069, MGMT-070, MGMT-071, MGMT-073, MGMT-074, MGMT-075, MGMT-076, MGMT-078, SCREEN-136, SCREEN-137.

#### Scenario: Placement and replacement
- **WHEN** an action is dropped on an occupied grid footprint
- **THEN** the editor shows localized replacement names and explicit Confirm Replace/Cancel controls before any save
- **AND** confirmation removes complete affected footprints, isolates catalog templates, retains default artwork metadata, forces playAudio to 1,1 at 8x2, creates folder and Back together, and opens multi-action editing

#### Scenario: Move and keyboard equivalent
- **WHEN** a tile is dragged or picked up with Space and placed with Enter on a coordinate button
- **THEN** covered multi-cell targets resolve to their anchor, equal footprints can swap, and mismatched footprints, partial overlaps, locked or invalid targets show forbidden feedback without saving
- **AND** moves preserve all configuration and Escape or leaving the grid cancels placement

### Requirement: Selection and editor navigation
Single clicks SHALL toggle selection, normalize covered coordinates to their visible anchor, exclude liveAudioTranslateDisplay, and revert unsaved previews on deselection, click-away and key/profile/page switches. Double clicks SHALL enter existing same-profile folder/emoji pages, return through Back/emojiBack, wrap next/previous pages, and open multi-action editing without executing host actions. Sources: MGMT-057, MGMT-064, MGMT-066, MGMT-077, SCREEN-138.

#### Scenario: Selection and safe navigation
- **WHEN** a selected covered coordinate is clicked again or a folder tile is double-clicked
- **THEN** the first deselects and restores committed appearance and the second changes only the editor's selected page
- **AND** obsolete picker results cannot change the newly selected key

### Requirement: Responsive editor guidance
The Keys editor SHALL retain the independent management layout, accessible controls and scrollable multi-action/knob forms at narrow and wide sizes. No-selection and built-in protection hints SHALL use recovered locale strings. Vivid profiles SHALL expose an accessible configuration action scoped to the selected serial/profile, without key execution. Free sizes SHALL label 1x1 Single, 2x1 Horizontal, 1x2 Vertical, 2x2 Four Cells and Custom width x height, preserving forced-size locks and inward spans. Sources: MGMT-045, MGMT-046, MGMT-061, MGMT-067, SCREEN-135, SCREEN-143.

#### Scenario: Layout, size and vivid guidance
- **WHEN** the window narrows, locale changes or a vivid/default profile is selected
- **THEN** the editor remains usable without horizontal clipping, contextual hints update, fixed-size controls stay disabled and vivid activation opens its wallpaper configuration

### Requirement: Editor update scheduling
Grid state, overlap validation and size edits SHALL use synchronous canonical computations rather than vendor 100/50/200 ms watcher timers. Profile reads SHALL happen on readiness/selection rather than a vendor one-second delay. Library search SHALL debounce for 500 ms and cancel its timer on replacement or unmount. Draft requests SHALL carry target epochs so delayed replies cannot retarget an editor. Sources: MGMT-081.

#### Scenario: Coalescing and cleanup
- **WHEN** library search changes repeatedly then the editor closes, or a draft reply arrives after switching targets
- **THEN** only the last live search may apply and no stale timer or reply changes the closed or newer editor
