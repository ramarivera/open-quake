# Desktop knob composition

Main consumes `QuakeEvent` rotation and firmware press classifications through
`registerKnobRuntime`. Renderer commands cannot inject physical events. Only the
actual panel window's top-level app document may mutate state; management can
read. Renderer validates replies and snapshots without native causes.
Shutdown interrupts streams, timers, pending writes and owned voice work.

Production shares the strip lane's `ProfileService` runtime and one serialized
repository for `profiles-v1.json`. `knobProfileBinding` reads committed profiles
and selects through `ProfileService.selectProfile`; successful writes publish
the new selection to both panel and management preview. The repository rejects
unknown profiles/pages and preserves the committed selection on write failure.
Committed profile notifications call `KnobModel.synchronize`, which resets changed
page/revision state while preserving a selector after its own commit.

The current serial is `desktop-preview`; device discovery still needs to supply
a device identity. A raw-storage adapter remains available for isolated consumers.
Native macOS volume supports player mode and focused volume tiles. No native
volume write runs in tests or smoke. Brightness, hotkey and voice ports fail with
the knob catalog's unavailable error until their owners supply
`DesktopKnobBindings`. Other platforms need a volume binding.

Thumbnail capture belongs to profile-manager. This consumer reads only
`<userData>/profile-thumbnails/<sha256(profileId)>.png`, limits the file to 1 MB,
checks its signature and requires Electron's image decoder to accept it. It
publishes data URLs, never caller-supplied paths or remote URLs. Producers must
invalidate thumbnails after edits and publish atomically. The default seeded
profile has no thumbnail and therefore uses the FunctionWheel.

Renderer overlays live entirely in `strip/overlays/knob/` and mount inside the
existing strip canvas. `KnobDial` and `VolumeCapsule` are exported for the strip
grid owner. Pass its actual tile dimensions and read-only state when composing.
`KnobPanelLayer` mounts in StripPanel and uses the actual strip layout for tile bounds. Tapping an unsupported grid tile clears focus. Physical
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
