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

The mounted panel currently uses `mountStripTouch`, a DOM adapter. Tile hosts mark
`data-strip-key="1,1"`, `data-strip-covered="true"` for covered placeholders and
`data-support-touch-effect="false"` for sub-target hosts. It dispatches
`quake-strip-key` on `#root`; the action lane can subscribe or inject its direct
key sink when adopting the pure resolver. This lane does not execute key actions.
The grid owns type-specific touch flags. There is no second grid geometry model.

Set `#root.dataset.stripOverlay = "true"` to capture touch as
`quake-strip-overlay-touch` events. A direct controller can instead supply the
overlay's active predicate and point handler.

Sub-target hosts use `data-quake-sub-touch="id"` and optionally
`data-support-quake-move="true"`. Their bounds have a minimum 44×44 logical target.
The adapter observes DOM mutations/resize, repairs bounds on misses and rescans a
local tile at most every 500 ms. It preserves old entries when an empty scan is
transient. Clickables win overlaps. `quake-sub-touch-start` and
`quake-sub-touch-end` are non-bubbling events with typed `SubTouchEvent` detail.
Moving a scroll target repeats start, matching the recovered host convention.
Clickable taps confirm only on end within 16 px Euclidean slop and 500 ms. Moving
beyond slop permanently cancels the tap and hands off to a sibling scroller,
preferring `quakeBotIconViewMessages`. Disconnect and unmount cancel taps.

`createGestureRecognizer` accepts repeated HID points with injected timestamps.
It locks an axis at 6 px, requires 44×44 area and 24 px final span, samples 120 ms,
zeros velocity after an 80 ms pause and clamps speed to 5 px/ms.
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
