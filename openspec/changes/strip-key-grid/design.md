# Design

## Context

Sources, all read-only. `V` = `~/dev/dark-encyclopedia/dk-suite-introspeccion/v0.4.95/`,
`RS` = `V/recovered_sources/src/`. Abbreviations: QSV
`RS/views/DKQuake/QuakeScreenView.vue`, QSC `RS/views/Components/QuakeShortCutView.vue`,
UC `RS/views/Components/UnitControl.vue`, UCT `RS/shared/unitControlThemes.js`.
Audit rows come from `V/audit/AUDIT_SCREEN.md`, `AUDIT_WIDGETS.md`,
`AUDIT_MGMT.md` and `AUDIT_SETTINGS.md`. Approved parity decisions 2 and 3
(Ramiro, 2026-10-23, bead memory `parity-decisions-2026-10-23`) govern spans and
motion. Nothing here touched the QUAKE or ran DK-Suite.

## Goals / Non-Goals

Goal: the strip draws the active page's key grid the way 0.4.95 does, and the
management preview draws the same thing. Non-goals, each owned elsewhere:
per-type widget bodies (clock: strip-clock lane, `open-quake-lih.6`; monitor
panel: `lih.8`; chat, camera, player: later clusters), touch input and gestures
(strip-touch, `lih.3`), the knob dial overlay, FunctionWheel and profile switcher
(knob model, `lih.4`), per-tile display events (DSW later phase), built-in
profiles and the profile manager (`lih.9`), title i18n resolution (`lih.10`),
and the artwork adapter that turns DK resource ids into images
(`artwork-library`).

## Geometry (UCT:7-197, QSC:412-434, QSV:255-267)

The grid is `repeat(8, cell)` × `repeat(2, cell)` with `gap` and `padding: edge`
on a fixed 1920×480 design canvas. The column of cell `c` starts at
`edge + (c−1)·(cell+gap)`; a span of `w×h` cells measures
`w·cell + (w−1)·gap` by `h·cell + (h−1)·gap`.

| Theme | Used for | cell | gap | edge | radius | inner gap | colour scheme | Layers |
|---|---|---|---|---|---|---|---|---|
| `commonBaseTheme` | every other profile | 220 | 20 | 10 | 48 | 0 | rgb(116,128,239) | accent glow cover, accent gradient ring |
| `meetingAssistantTheme` | profile `1-1` / MeetAI | 236 | 4 | 2 | 24 | 0.04 | none | none |
| `systemInfoTheme` | profile `1-3` / SysView, cpu/gpu cells | 221 | 20 | 10 | 48 | 0 | rgb(0,255,255) | cyan bottom glow, cyan ring |
| `systemMonitorPanelTheme` | `systemMonitorPanel` cells | 220 | 20 | 10 | 0 | 0 | none | none |

`systemInfoTheme` sums to 1928×482. DK lets the grid overflow its 1920×480 box,
so column 8 ends at x 1918 and the right and bottom padding shrink to 2 px. We
keep that, clipped at the canvas edge.

Profile theme (UCT:206-283): compatibility `resourceId` `1-1` → meeting, `1-3` →
system info; else `titleKey` `meetingAssistant` / `systemMonitor`; else the exact
names {会议助手, Meeting Assistant, MeetAI} / {System Info, SysView, 系统信息, 系统监控};
else case-insensitive `meetai`, `meeting assistant`, `system info`, `sysview`;
else common base. In open-quake those inputs are `Profile.compatibility.resourceId`,
`Profile.compatibility.titleKey` and `Profile.name`. The built-in catalog
(`lih.9`) must set them for MeetAI and SysView.

Cell theme (UCT:313-329): `systemMonitorPanel` → panel theme; `cpuInfo`/`gpuInfo`
→ system info; `mic` on a page that holds any of `liveAudioTranslate`,
`tempMeetingMinutes`, `meetingRecordMark`, `meetingMinutes` → meeting; else the
profile theme. Grid geometry always comes from the profile theme. The cell theme
picks the tile's corner radius, layers and colour scheme.

## Footprints (decision 2)

One function replaces DK's four disagreeing span tables (MGMT-065). Forced spans
by type ignore `config.size` (QSC:1404-1590, UC:621-669, Utils.js:10-34,
monitorStyleContract.js:27-39):

| Type | Span |
|---|---|
| `playAudio`, `dkDesktopClock`, `systemMonitorPanel` | 8×2 |
| `liveAudioTranslateDisplay`, `aiChatView` | 5×2 |
| `gameMode`, `quakeBot` | 4×2 |
| `cameraView`, `cameraControlView` | 3×2 |
| `printerStatusView`, `quakeBotInput` | 2×2 |

`cpuInfo`/`gpuInfo` are not forced: UCT treats them as 2×1 only to pick an SVG
variant, while QSC lays them out from `config.size`.

Anchoring (QSC:4810-4933, QSV:2767-2848, MGMT-062/264): the rendered start column
is `min(anchor column, 9 − w)` and the start row `min(anchor row, 3 − h)`. That
one clamp reproduces every DK case: 2×1 at column 8 starts at 7, 1×2 or 2×2 in
row 2 starts in row 1, 3×2/4×2/5×2 clamp to 6/5/4, and 8×2 always starts at 1,1.
DK only handles the sizes in its table and gives any other size a one-cell slot.
The clamp also covers `[3,1]` and other sizes `profiles-key-grid` allows.

## Visible tiles and covered cells

Candidates are keys with a non-empty type and `config.display` true.
`profiles-key-grid` defines `display:false` as invisible and inert, and DK's
editor writes exactly that for covered cells (MGMT-064). Candidates are
accepted largest footprint first, then in row-major anchor order, and only when
none of their cells is already claimed. Accepted tiles claim their footprint.
Every claimed cell except the tile's own slot is covered: hidden, inert and
skipped by hit-testing (SCREEN-028). Unclaimed empty cells show the empty slot.
An unclaimed key that is hidden (`display:false`) shows a plain slot without the
dashed border and does not respond to touch.

For every layout `profiles-key-grid` accepts, all visible keys are accepted, so
the order only matters for raw imports. DK behaves worse there and we do not
copy it: hidden tiles keep covering their neighbours (QSV:2737-2752), and the
coverage helpers for forced types skip the edge clamp (QSC:4684-4808).

## Slot and tile visuals

Slot (QSC:4936-4975, 5155-5260): every visible cell gets a slot sized to its
area, `rgba(255,255,255,0.04)`, profile-theme radius (0 for `playAudio`), and
`transition: all 0.3s ease`. Empty slots add `2px dashed rgba(107,120,145,0.8)`
at opacity 0.7 (hover border `rgba(233,235,239,0.4)`). The "Empty Slot Dashed
Border" setting removes the border on both windows live; default on
(SETTINGS-013, SCREEN-030, MGMT-055). Enlarged slots sit at z 10.

Full-bleed (QSC:4977-5003): `playAudio` and `dkDesktopClock` fill the whole
1920×480 canvas at z 1, ignoring the edge padding, with radius 0 (the clock's
radius is 0 on the strip, UC:2683-2688). `systemMonitorPanel` stays inside the
padding at 1900×460.

Tile box: the full span area. DK's `getAreaSize` (QSC:1518-1522) gives spans
outside its table a single-cell tile inside a larger slot; we size the tile to
its slot.

Generic tile (UC:374-393, 560-958, 2436-2560, 3155-3545), with `box` the tile's
width and height:

- Icon: `floor(min(box)·0.7·0.7)` px square (107 px on a 1×1 at 220), centred.
  It is shifted down by 16.67 % of its height in common base and up by 10 % in
  other themes.
- Title: absolute, centred, one line. Size `floor(min(box)·0.2·0.7·s)`, where `s`
  is 0.7 for 2×2 and is multiplied by 0.9 in common base (27 px on a 1×1).
  `title.size` is ignored on the strip. In common base the title sits at top 9 %,
  weight 400, never italic. In other themes it sits at top 10 % or bottom 10 %
  from `title.pos`, weight 900 when the style has `bold`, italic when it has
  `italic`. The strip never underlines. Text is cut to fit 94 % of the box with
  a trailing `...` (DK's binary search). Colour comes from `title.color`.
- Accent: common base samples the icon at 12×12, skips pixels with alpha below
  50, brightness outside 30–225 or saturation below 0.1, averages the rest and
  multiplies by 1.2, clamped to 255 (UC:2910-3110). Without usable pixels it
  falls back to the theme's colour scheme, then rgb(116,128,239). Other themes
  use their colour scheme.
- Layers, from the CSS cascade. In common base, `.subBox.common-base-theme::before`
  (UC:3229-3256) overrides `.subBox::before` (UC:3293-3309) with the `background`
  shorthand. The `unitBg` glass rectangle is therefore never painted on the
  strip. What shows is the accent glow cover (`unitCover`: ellipse at 110,244 with
  radii 44×27 plus a circle of radius 44 at 110,129 at opacity 0.6, both blurred
  32, clipped to a radius-48 rectangle, scaled uniformly into the tile) and a
  2 px 135° ring in the accent from alpha 0.4 down to 0.02 (0.18 at the far end
  when the tile is at least two cells wide). System info paints its cyan bottom
  glow (`unitBg`, inset by the inner gap) and the same ring as `::after`. Meeting
  and panel themes paint no layers.
- Backdrop blur (33.28 px) is omitted. It blurs a uniform black canvas, so it has
  no visible effect, and DK itself drops it while the knob wheel turns (WIDGETS-012).

The tile reads `config.icon` only when it is an inline `data:image/` URL. Other
references draw no image until the `artwork-library` adapter exists.

## Motion (decision 3)

The strip press is DK's (QSC:5226-5236): the slot scales to 0.8 with
`0 0 25px rgba(255,255,255,0.4)`, through the slot's `all 0.3s ease`
transition. `playAudio` keeps its size. `aiChatView`, `cameraView`,
`cameraControlView` and `printerStatusView` show no press effect (QSC:1702-1708).
With reduced motion the glow shows without the scale or the transition. The
management window keeps the 160 ms / 4 px budget from `ui-theming`. Later strip
widgets may use DK's finite or looping motion (4 s dial ticks, 0.8 s wallpaper
crossfade) under the same reduced-motion rule.

## Layer stack (QSV:46-117, 427-433)

From the bottom: the wallpaper layer, then the grid container (opaque
`#000000`, z 10), then status overlays. DK shows the wallpaper only in vivid
(colorful) screen mode. In grid mode the black grid hides it completely. The
lane brief asked for the wallpaper as a visible layer behind the tiles. The
source contradicts that, and `device-screen-wallpaper` ("Later playlist and mode
behavior") also limits the wallpaper to colour-screen mode, so we keep DK's
order: the wallpaper sits underneath and shows only on a vivid page. A page is
vivid when it holds a `colorfulScreen` key, which is how the built-in catalog
(`lih.9`) encodes DK's `type: 0` menu entry. Before the first profile snapshot
arrives, the strip stays black (SCREEN-008).

The strip is a fixed device screen. Its palette (black canvas, 4 % slots, DK
accents) does not follow the app's light/dark theme. Status overlays drawn over
it (knob feedback, offline plate, mock label, profile load failure) keep using
theme tokens.

## Contracts with other lanes

- **Tile registry** (`strip/tileRegistry.tsx`): `stripTileFor(type)` returns a
  component that receives `StripTileProps` (key, theme, cell theme, box size,
  accent fallback, host clock). Unregistered types get the generic tile. The
  `dkDesktopClock` entry renders `ClockPlaceholder` with the strip-clock props
  `{ widthPx, heightPx, now, theme }`. The strip-clock lane swaps in `ClockTile`
  from `strip/tiles/clock/` by changing that one entry. `now` comes from the
  wallpaper snapshot's host clock. `theme` is the clock theme id, `"season"`
  until the clock lane reads it from the key.
- **Hit-testing** (`strip/geometry.ts`): `tileAt(point, layout)` takes a point in
  top-left canvas coordinates, as `normalizeTouch` produces, and returns the
  visible tile whose rendered rectangle contains it. That is the inward-anchored
  rectangle, not DK's anchor-based table (QSC:3028-3151): DK's version cannot hit
  the left half of a 2×1 at column 8. The result carries `keyCode`,
  `supportTouchEffect`, `hasTouchableSubElements` and `pressFeedback`, applying
  DK's forced overrides for `quakeBot`, `quakeBotInput`, `systemMonitorPanel`,
  `playAudio`, `playAudioLegacy`, `cameraControlView`, `cameraView`,
  `printerStatusView` and `dkDesktopClock`. DK treats a missing
  `supportTouchEffect` as true, but `profiles-key-grid` normalizes it to false
  and does not use it to gate execution. The touch lane decides activation.
- **Profile snapshot** (`main/profiles/profile-ipc.ts`): read-only. Main loads the
  envelope through `ProfileService`, pushes every committed snapshot on
  `profiles:snapshot`, and answers `profiles:read`. Failures carry only the
  catalog `code` and `message`. The renderer decodes the envelope with the
  shared Schema. The page comes from `activeByDevice[serial]`, otherwise the
  first profile's first page. Until device discovery supplies a serial, the
  serial is the wallpaper session's. Editing commands belong to
  `profiles-key-grid` task 2.1 and the profile manager (`lih.9.1.4`), which can
  extend this channel.
- **Preview**: `DeviceScreen` renders the same `StripScreen` scaled to its
  width. DK's mirror rescales the theme ratio separately (MGMT-051/052,
  SCREEN-134). One scaled component cannot drift from the panel.

## Reverse-engineering findings for dark-encyclopedia

1. The common-base `unitBg` glass is never painted on the strip (cascade above).
   SCREEN-033 and WIDGETS-006 describe it as drawn.
2. In QSC `getCellStyle`, the inner `let w, h` (4821) shadows the outer pair, so
   `alignStart` (4961) is always false. It has no visible effect because tile
   containers fill their slots.
3. DK's hit-test rectangles start at the anchor, not the inward-anchored slot
   (QSC:3038-3041 against 4851-4933).
4. The glow cover keeps its aspect ratio (SVG `meet`) inside wide tiles, so a
   2×1 glow stays round and centred. Common base has no `_2x1` variants.
5. `title.size` is unused on the strip (UC:2465-2487), and the strip never
   underlines (UC:2519-2533).

## Risks

- Accent sampling needs a canvas. Tests cover the pure pixel reducer; the
  canvas path runs only in the renderer.
- Icon references other than inline data URLs render no artwork until the
  artwork adapter lands, so imported DK profiles show glow and title only.
- Hardware: the 1920×480 canvas on the real strip, colours on its panel, and
  frame timing are unverified.
