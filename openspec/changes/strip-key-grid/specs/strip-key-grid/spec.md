# Spec Delta

## Purpose

Render the active profile's key grid on the QUAKE strip and in the management
preview with recovered DK-Suite 0.4.95 geometry and behavior. The accepted
`independent-device-design` owns the flat presentation. Parity decisions 2 and 3
were approved by Ramiro on 2026-10-23.

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
visible radius 28, meeting assistant 236/4/2 radius 14, system info 221/20/10 radius 28,
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
- **THEN** cell `1,8` spans x 1682–1918 and y 2–238 with corner radius 14

#### Scenario: Custom profile geometry

- **WHEN** a profile named `Work` has no compatibility identity
- **THEN** cell `2,1` spans x 10–230 and y 250–470 with corner radius 28

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

Filled slots SHALL have the opaque device `surface` fill and one hairline border.
Visible corners SHALL follow the accepted theme radii, with square full-bleed and
monitor-panel slots. Empty slots SHALL draw only a two-logical-pixel dashed `line`
border at full opacity. The "Empty Slot Dashed Border" setting SHALL default to
on, persist locally, and update panel and management without reload. When off,
empty slots SHALL have no border. Hidden slots SHALL stay inert and unbordered.
Spanning slots SHALL retain local layer 10, full-bleed slots layer 1, and knob
focus SHALL retain the opaque plate below its accent outline. Covers SCREEN-029,
SCREEN-030, MGMT-055, SETTINGS-013.

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

The generic tile SHALL use the flat device palette and code-native plate. Inner
padding SHALL be rounded 9 percent of the short edge. Icon size SHALL be rounded
min(42 percent of the short edge,168). Default title size SHALL be rounded
clamp(22,11 percent of the short edge,34), weight 550, upright and below the icon.
Explicit user styling SHALL determine title position and supported text style.
Titles SHALL be bounded by the inner width and ellipsized, and hidden titles
SHALL not render. Missing, delayed or colourless artwork SHALL retain the flat
plate without extracted accents, glow, decorative rings or theme SVG variants.
Only inline `data:image/` icons SHALL load. Covers SCREEN-022, SCREEN-033,
WIDGETS-006, WIDGETS-007, WIDGETS-008, WIDGETS-009, WIDGETS-011, WIDGETS-013,
MGMT-056, MGMT-060.

#### Scenario: Common-base 1×1

- **WHEN** a hotkey with a visible title `Lock Screen` renders at 220×220 in common base
- **THEN** the icon is 92 px and the default title is 24 px below it with weight 550

#### Scenario: Two-by-two title

- **WHEN** a `[2,2]` key renders in common base
- **THEN** its box is 460×460, the icon is 168 px and the default title is 34 px

#### Scenario: Colourless icon

- **WHEN** an icon has no saturated pixels
- **THEN** the tile keeps its flat device surface without extracting an accent or drawing a glow

### Requirement: Strip press motion

An eligible pressed tile SHALL use raised fill, a two-pixel accent inset ring,
and a 120 ms transition. Panel scale SHALL be 0.96 and management scale 0.98.
Visual feedback SHALL clear on release or after 200 ms independently of the held
action lifetime. `playAudio` SHALL not scale. Conversation, camera and printer
types, locked non-draggable previews and disabled editors SHALL suppress
whole-card feedback. With OS or app reduced motion requested, fill and ring SHALL
remain without scaling or transition. Covers SCREEN-034, WIDGETS-010.

#### Scenario: Reduced motion press

- **WHEN** a hotkey is pressed while the OS or app requests reduced motion
- **THEN** its slot shows raised fill and accent ring at full size with no transition

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
be the device's `activeByDevice` selection, otherwise the first profile's first
page. Covers SCREEN-134, MGMT-051, SCREEN-018.

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

### Requirement: Logical viewport updates and mirror fitting

The panel and management mirror SHALL fit the same fixed 1920 by 480 logical canvas uniformly, using the smaller positive host width/1920 and height/480 ratios. Nonfinite or nonpositive host dimensions SHALL use a safe scale of one until measurable. Display placement, load, rebind, DPI changes and macOS cover reinforcement SHALL retain that canvas; physical display dimensions SHALL NOT become logical artwork dimensions. Portrait framebuffers SHALL rotate the whole canvas, including wallpaper, grid, SVG and HTML overlays, as one unit. Management mirrors SHALL fit their available host rather than separately floor theme cells into the recovered 948 by 237 frame. Covers MAIN-052, SCREEN-006, SCREEN-126, SCREEN-134.

#### Scenario: Resize, DPI and portrait updates

- **WHEN** the panel is loaded, rebound, scaled at mixed DPI, or rotated into a portrait framebuffer and its mirror is resized
- **THEN** wallpaper, slots, overlays and touch targets share the same 1920 by 480 coordinate system, the same uniform scale, and the inward span anchors remain aligned
- **AND** invalid reference dimensions cannot create an infinite, negative or NaN transform

### Requirement: Normalized runtime empty cells

An absent or empty runtime cell SHALL carry only its keyCode in its placeholder record. Layout SHALL own its rectangle and empty or hidden state; the renderer SHALL NOT allocate unused key configuration or event payloads for empty slots. Runtime placeholders SHALL remain independent of new-editor key defaults, whose title display remains true. Hidden configured keys SHALL remain inert hidden slots. Runtime normalization SHALL NOT mutate saved keys or retain title, artwork or visibility from a previous profile. Covers SCREEN-022.

#### Scenario: Replace a profile with absent cells

- **WHEN** a profile with titles and hidden keys is replaced by a page with absent cells
- **THEN** all absent cells carry coordinate-only placeholders and paint empty slots without old titles or artwork

### Requirement: Accepted flat theme and span rendering

The recovered grid pitches, edge gaps, inward spans and system-info overflow SHALL remain authoritative. Independent-device-design SHALL govern plate colors, radii, title/icon metrics and feedback. All four themes and every supported span SHALL use the same code-native plate and image sizing, with no theme SVG variant selection, icon color extraction or fallback glow. Monitor-panel corners SHALL be square, including the slot. Enlarged slots SHALL keep local z-index 10, full-bleed slots 1. Knob focus SHALL retain the opaque plate under its accent outline rather than make the slot transparent. Covers SCREEN-023, SCREEN-029, SCREEN-033, SCREEN-126.

#### Scenario: Theme, span and artwork replacements

- **WHEN** common, meeting, system-info and monitor-panel tiles render at retained spans with missing, delayed or alternate artwork and long top or bottom titles
- **THEN** the accepted flat plate, clipped image, bounded title and proportional radius remain present with no glow or stale artwork

### Requirement: One explicit overlay stack

The strip SHALL isolate one layer stack. Wallpaper SHALL be layer 0, grid 10, shared SVG controls 30, and voice HTML 40. Inside SVG controls, picker 50000, wheel 100000 and notices 100001 SHALL order within that parent only. The near-opaque voice backdrop and STT row SHALL cover picker and wheel. Inside voice HTML, backdrop 1, the combined transcript/mic sheet 3 and toasts 4 SHALL preserve visibility. Key-local alert decorations SHALL remain layer 30 inside their tile. The accepted opaque wheel sheet replaces the vendor vignette. Covers SCREEN-003.

#### Scenario: Combined overlay visibility

- **WHEN** wallpaper, grid, picker, wheel, voice backdrop and transcript row are present together
- **THEN** each has the specified stacking parent and the voice sheet and transcript paint above the wheel without a decorative vignette

### Requirement: Live empty borders and bounded management feedback

The saved empty-border preference SHALL drive panel, device preview and KeyEditor through the shared settings subscription, including live changes and restart. Empty slots SHALL have a two-logical-pixel dashed line border at full opacity with no hover animation; hidden and filled slots SHALL never acquire that border. Management press feedback SHALL use the accepted raised fill and accent ring with a 120 ms transition and 0.98 scale. Panel scale SHALL remain 0.96. Locked non-draggable, disabled and conversation/camera/printer tiles SHALL suppress whole-card feedback. playAudio SHALL not scale. OS or app reduced motion SHALL remove scale and transition but retain fill and ring. Passive clock hover SHALL not resize or transform its face. Covers MGMT-055, MGMT-058, MGMT-059, SCREEN-030, SCREEN-034, SETTINGS-013, WIDGETS-010.

#### Scenario: Saved preference and feedback exclusions

- **WHEN** the empty-border preference changes while panel and editor are mounted and eligible, locked, hidden, disabled and conversation keys receive down/up or press expiry
- **THEN** both windows update empty borders immediately, only eligible keys show bounded feedback, and release or expiry clears it
- **AND** hovering the desktop clock preserves its geometry with no transform flicker

### Requirement: Full-grid replacement and compositor correctness

Every accepted configuration SHALL paint its complete visible grid immediately, independent of artwork readiness. Theme/config replacements, delayed artwork and wheel open/close SHALL not omit cells or retain stale key bodies in either panel or management preview. React's complete layout rendering replaces the recovered progressive gate and repaint nudge; no arbitrary 0/2/4/8-cell gate or forced compositor workaround SHALL be required. Covers SCREEN-035, SCREEN-036.

#### Scenario: Repeated sixteen-cell replacement

- **WHEN** sixteen keys repeatedly change profile, theme and artwork while the wheel opens and closes
- **THEN** all sixteen current keys remain painted in the panel and preview with their current titles and flat surfaces

### Requirement: Specialized recovered widget dispatch

The registry SHALL dispatch recovered monitor types to metric renderers consuming decoded monitor snapshots, and preserve existing clock, player, meeting, AI, emoji, home-assistant and OBS specializations. Unknown types SHALL retain the generic renderer. Missing camera/printer, AudioBot-session and reversible game-mode providers SHALL NOT be replaced with fabricated live readings or working controls. WIDGETS-001 remains incomplete until every recovered type has its actual specialized content and capability provider.

#### Scenario: Decoded live monitor tile

- **WHEN** a CPU, GPU, memory, disk, power, network, Bluetooth or process tile receives a valid metric snapshot
- **THEN** its specialized body shows the relevant available fields and explicit unavailable state, rejects malformed updates, and retains passive preview behavior

#### Scenario: Border preference invalidates manager and knob thumbnails

- **GIVEN** a profile has cached thumbnail pixels captured with empty borders on
- **WHEN** the saved empty-border preference changes without a profile edit
- **THEN** manager and knob cache identities include the new preference, existing manager captures are regenerated, and each hidden capture pins the preference used for its cache key even if it changes while rendering
- **AND** old captures from before border-aware cache identity are never reused

#### Scenario: Retained thumbnail pixels keep their capture style

- **GIVEN** the manager displays a cached thumbnail and the saved border preference changes
- **WHEN** regeneration is pending or fails and the manager retains the previous pixels
- **THEN** those pixels keep the border preference associated with their capture and remain stale
- **AND** a matching replacement becomes ready even when its image bytes equal the previous capture

#### Scenario: A failed style capture doesn't block other profiles

- **GIVEN** multiple profiles have cached thumbnails and one capture fails after the border preference changes
- **WHEN** the manager regenerates the images
- **THEN** it continues with the remaining profiles and publishes their new captures
- **AND** another request with the same preference retries failed captures without regenerating successful ones
