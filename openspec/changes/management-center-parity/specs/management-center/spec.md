## ADDED Requirements

### Requirement: Management Center layout
The management window SHALL use DK-Suite's Management Center layout: a sidebar, a 6 px resizer and a stage. The sidebar SHALL default to `clamp(218px, 14vw, 238px)` with 18/13/16 px padding. It SHALL contain a product mark card (minimum height 64 px, 36×36 icon tile), section labels, navigation items, and a footer with the device status card and a 36×36 UI settings button. Navigation items SHALL be at least 56 px tall with a 20 px icon, a label and an optional subtitle; the active item SHALL show a 2 px left accent border on the accent-soft fill. Sections SHALL be Device (Overview, Profiles, Screen, Controls, Connection), Core (Agents) and Apps (Meeting when present, Emoji, Shortcuts, Home Assistant), followed by Appearance. The stage SHALL show a page header (uppercase kicker with 0.08 em letter spacing, a 22 px/680 heading at the Small scale, an optional subtitle and right-hand actions) above the page content. Source: CENTER-001, CENTER-008, CENTER-009, CENTER-012, MGMT-045.

#### Scenario: Open a page
- **WHEN** the user selects Emoji in the Apps section
- **THEN** the item becomes the only one marked as the current page, the page header shows the Emoji kicker, title and subtitle, and the stage scrolls to the top

#### Scenario: Existing lane pages keep their behaviour
- **WHEN** the user opens Screen, Controls, Connection or Profiles
- **THEN** each page renders the same controls and issues the same requests as before the redesign, inside the new stage

### Requirement: Resizable and responsive sidebar
Dragging the resizer SHALL set the sidebar width, clamped to 120–360 px, with a `col-resize` cursor and text selection disabled during the drag. The resizer SHALL also accept arrow keys (8 px per press) and SHALL expose a separator role labelled "Drag to resize sidebar". The chosen width SHALL persist with the UI settings. At window widths up to 980 px the sidebar SHALL become an 82 px icon rail with labels visually hidden and the resizer removed; at 760 px and below the stage padding SHALL shrink to 18/16/20 px. Source: CENTER-010, CENTER-011.

#### Scenario: Clamp a drag
- **WHEN** the user drags the resizer 400 px to the right of a 218 px sidebar
- **THEN** the sidebar stops at 360 px and the width is restored after a reload

#### Scenario: Narrow window
- **WHEN** the window is 900 px wide
- **THEN** the sidebar is an 82 px icon rail, every item keeps an accessible name, and the resizer is not shown

### Requirement: Scrollbar appears only during navigation
The navigation scrollbar SHALL use a 4 px thumb that stays transparent except while the user scrolls, then fades after approximately 800 ms.

#### Scenario: Scroll the management navigation
- **WHEN** the user scrolls the sidebar navigation
- **THEN** a thin thumb appears during scrolling and hides shortly after scrolling stops

### Requirement: Themes and font scales
The window SHALL offer three themes, Dark, Light and Grey (DK's "mainscreen"), and three font scales, Small, Medium and Large, plus the existing imported custom theme. A first run SHALL default to Grey and Small, matching DK. Dark SHALL use the 0.4.95 renderer's inline `--mc-*` fallback values, Grey SHALL use the 0.4.69 build's `--dk-*` main-screen tokens, and Light SHALL use the warm text hints from the 0.4.95 renderer. Each font scale SHALL define the ten `--mc-font-*` roles. The selection SHALL be validated, persisted with a version, synchronised between renderer windows and applied before first paint. A stored version-1 appearance SHALL migrate with its theme preserved. Management motion SHALL stay within 160 ms and 4 px (decision 3). Source: CENTER-003, CENTER-004, MGMT-434; theming-animation-contract "Shared theme tokens".

#### Scenario: Fresh install
- **WHEN** no appearance is stored
- **THEN** the window renders the Grey palette at the Small scale

#### Scenario: Migrate a stored dark theme
- **WHEN** a version-1 appearance with theme `dark` is loaded
- **THEN** it becomes version 2 with theme `dark` and font scale `small`, and it is saved only after the next change

#### Scenario: Invalid stored settings
- **WHEN** the stored appearance has an unknown font scale
- **THEN** defaults are restored and the user sees that the saved appearance was invalid

### Requirement: UI settings popover
The sidebar footer's settings button SHALL open a popover (placement top-start, 280 px wide) titled "UI Settings" with two three-column segmented controls, "Font size" (Small, Medium, Large) and "Theme" (Dark, Light, Grey). Changes SHALL apply immediately. Escape and an outside click SHALL close it and return focus to the button. Source: CENTER-005.

#### Scenario: Change the font scale
- **WHEN** the user picks Large in the popover
- **THEN** every `--mc-font-*` role switches to the Large value without a reload and the choice persists

Audit regression coverage: CENTER-005.

#### Scenario: Dismiss and clean up the display popover
- **WHEN** the display popover opens and the user presses Escape or points outside it
- **THEN** the popover closes, focus returns to Display, and dismissal listeners are removed after closing or unmounting

### Requirement: Deep-link tab activation
Main SHALL be able to open the management window on a page through one typed command, and the renderer SHALL accept the same vocabulary from its launch URL. The aliases SHALL map as DK does: `claw`, `openclaw`, `clawcontrolpanel`, `agents` and `openclaw-agents` to Agents; `openclaw-ai` to Agents › AI Config; `meeting` and `meetingminutes` to Meeting; `emoji` to Emoji; `ai`, `aiplugin`, `shortcut`, `shortcuts` and `aishortcut` to Shortcuts; plus open-quake's own page IDs. Unknown names SHALL leave the current page and log a warning. Source: CENTER-013, MGMT-118.

#### Scenario: Open the AI config tab
- **WHEN** main sends the activation `openclaw-ai`
- **THEN** the window shows Agents with the AI Config tab selected

#### Scenario: Unknown tab
- **WHEN** main sends the activation `market`
- **THEN** the current page stays selected and nothing else changes

### Requirement: Title bar follows the theme
The management window's title bar SHALL follow the selected theme instead of the system appearance. On macOS it SHALL use an inset hidden title bar with a themed 52 px drag strip that clears the traffic lights. On Windows it SHALL use a 55 px themed title bar overlay whose colours update on every theme change. On every platform main SHALL set the native theme source to the theme's light or dark base, and the window background SHALL match the theme before the renderer paints. Source: CENTER-002, MGMT-012; bead `open-quake-nyd.1`.

#### Scenario: Dark app on a light system
- **WHEN** macOS is in light mode and the user selects Dark
- **THEN** the title strip uses the Dark title-bar colour and main's native theme source becomes `dark`

#### Scenario: Theme request from an untrusted sender
- **WHEN** a window other than the management window sends a title bar theme
- **THEN** main ignores it

Audit regression coverage: CENTER-002.

#### Scenario: Windows overlay follows each theme
- **WHEN** the Windows management window starts and receives valid theme updates
- **THEN** it uses the native 55 px title bar overlay and updates its background and symbol colors without replacing native window controls

### Requirement: Content panels and status card
Pages SHALL render inside the Management Center's content card (radius 10, 1 px border, surface colour). The footer status card SHALL show "QUAKE" with the live connection label, replacing DK's account card (account login is out of scope by decision 9). The product mark SHALL show the agent runtime state when Agents are enabled. Source: CENTER-007, CENTER-014 (replaced), CENTER-017.

#### Scenario: Device disconnects
- **WHEN** the device status changes to disconnected
- **THEN** the footer card announces the new state through a live region without moving focus

Audit regression coverage: CENTER-017.

#### Scenario: Workbench reflows after navigation
- **WHEN** Emoji, Shortcuts and Meetings are opened at narrow and wide viewport sizes
- **THEN** each content panel fits its scroll container without horizontal document overflow

### Requirement: Creation workflow entry points
Management navigation SHALL expose Emoji and AI Shortcuts as direct replacements for the recovered library plus-menu destinations. Each entry SHALL open the real creation workflow. Source: MGMT-118.

#### Scenario: Navigate to creation
- **WHEN** the user activates Emoji or AI Shortcuts from Keys
- **THEN** the corresponding mounted page permits creating an emoji package or adding a shortcut without losing the existing selected profile

### Requirement: Clear profile editing and activation
The Keys page SHALL label its profile selector as the profile being edited and SHALL show which profile is active on the device. When another profile is being edited, the page SHALL provide an explicit action that activates that profile through the profile manager's existing selection command.

#### Scenario: Activate the profile being edited
- **WHEN** the user edits a profile that is not active on the device and chooses "Make active on device"
- **THEN** the profile manager selects and delivers that profile, and the Keys page reflects the committed active selection

### Requirement: Honest Overview system monitor preview
The Overview screen preview SHALL use the monitor's collected snapshot when available. When no metrics are available, it SHALL show neutral unavailable values and SHALL NOT invent host or hardware names. Explicit sample previews in editors may continue to use labeled fixtures.

#### Scenario: Overview has no collected metrics
- **WHEN** the Overview screen preview has no live monitor sample
- **THEN** metric values remain unavailable and the preview contains no fabricated hardware or drive names
