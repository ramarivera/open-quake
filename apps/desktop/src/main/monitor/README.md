# System monitor panel

Implements `openspec/changes/system-monitor-panel` and the software portion of
`system-monitor-tiles`, WIDGETS-064–083. The strip's
`systemMonitorPanel` renderer uses the existing padded 8×2 slot. Its 1920×480
design stage scales to that slot, matching the recovered Vue stageStyle.
Management's Keys page edits each panel's style, background, per-style managed
media and temperature unit through profile draft, Save and Cancel. Individual CPU
and GPU keys have the same unit control. Two profile keys retain independent
presentation across restart. Existing legacy monitor keys inherit saved global
presentation once before per-key ownership begins; explicit owned settings win. The Screen page owns global sampling controls and
shows a labelled sample preview alongside saved live status.

`packages/edge/src/monitor` owns metric schemas, module IDs and scoped workers.
Each module has one sequential worker. Slow requests cannot overlap or block
other modules. Failed attempts preserve the last successful values and timestamp;
the stream labels them stale after three configured intervals without recovery. Unmount, disable and shutdown interrupt workers. Rates are 0.2–10 Hz,
default 1 Hz. One shared worker group serves registered main-owned management
and panel windows. The last consumer detaching stops metric collection.
Thumbnails and URL-spoofed windows can't start or observe collectors.

`monitor-config.ts` owns unique metric selections and the native collection
method. The master switch gates metrics and app monitoring. A saved monitoring
override overlays the metric selection and rate; leaving it restores the latest
saved normal values. Normal edits under an unchanged override don't restart
workers. Legacy settings decode to all metrics, app monitoring off and an
inactive CPU-only 1 Hz override. The strip retains its seven modules; Bluetooth
has a separate individual tile and management status, outside the full panel.

App monitoring runs independently of visible metric consumers when saved as
enabled. It reuses the coalesced 500 ms foreground probe, with 3 s macOS / 2 s
other-platform polling and a 5 s deadline. macOS uses AppKit/CoreGraphics,
Windows uses the persistent user32 helper, and Linux uses X11 xprop. Unsupported
or unavailable sessions don't invent an identity. Disable and scoped shutdown
abort pending commands and await helper disposal. Only transient window id and
app path are held in memory; no titles or app history are collected or stored.
The UI shows the app display name, never its path or id.

The schema-first `monitoring.snapshot` RPC and validated state subscription are
management-only. The panel receives the same metric snapshots, without app
identity. `packages/client/src/monitor.ts` validates messages and drops late
delivery after unsubscribe. `MonitorStore` remains the sole persistence owner;
its accepted atomic write settles in memory and on disk even if a caller exits.

The native adapter uses Node os for CPU deltas and memory. macOS uses df, ps,
netstat and pmset, plus optional IOAccelerator GPU utilization, cached `sysctl`
model identity and system_profiler Bluetooth inventory. Windows uses fixed local
PowerShell CIM/Get-NetAdapter scripts over typed stdio, with optional nvidia-smi
GPU load/temperature. Linux
uses df, ps, proc network counters and sysfs GPU, CPU-temperature, power and
Bluetooth data, with optional nvidia-smi. No vendor service or socket starts.
Commands have two-second deadlines and one-MiB output limits. Disk and Bluetooth
inventory cache for at most sixty checks. Detaching the last subscriber clears
caches and counter baselines. Retained metrics become stale after three intervals
and expire after sixty failed checks. CPU temperature on macOS and Windows, and
GPU temperature on macOS, remain absent without a qualified provider. Memory is
os total minus free. Network rates need two samples and reset on interface change,
counter rollback or stream restart. Battery presence, source and charging state
remain independent. Unsupported or denied fields stay absent. macOS has no
unprivileged temperature source in the current command/native toolset.
IOAccelerator exposes utilization but not CPU/GPU temperatures, and
`powermetrics` requires elevated privileges. The panel reports
`Not available on this Mac` for those temperature fields.

The local `monitor-v1/settings.json` stores revision and validated settings.
Atomic rename and revision checks preserve the previous record on write failure
or conflict. Invalid records show defaults with a recovery indicator. Selected
media lives in `monitor-v1/assets` under opaque IDs. Renderers cannot choose
paths or fabricate asset IDs. Images decode through nativeImage and normalize
to PNG, limited to 8 MiB input and 64 million pixels. Videos decode in an isolated
hidden sandboxed window, require ≥2 s duration, and time out after 6 s. Video
inputs are limited to 32 MiB. The decoder window closes in every outcome. Selected
bytes cross the bridge as data URLs for only the active custom style; other
styles remain metadata until management explicitly previews them. Sampling
restarts use metadata without loading media. No path is exposed. Profile keys store opaque managed IDs, and trusted panel and
management windows resolve only the selected key's slot. Media selection is
staged until Save. Unreferenced staged assets are retained locally for now.
All five compatibility styles use hand-authored flat CSS layouts under the
independent-device-design palette. DESIGN.md records ownership and the explicit
replacement of vendor blur, textures and decorative animation.

Unavailable values stay `--` at startup and on unsupported hosts. A confirmed
absent battery shows `AC power · no battery` and `No battery` in the capacity
readout, with no percentage or charging bolt. Per-field
absence remains distinct from a measured zero. Unavailable readouts omit numeric
units, including analog temperatures, ticker rates and disk percentages. The disk list uses smDiskList
with the shared gesture recognizer and fling runner. No native touch reader is
added here.

Run the native monitor smoke after building the app:

```sh
pnpm build
pnpm --filter @open-quake/desktop exec electron-vite build --config src/main/monitor/smoke.config.ts
env -u ELECTRON_RUN_AS_NODE OPEN_QUAKE_MOCK_DEVICE=1 \
  pnpm --filter @open-quake/desktop exec electron out/monitor-smoke/smoke.js \
  /path/to/monitor-smoke-artifacts
```

Pass an explicit scratch directory for artifacts. The smoke creates it if needed.

It drives real preload IPC, draft/Save controls, all five layouts, contrast,
missing images, video duration/playback, lazy saved-style previews, picker
cancellation and main-owned window permissions. Thumbnails, including spoofed
panel URLs, cannot read, subscribe or receive settings broadcasts. It also checks
disable/window-close cleanup and raw mock touch through the mounted disk list.
Saved CPU-only override, normal edits while active, restoration, master disable,
foreground mock absence and shared failure snapshots run through the actual
controls/preload/IPC. Inner scroll containers are checked for horizontal overflow
at 1180, 820 and 390px, with captures of the preview, live state and controls.
It writes five `panel-<style>-1920x480.png` captures and samples the actual
macOS command adapter. Windows/Linux native commands, physical QUAKE placement,
touch direction and actual display readability remain unverified. Never open
DK-Suite or real HID in a parity lane.
