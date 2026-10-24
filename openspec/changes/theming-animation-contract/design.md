# Design

## Approved decisions

Ramiro's approval of these five decisions is recorded in commit `20e9fd1`.

1. **Token carrier: Approved (Ramiro, 2026-10-23).** Use one typed TypeScript palette
   per theme, generating `--quake-*` CSS custom properties on the document root.
   Semantic tokens cover backgrounds, surfaces, text, borders, accent, accent text,
   success, and warning. CSS consumes these properties on both windows. Keep
   renderer appearance independent of Effect services and main/preload IPC.
2. **User-custom format/storage: Approved (Ramiro, 2026-10-23).** Import a version-1
   JSON document with `name`, `base` (`dark` or `light`), and a nonempty `colors`
   object containing semantic token overrides. Accept only known keys and opaque
   six-digit hex colors; reject CSS expressions, URLs, unknown versions, and files
   over 16 KiB. Fill omitted colors from the base. Store the validated theme,
   selection, and motion preference together in localStorage under
   `open-quake.appearance.v1`. Sync windows through storage events and a renderer
   BroadcastChannel. Revalidate stored and received data. Storage failure leaves
   the current session usable and reports that preferences were not saved.
3. **Panel animation budget: Approved (Ramiro, 2026-10-23).** Target 60 Hz, 16.7 ms per
   frame at 1920x480. Permit only finite opacity/transform feedback, up to 160 ms
   and 4 px travel, on changed statistics and management interactions. No looping
   pulses, layout animations, blur, image animation, or JavaScript animation loop.
   Keep-alive updates do not animate. Theme changes apply immediately. This is a
   design budget, not a measured hardware performance claim.
4. **Motion implementation: Approved (Ramiro, 2026-10-23).** Use CSS transitions and
   keyframes. The existing surfaces need only short value and control feedback;
   a motion library would add runtime and approval cost without a current need.
5. **Reduced motion: Approved (Ramiro, 2026-10-23).** Follow the live OS setting and
   offer an in-app "Reduce motion" override. Either request suppresses all
   nonessential animation/transition on both windows, including already running
   animations. There is no override that defeats the OS preference. Persist and
   sync the in-app preference, and retain a CSS media-query safety net.

## Surfaces and inventory boundary

Read-only source: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`,
sections 2 and 9. Research files remain outside version control.

- Section 2 describes screen mirroring/binding, wallpaper selection/push, display
  event routing for clock/notifications/media, the remote socket bridge, and LED
  settings. Those future views must use the same tokens and motion rules. This
  lane themes the existing knob/touch/keep-alive panel and preserves its stable
  `open-quake panel` title and explicit mock-source label. It adds no hardware
  controls or unimplemented wallpaper/display content.
- Section 9 describes wizard/locale, general settings, device/firmware/brightness,
  AI configuration, firmware update/DFU, calibration, guide, and icon/template
  library. The management prototype retains event diagnostics and adds usable
  appearance controls and import feedback. Future settings/wizard views inherit
  the contract; this lane does not claim those subsystems are implemented.

## Implementation boundaries and verification

Pure TypeScript validation returns tagged success/rejection results for invalid
user input. Browser storage/file failures are handled at their renderer boundary
without displaying or logging raw causes or imported contents. No service layer,
transport, new error class, or main/preload change is needed. The renderer imports
the shared `QuakeEvent` and `OpenQuakeBridge` types from preload.

Live invalid storage updates restore dark/system defaults with the same safe
notice as startup. Invalid broadcasts remain ignored. The storage/channel
subscription is shared by the hook and event-driven regression tests. Renderer
event statistics accumulate across the subscription lifetime while retaining only
the latest 100 diagnostic events. Eviction cannot decrease totals or discard the
last keep-alive sequence.

Vitest is already pinned at `4.1.11` in the workspace catalog. Add it to the desktop
devDependencies with `catalog:` and add a test script. Main now provides that same
dependency and test script through PR #1; integration keeps both lanes' intent and
expands its Vitest include pattern to all `src/**/*.test.ts`. No new dependency is
needed for the event-driven regression tests.

Unit coverage includes property generation, valid/invalid custom documents,
stored preference validation, and reduced-motion precedence. Exercise theme
switching, import errors, persistence, live synchronization, and both surfaces in
a browser. Physical-panel placement and 60 Hz frame timing require hardware
verification and remain unverified.

## Amendment: strip motion and palette (strip-key-grid, 2026-10-24)

Approved parity decision 3 (Ramiro, 2026-10-23) puts DK-Suite's strip motion on
the strip: a 0.3 s press scale to 0.8 with a white glow, and DK's recovered
loops and crossfades for later widgets. Decision 3 above (160 ms, 4 px, no
loops) still governs the management window and the panel's status overlays.
Reduced motion still suppresses strip motion; a pressed tile keeps its glow
without scaling. The strip's tile palette is DK's fixed device palette, held
in one typed object, because the strip is a dark hardware display regardless
of the app theme. See `openspec/changes/strip-key-grid/design.md`.
