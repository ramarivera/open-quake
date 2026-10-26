## ADDED Requirements

### Requirement: Independent visual identity
The management window SHALL use open-quake's own visual system instead of DK-Suite's recovered palette and geometry. The built-in themes SHALL be Graphite (id `grey`, default), Midnight (id `dark`) and Paper (id `light`), each defined only through the nine-token custom-theme contract. One accent colour SHALL mark primary actions, the current selection and keyboard focus. Success, warning and danger colours SHALL appear only for state, together with text. The window SHALL NOT use glass effects, decorative gradients, bevelled hardware bezels or skeuomorphic knob drawings. Every built-in theme SHALL keep foreground text at 7:1 or more and muted text at 4.5:1 or more against both the background and the surface, control borders at 3:1 or more against the surface, and accent-text on the accent at 4.5:1 or more. This supersedes the DK palette sources in management-center "Themes and font scales".

#### Scenario: Fresh install
- **WHEN** no appearance is stored
- **THEN** the window renders the Graphite palette at the Small font scale, and the UI settings theme control offers Graphite, Midnight and Paper

#### Scenario: Stored theme ids survive the rename
- **WHEN** a stored appearance selects theme `dark`
- **THEN** it loads unchanged and renders the Midnight palette

#### Scenario: Theme contrast
- **WHEN** the theme tests evaluate each built-in palette
- **THEN** every listed pair meets its contrast minimum

Audit regression coverage: MGMT-004, MGMT-012.

#### Scenario: Shared typography and chrome
- **WHEN** a management or auxiliary window renders at either supported viewport width
- **THEN** the platform font fallback, editable text selection, link states and title strip drag exclusions remain usable

### Requirement: Semantic tokens and shared controls
The renderer SHALL expose semantic `--oq-*` custom properties for surfaces, lines, text, accent, state, focus, radius, spacing and floating elevation, all derived from the theme contract. The legacy `--mc-*` colour names SHALL resolve to them. Shared controls SHALL provide secondary, primary, quiet and danger buttons; label-above fields; underline tabs that mark the selected tab with the accent; toned badges; and a single bordered in-flow container. An `.mc-panel` section SHALL render without its own border or background, so bordered containers do not nest. Shadows SHALL appear only on floating layers (popovers, menus, dialogs, drawers).

#### Scenario: Primary action stands out
- **WHEN** a view renders a primary button next to secondary buttons
- **THEN** only the primary button is filled with the accent colour

#### Scenario: Panels do not nest borders
- **WHEN** a page places a card inside an `.mc-panel` section
- **THEN** only the card draws a border

### Requirement: Management navigation
The sidebar SHALL list Overview, then the sections Device (Keys, Knob profiles, Screen, Controls, Connection), Assistant (Agents, AI shortcuts, AI emoji, Meetings), Integrations (Home Assistant) and App (Appearance, Settings). Every row SHALL show a text label next to its icon. Exactly one row SHALL carry `aria-current="page"`, shown by the accent-soft fill and accent icon. At 1180×860 every row SHALL be visible without scrolling the sidebar. The title strip SHALL show the current section and page, plus the device connection status as text. Route ids, deep-link activation, the resizer and the persisted sidebar width SHALL keep the behaviour specified in management-center.

#### Scenario: Every page visible
- **WHEN** the window is 1180×860 at the Small font scale
- **THEN** all thirteen navigation rows are within the sidebar's visible area

#### Scenario: Deep link still selects the page
- **WHEN** main sends the activation `openclaw-ai`
- **THEN** the Agents row is current and the AI Config tab is selected

Audit regression coverage: MGMT-013, MGMT-025, MGMT-048.

#### Scenario: Navigate from device settings to the workbench
- **WHEN** the user selects Agents from the visible management navigation
- **THEN** the existing management window shows the Agents page and retains the shared title strip at narrow and wide widths

### Requirement: Narrow navigation drawer
Below a 760 px window width, the sidebar SHALL collapse into a top bar holding the product name, the current page name and a button labelled "Menu". The button SHALL expose `aria-expanded` and `aria-controls`. Opening it SHALL show the full labelled navigation as a drawer. Choosing a page or pressing Escape SHALL close the drawer and return focus to the Menu button. The window SHALL NOT fall back to icon-only navigation at any width.

#### Scenario: Navigate at 390 px
- **WHEN** the window is 390 px wide and the user opens Menu and chooses Keys
- **THEN** the Keys page shows, the drawer closes, and focus returns to the Menu button

#### Scenario: No horizontal overflow
- **WHEN** any management page renders in a 390 px viewport
- **THEN** the document does not scroll horizontally

### Requirement: Page layouts
The content column SHALL apply a per-page layout. Settings and form pages SHALL use a measure of at most 880 px, Overview SHALL use up to 1200 px, and Agents SHALL use the full content width with reduced padding so the conversation workspace can lay out its own columns. Page headers SHALL show the section name as a kicker, the page title, an optional description and right-aligned actions that wrap below the title on narrow widths.

#### Scenario: Agents is full-bleed
- **WHEN** the Agents page is open in a 1180 px window
- **THEN** the page content is not limited to the 880 px measure

### Requirement: Flat device overview
The Overview SHALL show the real strip preview (the same StripScreen as the panel) in a flat 1 px frame, the connection headline and detail with a status dot and text, a link to edit the screen, the connection facts, and live input as numeric counters with the recent-activity list. It SHALL NOT draw a knob cap, detent ring or bezel gradient.

#### Scenario: Knob input
- **WHEN** the mock device reports a rotation
- **THEN** the Turns counter increments and the activity list shows the event, with no decorative dial
