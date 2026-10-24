## Evidence

Research root: `/Users/ramarivera/dev/dark-encyclopedia/dk-suite-introspeccion/v0.4.95/`.
`audit/AUDIT_WIDGETS.md` WIDGETS-064–083, §3.2 and F6/F7 cite `recovered_sources/src/shared/monitorStyleContract.js`, `monitorViewModel.js`, `views/Components/SystemMonitorPanel.vue`, the five `SystemMonitorPanel*Canvas.vue` files and `MonitorStyleSettings.vue`. Labels come from `locales/locale-en.json` sysMonitor/sysMonitorPanel/sysMonitorText. Native pipeline evidence is `app-resources/background.js@1087700-1098700`. Read source without running DK-Suite.

## Design

Use a fixed 1920×480 stage in the existing monitor theme and tile registry, scaled to the theme-derived padded slot, 1908×462 on SysView and 1900×460 on common base as the recovered SystemMonitorPanel stageStyle does. Preserve strip-key-grid’s existing full-span versus full-bleed distinction. Preserve each recovered design's geometry, type sizes and colours; reimplement components rather than redistribute recovered source or vendor backgrounds. Built-in backgrounds are original CSS textures. Custom image/video slots are selected by the main-process dialog, validated there and addressed by opaque IDs, never renderer paths. Video must decode and last at least 2 s; probes time out and windows always close. Missing media falls back visibly without changing the saved slot.

One edge conductor owns timestamps, per-module availability and non-overlapping collection. CPU load needs two Node os samples; GPU and temperature are explicitly unsupported without a native dependency. Node os supplies memory; macOS commands via execFile with absolute binaries, no shell, bounded buffers/timeouts supply disk, process, network and battery data. Other platforms retain the Node subset and explicit unsupported states. Collection starts only for a mounted live panel; management uses the exact recovered deterministic fixture and never subscribes to metrics. Unmount, disabled sampling and app shutdown interrupt the scope. A previous value becomes stale after three configured intervals.

One local versioned settings record holds revision, style, background mode/slots, unit, master switch and sample rate. Management edits a local draft; Save uses revision comparison and an atomic rename. Revert discards the draft. The existing profile editor is not implemented yet, so the screen settings editor owns this panel record until per-profile configuration lands. This is a small interface for that lane, not a duplicate profile editor.

Missing metrics display `--` plus Unavailable/unsupported/error state from first paint. A confirmed absent battery displays `--` and AC Power. Never copy WIDGETS-076/083/091/092 startup zeros or fake battery. No disk data is distinct from a successful empty disk list. More than eight disks show the top eight by usage with an English overflow summary.

Disk rows declare `smDiskList` and move support. The existing mounted recognizer handles tap/drag conversion, vertical axis lock, fling, bounds, cancellation and reduced motion. No second native gesture recognizer is introduced.

## Scope and limits

This lane implements the seven panel modules and the collector subset needed for them, leaving foreground-window monitoring, Bluetooth and monitoring override tasks in system-monitor-tiles open. No hardware is opened. Native mock screenshots prove Electron rendering and bridge behavior, not physical device parity. This implementation needs no new dependency; exact-pinned dependencies with rationale are approved for parity work.

## Review round 1 corrections

Power source and battery state are independent optional facts. Preserve macOS's AC/Battery source and charging/discharging/charged/not-charging state through the metric contract. The recovered model infers source from presence and status from a boolean; this correction extends approved decision 4's truthful-value policy, WIDGETS-077/083. Unknown values carry no numeric unit in any style.

Keep the last successful metric separate from failed attempts. Errors do not replace its values or timestamp; its age alone controls the three-interval stale label. Recovery replaces the retained sample. Accept either external IPv4 or IPv6 addresses for link counters.

Settings transport loads only the active custom style's media. An explicit management-only style read supports draft previews of other saved styles. Hidden style slots remain metadata until requested, and sampling restarts read metadata without expanding media. Main checks the actual panel and management WebContents identities as well as the renderer URL and top frame. Only the current panel can subscribe; no thumbnail receives settings broadcasts or live metrics.
