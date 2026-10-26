# Spec Delta

## Purpose

Render the active profile's key grid on the QUAKE strip and in the management
preview the way DK-Suite 0.4.95 draws it. Geometry, colours and timings are the
recovered values cited in `design.md`. Parity decisions 2 and 3 were approved by
Ramiro on 2026-10-23.

> **Visuals superseded (2026-10-25).** Ramiro rejected the DK-Suite imitation on the strip. Visual clauses in this delta (slot visuals, generic tile glow/ring/title metrics, DK press scale and glow) are superseded by `independent-device-design` (`device-visual-design`). Behavior clauses here remain authoritative.

## ADDED Requirements

### Requirement: Strip canvas and layer stack

The strip SHALL render on a fixed logical 1920×480 canvas that scales uniformly
to its window. From the bottom, the layers SHALL be the wallpaper, an opaque
`#000000` grid container, then status overlays. The grid container SHALL be
hidden and the wallpaper shown only when the active page holds a
`colorfulScreen` key. Before the first profile snapshot arrives, the strip SHALL
show only the black canvas. Covers SCREEN-002, SCREEN-003, SCREEN-008,
SCREEN-103.

#### Scenario: Grid page over a saved wallpaper

- **WHEN** a wallpaper image is saved and the active page holds hotkey tiles
- **THEN** the panel shows the tiles on black and the wallpaper is not visible

#### Scenario: Vivid screen page

- **WHEN** the active page holds a `colorfulScreen` key and a wallpaper is ready
- **THEN** the grid is hidden and the wallpaper fills the canvas

#### Scenario: Snapshot not yet received

- **WHEN** the panel opens before main delivers the profile envelope
- **THEN** the strip is black, with no default grid and no empty slots

### Requirement: Grid themes

The grid SHALL use the profile theme's cell, gap and edge: common base 220/20/10
radius 48, meeting assistant 236/4/2 radius 24, system info 221/20/10 radius 48,
monitor panel 220/20/10 radius 0. A cell's column SHALL start at
`edge + (column−1)·(cell+gap)`, and the same formula SHALL apply to rows. The
profile theme SHALL resolve in this order: compatibility `resourceId` `1-1` or
`1-3`; then compatibility `titleKey` `meetingAssistant` or `systemMonitor`; then
the exact names {会议助手, Meeting Assistant, MeetAI} or {System Info, SysView,
系统信息, 系统监控}; then their case-insensitive English forms; otherwise common
base. The cell theme SHALL be the monitor panel theme for `systemMonitorPanel`,
system info for `cpuInfo` and `gpuInfo`, and meeting assistant for `mic` on a
page that holds a meeting key. Any other cell SHALL use the profile theme. Covers
SCREEN-023, SCREEN-024, SCREEN-025, WIDGETS-003, WIDGETS-004, WIDGETS-005,
MGMT-052.

#### Scenario: MeetAI geometry

- **WHEN** the active profile's compatibility resourceId is `1-1`
- **THEN** cell `1,8` spans x 1682–1918 and y 2–238 with corner radius 24

#### Scenario: Custom profile geometry

- **WHEN** a profile named `Work` has no compatibility identity
- **THEN** cell `2,1` spans x 10–230 and y 250–470 with corner radius 48

#### Scenario: Meeting mic cell

- **WHEN** a common-base page holds `meetingMinutes` and a `mic` key
- **THEN** the mic tile uses meeting-assistant radius and layers, while the grid keeps common-base geometry

### Requirement: Tile footprints grow inward

A tile's span SHALL be 8×2 for `playAudio`, `dkDesktopClock` and
`systemMonitorPanel`; 5×2 for `liveAudioTranslateDisplay` and `aiChatView`; 4×2
for `gameMode` and `quakeBot`; 3×2 for `cameraView` and `cameraControlView`; 2×2
for `printerStatusView` and `quakeBotInput`. Any other type SHALL use
`config.size`. The rendered start column SHALL be `min(anchor column, 9 − width)`
and the start row `min(anchor row, 3 − height)`. One footprint function SHALL
serve the strip, the preview, hit-testing and `profiles-key-grid` occupancy.
Covers SCREEN-026, SCREEN-027, WIDGETS-002, MGMT-061, MGMT-062, MGMT-063,
MGMT-065.

#### Scenario: Right-edge span

- **WHEN** a `[2,1]` hotkey is anchored at `1,8`
- **THEN** it renders over columns 7–8 of row 1 at x 1450–1910

#### Scenario: Forced span ignores size

- **WHEN** a `quakeBot` key with size `[1,1]` is anchored at `2,7`
- **THEN** it covers columns 5–8 of both rows

#### Scenario: Bottom-row tall tile

- **WHEN** a `[1,2]` key is anchored at `2,3`
- **THEN** it renders over rows 1–2 of column 3

### Requirement: Covered cells are hidden and inert

Only keys with a non-empty type and `config.display` true SHALL render.
Candidates SHALL be accepted largest footprint first, then in row-major anchor
order, and only when none of their cells is claimed by an accepted tile. No two
rendered tiles SHALL share a cell. Cells inside an accepted tile's footprint,
other than its own slot, SHALL be hidden and SHALL NOT be returned by
hit-testing. Covers SCREEN-028, MGMT-064.

#### Scenario: Placeholders under a 5×2 panel

- **WHEN** a `liveAudioTranslateDisplay` key at `1,1` sits beside empty placeholders `1,2`–`2,5`
- **THEN** one slot covering columns 1–5 renders and the nine covered placeholders do not

#### Scenario: Conflicting raw import

- **WHEN** an imported page holds visible `[2,1]` keys at `1,7` and `1,8`
- **THEN** only the `1,7` tile renders, over columns 7–8

### Requirement: Slot visuals and empty slot setting

Every rendered cell SHALL have a slot with background `rgba(255,255,255,0.04)`
and the profile theme's radius (0 for `playAudio`). An empty slot SHALL add
`2px dashed rgba(107,120,145,0.8)` at opacity 0.7. The "Empty Slot Dashed Border"
setting SHALL default to on, persist locally, and update both windows without
reload. When off, empty slots SHALL have no border. Spanning slots SHALL stack
above single slots. Covers SCREEN-029, SCREEN-030, MGMT-055, SETTINGS-013.

#### Scenario: Border setting off

- **WHEN** the user turns off "Empty Slot Dashed Border" in management
- **THEN** the open panel's empty slots lose their border while filled tiles are unchanged

### Requirement: Full-bleed and panel tiles

`playAudio` and `dkDesktopClock` SHALL render at 0,0 over the full 1920×480
canvas with corner radius 0, ignoring the edge padding. `systemMonitorPanel`
SHALL stay inside the padding at the profile theme's 8×2 area. Any other tile
SHALL measure its slot area. Covers SCREEN-031, SCREEN-032.

#### Scenario: Clock tile bounds

- **WHEN** a `dkDesktopClock` key is the only visible key on a common-base page
- **THEN** its tile receives width 1920 and height 480 at canvas origin

### Requirement: Tile registry

Each key type SHALL render through a registered tile component that receives
the key, its cell theme, its box size and the host clock. A type without a
registration SHALL render the generic icon-and-title tile. `dkDesktopClock`
SHALL be registered with props `{ widthPx, heightPx, now, theme }` so the
strip-clock lane can replace the placeholder by changing one entry. Covers
WIDGETS-001, WIDGETS-018.

#### Scenario: Clock placeholder

- **WHEN** the active page holds a `dkDesktopClock` key
- **THEN** the registered clock tile receives widthPx 1920, heightPx 480 and the host clock time

#### Scenario: Unknown type

- **WHEN** a key's type has no registration
- **THEN** it renders as the generic icon-and-title tile

### Requirement: Generic icon-and-title tile

The generic tile SHALL draw a `floor(min(box)·0.49)` px icon, shifted down 16.67 %
of its height in common base and up 10 % otherwise. Its title SHALL measure
`floor(min(box)·0.14·s)` px, where `s` is 0.7 for 2×2 tiles and is multiplied by
0.9 in common base. In common base the title SHALL sit at top 9 %, weight 400,
upright. Elsewhere it SHALL sit at top or bottom 10 % per `title.pos`, weight 900
for `bold` and italic for `italic`. The strip SHALL never underline. Titles
SHALL be cut to 94 % of the box width with `...` and drawn in `title.color`.
Hidden titles SHALL not render. Common base SHALL draw the accent glow cover and
a 2 px accent ring fading from 0.4 to 0.02 alpha (0.18 at the far end when the
tile spans at least two columns). The accent SHALL come from the icon's averaged
saturated pixels scaled by 1.2, falling back to the theme colour scheme, then
rgb(116,128,239). System info SHALL draw its cyan bottom glow and ring. Meeting
assistant and monitor panel SHALL draw neither. Only inline `data:image/` icons
SHALL load. Covers SCREEN-022, SCREEN-033, WIDGETS-006, WIDGETS-007, WIDGETS-008,
WIDGETS-009, WIDGETS-011, WIDGETS-013, MGMT-056, MGMT-060.

#### Scenario: Common-base 1×1

- **WHEN** a hotkey with a visible title `Lock Screen` renders at 220×220 in common base
- **THEN** the icon is 107 px and the title is 27 px at top 9 % with weight 400

#### Scenario: Two-by-two title

- **WHEN** a `[2,2]` key renders in common base
- **THEN** its box is 460×460, the icon is 225 px and the title is 40 px

#### Scenario: Colourless icon

- **WHEN** an icon has no pixel with alpha at least 50, brightness 30–225 and saturation at least 0.1
- **THEN** the tile's accent is the theme colour scheme

### Requirement: Strip press motion

A pressed tile's slot SHALL scale to 0.8 with a `0 0 25px rgba(255,255,255,0.4)`
glow through an `all 0.3s ease` transition. `playAudio` SHALL not scale.
`aiChatView`, `cameraView`, `cameraControlView` and `printerStatusView` SHALL
show no press effect. With reduced motion requested, the glow SHALL show without
scaling or transition. Covers SCREEN-034, WIDGETS-010.

#### Scenario: Reduced motion press

- **WHEN** a hotkey is pressed while the OS requests reduced motion
- **THEN** its slot shows the glow at full size with no transition

### Requirement: Hit-testing contract

The strip SHALL export a pure `tileAt(point, layout)` that takes a top-left
canvas point and returns the rendered tile whose slot contains it, or nothing
for empty, covered, hidden or padding points. The result SHALL include
`keyCode`, `supportTouchEffect`, `hasTouchableSubElements` and `pressFeedback`.
The forced overrides SHALL apply: (false, true) for `quakeBot`, `quakeBotInput`,
`systemMonitorPanel`, `playAudio`, `playAudioLegacy`, `cameraControlView` and
`dkDesktopClock`; effect false for `cameraView` and `printerStatusView`. Covers
SCREEN-056.

#### Scenario: Left half of an inward span

- **WHEN** a `[2,1]` key anchored at `1,8` is rendered and the point is (1500, 100)
- **THEN** `tileAt` returns keyCode `1,8`

#### Scenario: Gap between cells

- **WHEN** the point is (240, 100) on a common-base page
- **THEN** `tileAt` returns nothing

### Requirement: Panel and preview render one strip

The panel window and the management `DeviceScreen` preview SHALL render the same
strip component from the same profile snapshot, wallpaper snapshot and setting.
Main SHALL push every committed profile envelope to both windows and answer read
requests. Failures SHALL expose only the catalog code and message. The page SHALL
be the device's `activeByDevice` selection. A newly enrolled serial without a
startup, reported or saved selection SHALL commit the first visible colorful
profile before publishing connection readiness. Until enrollment publishes, its
panel and handshake SHALL use that same fallback. A preview without a serial
and an invalid saved reference SHALL retain the first visible profile's first page. Covers SCREEN-134, MGMT-051, SCREEN-018.

#### Scenario: Saved profile reaches both windows

- **WHEN** main commits a profile revision
- **THEN** the panel and the preview render the new grid without reload

#### Scenario: Profiles unreadable

- **WHEN** main cannot read local profiles
- **THEN** both windows show a profile-unavailable status with code `QUAKE.PROFILE.READ_FAILED` and no diagnostic cause


### Requirement: Shared management host geometry

The device preview, profile thumbnail, key editor and panel SHALL retain one fixed 1920 by 480 strip canvas, scaled uniformly by the smaller host dimension ratio. Resizing SHALL preserve tile artwork, theme, edge and inner gaps, and proportional radii. Independent-device-design supersedes the recovered host border treatments: management previews SHALL use a one-pixel app hairline frame, the device bezel SHALL add no padding, and the panel SHALL add no frame. Filled tiles SHALL use flat surface plates and a one-pixel inset hairline, with a two-pixel accent inset on press. Passive previews SHALL remain inert, without a hover operation. Full-bleed clocks SHALL render a square face at the canvas origin. Evidence: MGMT-051, MGMT-056, MGMT-060, WIDGETS-011.

#### Scenario: Preview resize across hosts

- **WHEN** the same Quick, MeetAI or Clock profile renders in the panel, DeviceScreen, ProfilePreview and KeyEditor at 960 by 240, then resizes to 480 by 200 or 1200 by 120
- **THEN** the fixed canvas scales by 0.5 then 0.25, the hosts retain identical tile geometry, and the management previews cannot operate the tile
- **AND** common-base and meeting corners draw at 28 and 14 logical pixels, while the full-bleed clock face covers 1920 by 480 without rounding

### Requirement: Scoped rendered key runtime feedback

The strip SHALL consume decoded runtime feedback only for the rendered device, profile, page and key. Countdown updates SHALL use the real timer lifetime, disappear on expiry, and show Alarm only if expiry belongs to the active profile. Progress below 100 SHALL draw a bounded bar, 100 SHALL remove it, and invalid-operation feedback SHALL render a labelled chip. Link loss SHALL clear rendered state through the runtime reset. Chips SHALL have opaque backgrounds and progress SHALL remain six logical pixels high. Evidence: WIDGETS-107.

#### Scenario: Timer switches profile and disconnects

- **WHEN** a two-second timer advances one second, its profile becomes inactive, then it expires
- **THEN** its countdown stays hidden on the other profile and no alarm appears on returning
- **AND** a new active expiry shows Alarm, another key's 42 percent progress and Invalid operation stay scoped to that key, completion removes the bar, and disconnect removes all runtime feedback

### Requirement: Exact retained AI and Vivid layouts
The DKClaw catalog SHALL retain all recovered agent IDs, voice flags, TTS settings and knob route. Covered cells and hidden placeholders SHALL resolve through actual strip geometry. AI Chat SHALL occupy five by two cells with its immutable anchor. Vivid SHALL retain mode zero, empty artwork/actions and locked movement/overwrite. Sources: AI-146, MGMT-351, MGMT-353, MGMT-357.

#### Scenario: Catalog to rendered geometry
- **WHEN** DKClaw, AI Chat or Vivid is loaded from the shipped catalog
- **THEN** actual layout and hit testing preserve the exact anchors, spans, hidden cells and locks, and the catalog retains the saved actions and knob route

### Requirement: AI panel nested touch ownership
AI Chat, DKClaw and live translation panels SHALL suppress host-cell touch effects and pressed transforms while preserving nested touch delivery. Sources: AI-145, MGMT-357.

#### Scenario: Child interaction without host feedback
- **WHEN** a touch begins and ends on a nested AI panel control
- **THEN** the child receives its event, the host receives no key activation and has no pressed state, and the AI Chat copy control dispatches its saved text

#### Scenario: First HID connection without a saved profile
- **WHEN** a new serial connects without a configured startup, reported or saved profile
- **THEN** enrollment commits the visible colorful profile before hardware readiness
- **AND** the rendered grid and reportActiveProfile use that same profile
