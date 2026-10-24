# Desktop knob composition

Main consumes `QuakeEvent` rotation and firmware press classifications through
`registerKnobRuntime`. Renderer commands cannot inject physical events. Only the
actual panel window's top-level app document may mutate state; management can
read. Preload validates replies and exposes snapshots without native causes.
Shutdown interrupts streams, timers, pending writes and owned voice work.

The default adapter uses `profiles-v1.json` and its `desktop-preview` selection.
It reads the selected page, persists profile switches with the existing atomic
storage adapter, and uses macOS output volume for player mode and focused volume
tiles. No native volume write runs in tests or smoke. Brightness, hotkey and voice
ports fail with the knob catalog's unavailable error until their owners supply
`DesktopKnobBindings`. Other platforms need a volume binding.

Profile-manager integration should replace this standalone storage composition
with its serialized selection consumer and call `KnobModel.configure` whenever
the active device, page or committed profile revision changes. The desktop
registration currently reloads on connection. It has no profile-editor event
subscription because that transport is absent on this branch. Do not use two
independent writers for a future composed profile editor.

Thumbnail capture belongs to profile-manager. This consumer reads only
`<userData>/profile-thumbnails/<sha256(profileId)>.png`, limits the file to 1 MB,
checks its signature and requires Electron's image decoder to accept it. It
publishes data URLs, never caller-supplied paths or remote URLs. Producers must
invalidate thumbnails after edits and publish atomically. The default seeded
profile has no thumbnail and therefore uses the FunctionWheel.

Renderer overlays live entirely in `strip/overlays/knob/` and mount inside the
existing strip canvas. `KnobDial` and `VolumeCapsule` are exported for the strip
grid owner. Pass its actual tile dimensions and read-only state when composing.
`KnobPanelLayer` is the current panel mount and respects key spans. Physical
controller touch normalization belongs to its input owner; DOM pointer events
already implement card selection, drag-off cancellation, blank dismissal and
paging. A touch consumer should dispatch the same restricted Page/Select/Dismiss
commands after logical 1920 by 480 hit testing with `pickerTarget`.

## Native verification

Run from the worktree root. Both Electron windows stay hidden. No HID adapter
is imported by this smoke entry. Use an absolute lane directory for artifacts:

```sh
pnpm build
pnpm --filter @open-quake/desktop exec electron-vite build --config src/main/knob/smoke.config.ts
env -u ELECTRON_RUN_AS_NODE OPEN_QUAKE_MOCK_DEVICE=1 TMPDIR=/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/knob-model/tmp pnpm --filter @open-quake/desktop exec electron out/knob-smoke/smoke.js /Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/knob-model
```

This drives the production DeviceBus consumer, domain, IPC, preload and renderer
with mock action/voice/volume ports. It verifies native pointer paging/dismissal,
panel identity permissions, press arbitration and focus/volume dispatch, and
checks the production thumbnail reader against valid and truncated PNGs using
Electron decoding. Captures include ring, picker, page 2, volume and tile dial.
It does not qualify QUAKE direction, physical touch coordinates, monitor/panel
brightness, OS hotkeys, live voice or actual volume drivers.

The required wallpaper regression smoke remains documented in
`../media/README.md`; run it with the same mock environment and lane TMPDIR.

Source evidence and residual risks are in
`openspec/changes/knob-model-parity/design.md`. The 0.4.52 script supplies the
missing FunctionWheel script in the 0.4.95 map. Its client template removes the
old halo layer; the strip retains the cyan arc and directional glow. The 200 ms
angular nudge changes the client label's horizontal arc position while its
vertical offsets and side rotations stay fixed.
