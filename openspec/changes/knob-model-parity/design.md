# Design

## Context

The desktop has strip-grid profile delivery, wallpaper and device-event forwarding, but no composed knob selector or voice runtime. The strip-grid lane owns base layout. Recovered artifacts are local-only and are cited, never redistributed.

## Decisions

Use an Effect.Service in the device knob domain, Schema commands/state and Effect Clock deadlines. One semaphore serializes inputs and timer commits; scoped timer fibers are interrupted on close, reconfiguration and disposal. Main publishes authoritative snapshots. Renderer uses the shared strip touch overlay channel for physical touch and inverse panel coordinates for pointer input, plus bounded visual coalescing. No timers that commit profiles live in React.

KnobModelPorts is the smallest composition interface: committed profile selection, focused tile actions, correlated voice events, volume read/write and thumbnail warming. Desktop shares the strip lane's committed ProfileService runtime; isolated adapters may use the existing storage adapter. Pending other lane runtimes fail with catalog capability-unavailable, never silently execute a different route. Injected native smoke adapters prove complete input-to-profile and volume/voice dispatch chains without hardware.

Voice stays in knob-push-to-talk: this change emits holdStart/release/interrupt/cancel with generation, device/profile revision, not STT/TTS implementation. The reconstructed 0.4.95 QuakeScreenView.vue:1268-1284 and background.js knobKeyPressListener both dismiss then continue double/hold, so dismissal prevents the focused picker profile from being committed but preserves Colorful jump/PTT.

Sources: v0.4.95/recovered_sources/src/views/DKQuake/QuakeScreenView.vue:919-1424,3213-3362; src/views/Components/QuakeProfileSwitcherOverlay.vue:112-382,406-636; src/views/Components/QuakeShortCutView.vue:1195-1392,3957-4007; src/shared/profileThumbnailContract.js; v0.4.95/app-resources/background.js handleDeviceData at char 761249 and _ipcKnobTurn at 2211604. Ring script: artifacts/recovered_sources/webpack:__dk-suite_FunctionWheel.vue:400-819,1084-1165,1620-1807. The src_views_Components_FunctionWheel.vue sibling has only a four-line normalizer, not the script.

## UI contract

Render in strip/overlays/knob and compose inside the existing rotated panel canvas. Picker and FunctionWheel are mutually exclusive, with current violet border and a moving white focus ring. Retain the recovered card ratio and locale strings. Use the strip-grid lane's overlay mount and layout without replacing its base layout. Dial and volume are exported tile components for that lane's mount point as well as the panel's current profile view.

## Risks / Trade-offs

- No real device access is authorized. Physical direction, touch orientation and driver behavior remain hardware-unverified.
- Monitor brightness and hotkey/voice runtimes belong to other lanes. Device-screen luminance uses the current hardware session; unsupported controls report unavailable with a warning and error tone.
- Thumbnail capture is profile-manager-owned. Consume ready managed thumbnails; missing files remain ring fallback. No external thumbnail URLs.

## Migration

Keep saved knob slots intact. Remove idle physical dispatch of them and correct the old planning text/tests. No DK-Suite storage changes or dependency additions.

## Composition handoff

Production now shares the strip lane's ProfileService runtime. A minimal
Schema selection command serializes under the profile repository mutex and
publishes only after persistence, so knob commits reach both panel and preview.
Committed-profile events synchronize page/revision changes without resetting a
ring after its own commit. Selection failure preserves the published envelope.
The adapter accepts a device-identity getter and reads the current serial's
committed profile/page. The parent root must supply `connection.info.serialNumber`
before enrollment and clear it on release; desktop-preview remains the isolated
fallback. Selection retains the existing manager-owned `select` callback. No
second profile runtime is introduced.

Manager captures and knob reads share the existing content-and-locale thumbnail
key under profiles/thumbnails. The canonical store bounds reads, validates with
Electron, and publishes through atomic rename. The manager exposes one hidden,
serialized, abortable capture entry point. Warming rejects late content/locale
results; registration invalidates the model cache on any catalog-content or
locale change, including inactive-profile edits at an unchanged revision. The
parent supplies the thumbnail/locale bindings and refreshes on locale changes.

Registration owns a read-only volume observer while the player is armed and
connected. Sequential one-second sampling has a three-second read timeout and
bounded native output. Session/disconnect/local-volume guards discard stale
results before the existing ObservedVolume command and its 500 ms guard. No OS
volume read or write ran in this backend implementation lane.

The adapter provides native macOS volume and composes the current hardware
session for typed screen luminance and error-tone feedback. Focused monitor
brightness and hotkeys still need qualified owners. Voice delegation is present
in the current root, but live speech and physical hold/release acceptance remain
open. Picker touch uses the shared normalized strip overlay route; physical
focus/volume acquisition outside the picker remains uncomposed. Root integration
and physical acceptance are parent-owned. See the desktop knob README for exact
bindings and verification limits.

Volume desired state is synchronous per detent; scoped native writes drain the
latest value without blocking input. Cached thumbnails survive a same-catalog
ring commit but not an unrelated configure or disconnect. No cold detent is
replayed. The source client template removes the independent halo layer, so its
unused color-cycle state is not rendered here. The cyan direction glow remains.

## Directional hotkey composition

Continue task 5.1 with the existing directional action contract: decrease uses
action 0 and increase uses action 1. Decode the entire committed HotkeyConfig
before choosing either action. Reuse hardwareKeyboardAdapter, which respects
device versus host input mode and owns key release. Never fall back to global
host input when that mode has no qualified adapter.

The desktop adapter reloads the canonical profile envelope on each focused
hotkey turn. It compares the loaded profile identity, serial, committed visible profile,
page and content with the knob snapshot before dispatch. It also rejects a
hardware session replaced while that read was pending. No renderer chord or
trace identity is trusted. Existing catalog errors retain their private causes;
a named span surrounds validation and keyboard dispatch before model feedback
catches the failure. No chord text is added to diagnostics. This adds no UI,
copy, dependencies or transport schemas. Monitor brightness stays an independent
unfinished production adapter; physical key receipt is separate acceptance.

## Host monitor brightness

The recovered ScreenBrightnessController and processBrightnessLevelConfig in
`dark-encyclopedia/dk-suite-introspeccion/artifacts/hid_quake_keywords.txt`
identify host monitor brightness separately from QUAKE luminance, with five-point
steps. Use DisplayServices on the main macOS display, one active Windows WMI
backlight, or one Linux sysfs backlight. Reject multiple ambiguous targets and
unsupported native responses. Never use the source's fabricated 50 percent or
keyboard fallback. This Mac mini's read-only DisplayServices probe returned 1000,
which is unsupported, so successful macOS writes remain unverified on this host.

A shared committed-focused-key resolver protects hotkeys and brightness with the
same device/profile/page/revision/content checks. The native owner serializes
read, clamp, set and readback, pins the target and checks cancellation before a
write. A mock device never mutates host brightness unless an explicit test
adapter is supplied. Native process IO has bounded time, output and cancellation;
sysfs numeric reads are bounded. A failed or unavailable read writes nothing.
Private native causes remain in the catalog error chain, with named spans before
consumer catches. This adds no dependencies, IPC schema, UI or copy.

Native qualification found that the Windows brightness provider on zeph returns no ReturnValue from WmiSetBrightness. Invocation errors propagate; the controller uses independent readback rather than assuming a numeric return code. The first probe's incorrect status check was corrected after read-only inspection confirmed the original brightness had been restored. MacBook DisplayServices and Windows WMI five-point writes and restoration passed. Native subprocess deadlines use hard termination so a child ignoring SIGTERM cannot outlive the bound.
