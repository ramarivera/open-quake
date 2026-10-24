# System monitor panel

Implements `openspec/changes/system-monitor-panel`, WIDGETS-064–083. The strip's
`systemMonitorPanel` renderer uses the existing padded 8×2 slot. Its 1920×480
design stage scales to that slot, matching the recovered Vue stageStyle.
Management's Screen page has a labelled deterministic preview and draft/Save
settings. Editing does not register collectors or change the live panel until
Save. Settings currently belong to one local panel record, ready for the future
profile editor to address by profile. No foreground-window monitoring,
Bluetooth collector or monitoring override is implemented by this lane.

`packages/edge/src/monitor` owns metric schemas, module IDs and scoped workers.
Each module has one sequential worker. Slow requests cannot overlap or block
other modules. The stream retains a value as stale after three configured
intervals. Unmount, disable and shutdown interrupt workers. Rates are 0.2–10 Hz,
default 1 Hz. Sampling starts only for a registered live panel window.

The native adapter uses Node os for CPU load deltas and total/free memory. On
macOS it runs `/bin/df -kP`, `/bin/ps -A -o state=`, `/usr/sbin/netstat -ibn` and
`/usr/bin/pmset -g batt` via execFile, without a shell, with 2 s deadlines and
1 MiB output limits. GPU load/model and CPU/GPU temperatures are unsupported.
Non-macOS hosts expose CPU and memory; other modules remain unsupported.
Memory is os total minus free, not a claim about macOS memory pressure. Process
counts come from states, without process names or command lines. Network rates
need two counter samples and reset on interface change or counter rollback.

The local `monitor-v1/settings.json` stores revision and validated settings.
Atomic rename and revision checks preserve the previous record on write failure
or conflict. Invalid records show defaults with a recovery indicator. Selected
media lives in `monitor-v1/assets` under opaque IDs. Renderers cannot choose
paths or fabricate asset IDs. Images decode through nativeImage and normalize
to PNG, limited to 8 MiB input and 64 million pixels. Videos decode in an isolated
hidden sandboxed window, require ≥2 s duration, and time out after 6 s. Video
inputs are limited to 32 MiB. The decoder window closes in every outcome. Selected
bytes cross the bridge as data URLs; no path is exposed. Media selection is
staged until Save. Unreferenced staged assets are retained locally for now.
Built-in textures are original CSS artwork, not redistributed vendor images.

Unavailable values stay `--` at startup and on unsupported hosts. A confirmed
absent battery shows AC Power and no percentage or charging bolt. Per-field
absence remains distinct from a measured zero. The disk list uses smDiskList
with the shared gesture recognizer and fling runner. No native touch reader is
added here.

Run the native monitor smoke after building the app:

```sh
pnpm build
pnpm --filter @open-quake/desktop exec electron-vite build --config src/main/monitor/smoke.config.ts
env -u ELECTRON_RUN_AS_NODE OPEN_QUAKE_MOCK_DEVICE=1 \
  TMPDIR=/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/monitor-panel \
  pnpm --filter @open-quake/desktop exec electron out/monitor-smoke/smoke.js \
  /Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/monitor-panel
```

It drives real preload IPC, draft/Save controls, all five layouts, contrast,
missing images, video duration/playback, picker cancellation, window permissions,
disable/window-close cleanup and raw mock touch through the mounted disk list.
It writes five `panel-<style>-1920x480.png` captures and samples the actual
macOS command adapter. Windows/Linux native commands, physical QUAKE placement,
touch direction and actual display readability remain unverified. Never open
DK-Suite or real HID in a parity lane.
