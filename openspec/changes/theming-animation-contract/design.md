# Design

## Open decisions

These recommendations are implemented for review. None records Ramiro's approval.

1. **Token carrier: Proposed (pending Ramiro).** Use one typed TypeScript palette
   per theme, generating `--quake-*` CSS custom properties on the document root.
   Semantic tokens cover backgrounds, surfaces, text, borders, accent, accent text,
   success, and warning. CSS consumes these properties on both windows. Keep
   renderer appearance independent of Effect services and main/preload IPC.
2. **User-custom format/storage: Proposed (pending Ramiro).** Import a version-1
   JSON document with `name`, `base` (`dark` or `light`), and a nonempty `colors`
   object containing semantic token overrides. Accept only known keys and opaque
   six-digit hex colors; reject CSS expressions, URLs, unknown versions, and files
   over 16 KiB. Fill omitted colors from the base. Store the validated theme,
   selection, and motion preference together in localStorage under
   `open-quake.appearance.v1`. Sync windows through storage events and a renderer
   BroadcastChannel. Revalidate stored and received data. Storage failure leaves
   the current session usable and reports that preferences were not saved.
3. **Panel animation budget: Proposed (pending Ramiro).** Target 60 Hz, 16.7 ms per
   frame at 1920x480. Permit only finite opacity/transform feedback, up to 160 ms
   and 4 px travel, on changed statistics and management interactions. No looping
   pulses, layout animations, blur, image animation, or JavaScript animation loop.
   Keep-alive updates do not animate. Theme changes apply immediately. This is a
   design budget, not a measured hardware performance claim.
4. **Motion implementation: Proposed (pending Ramiro).** Use CSS transitions and
   keyframes. The existing surfaces need only short value and control feedback;
   a motion library would add runtime and approval cost without a current need.
5. **Reduced motion: Proposed (pending Ramiro).** Follow the live OS setting and
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
transport, new error class, or main/preload change is needed.

Vitest is already pinned at `4.1.11` in the workspace catalog. Add it to the desktop
devDependencies with `catalog:` and add a test script. This manifest/lockfile edit
is the explicit test-setup exception to the renderer-only implementation scope.
List the new desktop dependency under NEEDS APPROVAL in the PR.

Unit coverage includes property generation, valid/invalid custom documents,
stored preference validation, and reduced-motion precedence. Exercise theme
switching, import errors, persistence, live synchronization, and both surfaces in
a browser. Physical-panel placement and 60 Hz frame timing require hardware
verification and remain unverified.
