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
volume write runs in tests or smoke. Focused screen luminance uses the current
hardware session's `stepBrightness`, which sends typed `Luminance` commands in
26/255 steps with minimum 25. Monitor brightness, hotkey and voice ports report
unavailable until their owners supply `DesktopKnobBindings`. Other platforms
need a volume binding. Physical failures publish the catalog code through the
model notice stream and render a warning. The current hardware session plays
its `error` tone, AI_ERROR [[90,200]], at Device Alert Volume; disabled or zero
volume remains silent. Alert failures cannot overwrite or recursively alert the
original failure.

Thumbnail capture belongs to profile-manager. This consumer reads only
`<userData>/profile-thumbnails/<sha256(profileId)>.png`, limits the file to 1 MB,
checks its signature and requires Electron's image decoder to accept it. It
publishes data URLs, never caller-supplied paths or remote URLs. Producers must
invalidate thumbnails after edits and publish atomically. The default seeded
profile has no thumbnail and therefore uses the FunctionWheel.

Renderer overlays live entirely in `strip/overlays/knob/` and mount inside the
existing strip canvas. `KnobDial` and `VolumeCapsule` are exported for the strip
grid owner. Pass its actual tile dimensions and read-only state when composing.
`KnobPanelLayer` mounts in StripPanel and uses the actual strip layout for tile bounds. Tapping an unsupported grid tile clears focus. The picker consumes
`mountStripTouch`'s normalized `quake-strip-overlay-touch` route and owns touch
while open, preventing underlying grid actions. Pointer input uses the inverse
root rotation and scale before the same card/page gesture consumer. The picker
and FunctionWheel never render together. Physical focus/volume acquisition
outside the picker remains owning-lane work.

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
rotation=90 pointer and physical-touch paging/card selection without grid
leakage, exclusive selector rendering, physical-failure warning publication,
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
