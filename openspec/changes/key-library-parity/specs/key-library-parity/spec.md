# Key library parity

## Purpose

Define the editing, icon selection and key execution behavior needed to make the recovered key library usable on the desktop and strip.

## ADDED Requirements

### Requirement: Transactional live editing
The application SHALL publish a selected key draft immediately to previews and SHALL commit only on explicit Save, reverting on click-away, key/profile/page change or editor close. Icon reset SHALL remain a draft until Save. Clock settings SHALL retain auto-save. Sources: MGMT-078, MGMT-247, MGMT-255, MGMT-310, MGMT-311.

#### Scenario: Unsaved reset and title
- **WHEN** a user changes a title or resets an icon then selects another key
- **THEN** the old key returns to its committed appearance and no executable payload changes

#### Scenario: Save conflict
- **WHEN** another revision commits before Save
- **THEN** the save fails visibly and retains the draft without overwriting that revision

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

### Requirement: Wrapping page and slide navigation
Page up/down SHALL wrap and goToPage SHALL clamp. Strip slide 0/1 SHALL select previous/next page; 2/3 SHALL select previous/next visible profile group with wrapping. The merged recognizer SHALL preserve in-tile scroll and overlay ownership. Sources: MAIN-077, MAIN-078.

#### Scenario: Navigation bounds
- **WHEN** next page executes on the last page or previous page on the first
- **THEN** selection wraps to the first or last page respectively
