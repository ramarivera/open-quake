# PR #24 review round 1 verification

Integrated origin/main 4f736cf, including strip-grid #23, touch #20 and hardware
controls #22. The merge retains geometry.tileAt, sub-touch discovery, panel-only
touch forwarding, hardware settings/preload and knob profile notifications.

## Fixes and direct checks

- PRRT_kwDOUADXpM6v28Jl: pointer input inverts root rotation and scale with
  clientToLogical. Physical picker input consumes mountStripTouch's normalized
  overlay channel. Both feed mountPickerTouch. Unit coverage uses rotation 90
  with viewport offset and scale. Native Electron loads rotation=90 in a
  480x1920 framebuffer, clicks the next arrow, emits physical previous-page and
  card taps through quake:event and verifies no underlying grid-key events.
- PRRT_kwDOUADXpM6v28Jm: KnobModel publishes failed dispatch catalog codes through
  its snapshot notice and requests best-effort error feedback. Native smoke
  drives registerKnobRuntime.onDevice for a failed focused action and hold,
  observes the rendered warning and proves private diagnostics stay out of the
  snapshot. Domain tests cover all four focus kinds and failed alert delivery.
- The desktop binds the current bus hardware session. Focused luminance uses
  stepBrightness and typed Luminance. An adapter-consumer test verifies the
  fake-HID command changes 255 to 229, focused volume writes 51 from 50, and an
  unsupported hotkey requests the existing error tone AI_ERROR [[90,200]].
  TestClock verifies a configured level 64 lasts 200 ms then sends zero;
  disabling the buzzer emits no tone. Native volume uses the existing macOS
  adapter for both focused volume and player mode.
- Ready picker mode sets ringVisible=false and the renderer also requires ring
  mode before drawing FunctionWheel. Domain and native tests prove both
  selector states. Captures were opened and inspected: the picker hint is
  visible and no arc or wheel label covers it.

## Gates

All commands passed in /Volumes/ExtSSD/devplane/oq-knob-model:

- pnpm biome check packages apps: 279 files, zero errors.
- pnpm typecheck: all six packages.
- pnpm test: protocol 47, device 360, edge 27, desktop 243 tests passed.
- pnpm build: production Electron main, preload and renderer built.
- pnpm --filter @open-quake/desktop test:bundle: HID absence and mock mode passed;
  mock mode resolves/enumerates no native HID modules.
- openspec validate --all --strict: 32 passed, zero failed.
- Native knob smoke: exclusive ring/picker, pointer and physical-touch paging
  at rotation=90, card selection, panel permissions, press arbitration,
  focus/volume and physical error warning passed.
- Native media smoke: parser/tracker/main bus/preload/mounted touch route,
  real grid hits/gaps, dynamic sub-touch registry, wallpaper/profile fixtures,
  themes, layout and awaited runtime disposal passed.
- Native hardware smoke: real preload/IPC into fake HID; firmware, LED,
  mic, luminance, alert-volume preferences and disconnected UI passed.

Native commands use env -u ELECTRON_RUN_AS_NODE OPEN_QUAKE_MOCK_DEVICE=1 and
TMPDIR under the knob lane scratch directory. All started Electron processes
exited. No real QUAKE, touch collection or DK-Suite was opened.

## Artifacts

Knob and media captures, plus gate logs:
/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/knob-model/review-round-1/

- function-wheel.png
- thumbnail-picker.png
- thumbnail-picker-page-2.png
- thumbnail-picker-rotation-90.png
- physical-error-warning.png
- volume-mode.png
- tile-dial.png
- media/panel-touch-complete.png and the media fixture captures

The hardware smoke enforces its own documented output prefix. Its captures are
in /Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/hw-controls/knob-model-pr24-review-round-1/.

Real direction, touch orientation, luminance acceptance, buzzer output and host
volume behavior remain hardware-unverified. Task 5.1/open-quake-lih.4.2 tracks
active profile-device identity, thumbnail production/invalidation, external
volume observation, monitor brightness/hotkey/voice composition and physical
focus/volume acquisition outside the picker. PR #24 remains unmerged.
