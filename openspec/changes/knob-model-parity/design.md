# Design

## Context

The current desktop has wallpaper and device-event forwarding but no composed profile selector or voice runtime. The strip-grid lane owns base layout. Recovered artifacts are local-only and are cited, never redistributed.

## Decisions

Use an Effect.Service in the device knob domain, Schema commands/state and Effect Clock deadlines. One semaphore serializes inputs and timer commits; scoped timer fibers are interrupted on close, reconfiguration and disposal. Main publishes authoritative snapshots. Renderer owns only geometry, pointer hit testing and bounded visual coalescing. No timers that commit profiles live in React.

KnobModelPorts is the smallest composition interface: committed profile selection, focused tile actions, correlated voice events, volume read/write and thumbnail warming. Desktop loads local profiles with the existing storage adapter. Pending other lane runtimes fail with catalog capability-unavailable, never silently execute a different route. Injected native smoke adapters prove complete input-to-profile and volume/voice dispatch chains without hardware.

Voice stays in knob-push-to-talk: this change emits holdStart/release/interrupt/cancel with generation, device/profile revision, not STT/TTS implementation. The reconstructed 0.4.95 QuakeScreenView.vue:1268-1284 and background.js knobKeyPressListener both dismiss then continue double/hold, so dismissal prevents the focused picker profile from being committed but preserves Colorful jump/PTT.

Sources: v0.4.95/recovered_sources/src/views/DKQuake/QuakeScreenView.vue:919-1424,3213-3362; src/views/Components/QuakeProfileSwitcherOverlay.vue:112-382,406-636; src/views/Components/QuakeShortCutView.vue:1195-1392,3957-4007; src/shared/profileThumbnailContract.js; v0.4.95/app-resources/background.js handleDeviceData at char 761249 and _ipcKnobTurn at 2211604. Ring script: artifacts/recovered_sources/webpack:__dk-suite_FunctionWheel.vue:400-819,1084-1165,1620-1807. The src_views_Components_FunctionWheel.vue sibling has only a four-line normalizer, not the script.

## UI contract

Render in strip/overlays/knob and compose inside the existing rotated panel canvas. Picker is subordinate to the ring visually, with current violet border and a moving white focus ring. Retain the recovered card ratio and locale strings. Do not change the strip-grid lane's files. Dial and volume are exported tile components for that lane's mount point as well as the panel's current profile view.

## Risks / Trade-offs

- No real device access is authorized. Physical direction, touch orientation and driver behavior remain hardware-unverified.
- Brightness and hotkey/voice runtimes belong to other lanes. Their ports must be composed explicitly; unsupported hosts report unavailable.
- Thumbnail capture is profile-manager-owned. Consume ready managed thumbnails; missing files remain ring fallback. No external thumbnail URLs.

## Migration

Keep saved knob slots intact. Remove idle physical dispatch of them and correct the old planning text/tests. No DK-Suite storage changes or dependency additions.

## Composition handoff

The standalone desktop adapter uses the existing `desktop-preview` selection,
including its selected page. A profile-manager composition must supply a
serialized selection port and call configure on device/page/revision changes.
The default adapter provides native macOS volume but intentionally reports
unavailable for unqualified brightness, hotkey and voice runtimes. Those runtimes
remain owned by their existing changes. Thumbnail producers write local hashed
PNG files atomically; readiness requires native decoding. The profile-manager
and physical touch transports are absent on this baseline. See the desktop knob
README for the exact handoff, mock smoke and unsupported runtime paths.

Volume desired state is synchronous per detent; scoped native writes drain the
latest value without blocking input. Cached thumbnails survive a same-catalog
ring commit but not an unrelated configure or disconnect. No cold detent is
replayed. The source client template removes the independent halo layer, so its
unused color-cycle state is not rendered here. The cyan direction glow remains.
