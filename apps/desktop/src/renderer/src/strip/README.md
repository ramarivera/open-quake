# Strip touch integration

`createStripTouchController` accepts the strip-grid lane's pure resolver:

```ts
type TileAt<Layout> = (point: Point, layout: Layout) => TouchTile | undefined;
interface TouchTile {
  readonly keyCode: string;
  readonly supportTouchEffect: boolean;
  readonly subTargets?: readonly SubTouchTarget[];
}
```

The resolver owns visible cells, spans, gaps and covered-cell exclusion. It receives
logical 1920×480 top-left coordinates. The input adapter converts bottom-left
vendor coordinates, with the recovered double flip at rotations 90/180. Do not
apply the CSS canvas rotation again. Portrait sub-target bounds can instead use
`portraitBounds`, whose source formula transposes the rectangle.

Ordinary keys emit `{keyCode, keyAction:0}` at touch-down and
`{keyCode, keyAction:1, voiceTouchEnd:true}` 10 ms after release. The initial key
stays held across slide-off. One ordinary key is active; every up releases it.
Only the first contact drives input in every phase. Pending ups flush before another down.
Disposal releases held keys and cancels timers. Profile overlays get a dedicated
point sink and own their whole gesture, including a release after hiding.

The mounted panel uses `mountStripTouch` with the current layout painted by
`StripScreen` and the pure `tileAt` from `geometry.ts`. Tile hosts use the grid's
`data-key-code` and `data-state="tile"` attributes only to locate sub-targets;
DOM rectangles never decide tile hits. The adapter dispatches `quake-strip-key`
on `#root`, and the held key drives `StripScreen` press feedback. The action lane
can subscribe or inject its direct key sink. This lane does not execute actions.
The grid owns spans, gaps, visible cells and type-specific touch flags.

Set `#root.dataset.stripOverlay = "true"` to capture touch as
`quake-strip-overlay-touch` events. A direct controller can instead supply the
overlay's active predicate and point handler.

Sub-target hosts use `data-quake-sub-touch="id"` and optionally
`data-support-quake-move="true"`. Their bounds have a minimum 44×44 logical target.
The adapter observes DOM mutations/resize, repairs bounds on misses and rescans a
local tile at most every 500 ms. Child and sub-target attribute mutations
invalidate membership before existing hits are accepted, so new clickables inside
known scrollers are discovered. It preserves old entries when an empty scan is
transient. Clickables win overlaps. `quake-sub-touch-start` and
`quake-sub-touch-end` are non-bubbling events with typed `SubTouchEvent` detail.
Moving a scroll target repeats start, matching the recovered host convention.
Clickable taps confirm only on end within 16 px Euclidean slop and 500 ms. Moving
beyond slop permanently cancels the tap and hands off to a sibling scroller,
preferring `quakeBotIconViewMessages`. Disconnect and unmount cancel taps.

`createGestureRecognizer` accepts repeated HID points with injected timestamps.
It locks an axis at 6 px, requires 44×44 area and 24 px final span, samples 120 ms,
preserves the initial sample timestamp, zeros velocity after an 80 ms pause and clamps speed to 5 px/ms.
`scroll-physics.ts` contains monitor physics and an injected animation runner.
`message-scroll.ts` contains the distinct chat drag/fast-flick policy. Widgets
supply their actual bounds, offsets, reduced-motion preference and animation
clock; these modules own no global timers. Call runner.stop at a new gesture or
unmount. Chat speed uses the documented exact 7.7 px/frame slow-pan cutoff to
avoid the floating-point 3.5×2.2 boundary drift in the source.

Voice key lifecycle, 350 ms release grace and action execution remain owned by
the voice/key lanes. They can use `connection.touch.setCaptureActive(true)` to
suppress inactivity lift during capture, then set it false to rearm the deadline.
The underlying device stream still reports missing-contact releases. Never use
capture suppression to infer an actual hardware release.

Source: local `v0.4.95/audit/AUDIT_SCREEN.md` SCREEN-005, 053–058, 061–068;
`AUDIT_AI.md` AI-163/206 and the cited recovered Vue/gesture modules.
# Strip renderer

Implements `openspec/changes/strip-key-grid`. The QUAKE strip and the
management preview (`ui/DeviceScreen.tsx`) both render `StripScreen` on a fixed
1920×480 canvas; `StripViewport` scales it to its container.

- `geometry.ts` is pure. It holds the four DK themes, profile and cell theme
  resolution, `stripLayout(profile, page)` (slots, tiles, covered cells, vivid
  page), and `tileAt(point, layout)`. Footprints come from
  `packages/device/src/profiles/profile-footprint.ts`, shared with
  `profiles-key-grid` occupancy.
- `tileRegistry.tsx` maps a key type to its tile component. Tiles receive
  `{ tile, context }`; `context` carries the host clock and saved hour format.
  Unregistered types draw `tiles/GenericTile.tsx`, DK's icon-and-title tile.
- `palette.ts` is DK's fixed strip palette. The strip does not follow the app
  theme; status overlays do.
- `useStripProfiles.ts` decodes the read-only `profiles:snapshot` channel from
  `main/profiles/profile-ipc.ts`. `selection.ts` picks the device's page.
- `stripSettings.ts` stores "Empty Slot Dashed Border" in localStorage and
  syncs it between windows.

## Seams for other lanes

- **strip-clock:** done. `ClockSlot` renders `tiles/clock/ClockTile`
  (`openspec/changes/desktop-clock`) with the clock store's theme, media and
  seconds option, ticking on minute boundaries from the host clock.
- **strip-touch:** call `tileAt(normalizedPoint, layout)`. It returns the visible
  tile whose rendered slot contains the point, with `keyCode`,
  `supportTouchEffect`, `hasTouchableSubElements` and `pressFeedback`, or
  nothing. Pass the held key to `StripScreen`'s `pressedKeyCode` to show DK's
  press.
- **knob / profile switching:** `selectStripPage(envelope, serial)` picks the
  page. A switcher can pass its own selection instead.

## Voice and chat (strip-voice-ui)

`overlays/voice/` draws the full-screen voice overlay, the mic bar, key
alerts and toasts from main's `voice:surface` events (`useVoiceSurface`).
`tiles/aiCopilot/`, `tiles/clawBot/` and `tiles/clawBotInput/` are the AI
Copilot, ClawBotView and ClawBotInput tiles. `tiles/voiceKey/` wraps the
generic tile for `aiChat`/`clawbot` keys with the cancel indicator and the
selected clawbot's dot. Tiles read `context.voice`; the management preview
gets `previewVoiceContext`, which renders no live chat. `StripScreen` takes
`voice`, `tileOverlay` (per-tile, above the tile) and `htmlOverlay` (above
everything).

Integration with the other strip lanes:

- **strip-touch:** `mountStripTouch`'s `onKey` callback feeds hold-to-talk
  keys to main's `GridVoice`, which applies every timing rule; pointer events
  on the panel cover the mouse and OS touch. AI tiles mark sub-targets with
  `data-quake-sub-touch` and listen for `quake-sub-touch-start/-end`;
  ClawBotView scrolls with `message-scroll.ts`'s chat physics.
- **knob model:** `useKnob()`'s selector mode sets `voice.wheelOpen` (chat
  cards go opaque, AI-207). Knob voice arrives in main through the knob
  model's `voice` binding and uses keyCode `0,1`.
- **hardware-controls:** tones play through `HardwareSession.playTone`; see
  `main/voice/README.md`.

## Verification

`geometry.test.ts` holds the property tests (no shared cells or pixels, inward
growth, covered cells hidden, valid layouts fully rendered, `tileAt`
agreement). `strip.test.ts` renders the fixtures in
`main/test/strip-fixtures.ts`. The native smoke in `main/media/smoke.ts`
captures `panel-<profile>.png` for each fixture. Hardware rendering on the real
strip is unverified.
