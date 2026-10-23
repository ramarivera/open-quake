# Design

## Context

Inputs are inventory section 2, the first-release wallpaper/clock cut, later phases, and open question 6 in `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`. `RS` means `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion/artifacts/recovered_sources/`; `ATL` is its parent `dk-suite-introspeccion/`. S = recovered source, P = partial evidence, N = names only. No display or HID hardware has been tested here.

## Goals / Non-Goals

Keep panel rendering, local wallpaper settings, and device resource delivery individually observable. Reuse the panel window placement and theme contracts already proposed elsewhere. Do not define raw frame encoders, arbitrary screen capture, a LAN remote-control service, or LED/RGB settings in this change.

## Evidence ledger

| Item | Tier | Source and observed behavior | Contract consequence |
|---|---|---|---|
| Panel dimensions | S | `RS/webpack:__dk-suite_src_views_DKQuake_QuakeScreenView.vue`, vertical style and calculated layout use a 1920x480 content area | Logical canvas 1920x480, desktop display binding is a separate adapter |
| Wallpaper persistence | S | Same file, loadWallpaperDisplay; `RS/webpack:__dk-suite_src_views_Components_ColorfulScreenSettings.vue`, loadSettings/saveSettings: dkquake.wallpaperDisplayInfo plus serialNumber | Inventory's profile-keyed shorthand is incorrect for this recovered version; use per-device serial settings |
| Wallpaper schema/defaults | S | `RS/webpack:__dk-suite_src_utils_defaultWallpaperDisplay.js`: isTransparent false, cover, gapInterval 5, unit 0, sequential, five MP4 defaults with 5000-ms placeholders | Preserve schema, but do not redistribute bundled Aurora/Matrix/car/cityofnight/mountain videos |
| Wallpaper editor | S | `RS/webpack:__dk-suite_src_views_Components_ColorfulScreenSettings.vue`: contain/cover/center, sequential/random, seconds 3..86400 or minutes 1..1440; image interval duration; video metadata duration with minimum 2 seconds; notify-remote-wallpaper-changed includes serialNumber | Specify units, validation, and serial-scoped notifications |
| Renderer playlist | S | `RS/webpack:__dk-suite_src_views_DKQuake_WallpaperView.vue`: two layers, muted videos, 800-ms fade, image timer/video metadata, singleton video loops, random retries at most 10 | Local renderer playback is established; do not call this proof of HID video transfer |
| Color-screen gating | S | `RS/webpack:__dk-suite_src_views_DKQuake_QuakeScreenView.vue`, shouldShowWallpaper requires color-screen mode, not transparent, nonempty list; WallpaperChanged reloads settings | Mode and transparent state control rendering |
| Raw JPEG decoding | S | `RS/webpack:__dk-suite_src_main_DeviceControl_Connections_ProtocolUtil.js`, checkDataValid/checkAndDecodeValidData: 0xA2 opcode 2 yields resourceType, keyCode, dataSequenceId, bytes; RES_TYPE_JPEG = 0 | Evidence for keyed JPEG shape; byte encoders remain L1-owned |
| Resource assembly and icon use | P | `RS/webpack:__dk-suite_src_views_DKQuake_RemoteSocketClient.vue`, processRawResourceData appends bytes until sequence 0, emits data:image/jpeg; QuakeScreenView.handleShowRawData assigns a cell icon | This proves a desktop receiver path, not a hardware full-screen wallpaper address or successful USB delivery |
| Hardware semantics unresolved | P | `ATL/DK_SUITE_INSIGHTS.md`, What still needs work item 2; `ATL/SUBAGENT_PROTOCOL_ANALYSIS.md`, resource wrapper | JPEG format limits, chunk timing, acknowledgments, and hardware key-code mapping still need validation |
| Display overlays | S | `RS/webpack:__dk-suite_src_views_DKQuake_DisplayEvent.vue`, currentEvent watcher: countdown time ms, alert types 0..3, progress percent, meeting stage relay | Inventory's inferred notifications/media wording is broader than the actual component |
| Clock | S | `RS/webpack:__dk-suite_src_utils_DefaultProfileData.js:40`, hourFormat 24h; `RS/webpack:__dk-suite_src_views_Components_dkDesktopClock.vue`, displayHour/ampm | Clock is a renderer tile with 12h/24h formatting, not a recovered clock wire event |
| Local socket | P | `RS/webpack:__dk-suite_src_views_DKQuake_RemoteSocketClient.vue`, connect: ws://localhost:<serverPorts.WSServerPort default 20230>?sn=...; onopen sends reportConfig then reportActiveProfile | First-release in-process typed IPC can replace this bridge; hardware-server-side or LAN handshake is not established |
| Screen binding | N/P | `ATL/artifacts/ipc_channels.txt`, trigger-quake-screen-bind; QuakeScreenView.handleShowGlobalAlert contains a commented invocation under a multi-screen TODO | Do not infer arbitrary app/window mirroring from the IPC name |

## Decisions

### Approved (Ramiro, 2026-10-23): ownership and two rendering paths

`packages/device` owns display-contracts, display-invariants, display-service, and the resource transfer coordinator built over L1's device service. `apps/desktop` owns local media repository, image decode/encode/composition adapters, clock source, and shared panel/preview components. Store validated serial-scoped settings in main; publish complete versioned display snapshots through decoded IPC. Renderer code has no raw HID access. The panel consumes `panel-window-prototype` placement and `theming-animation-contract` tokens/motion behavior without redefining those specs.

Use Effect services with declared dependencies, named methods and explicit error types. Catalog errors distinguish InvalidWallpaper, MediaUnreadable, ResourceTargetUnverified, ResourceTransferFailed, and DisplayBindingUnavailable. Keep path and image bytes out of public diagnostics, retain original causes privately, and serialize only scrubbed projections. If these contracts later cross edge/client, define RPC schemas first. No WebSocket server is required for the local-only release.

Keep two statuses: desktop render revision and device resource delivery. A renderer can show a full wallpaper while an A2 transfer is unavailable. That must remain visible in the management status, because the inventory requires actual resource push as first-release acceptance. A successful preview never marks it hardware-applied.

### Approved (Ramiro, 2026-10-23): wallpaper schema and release phases

First release accepts local JPEG/PNG images, persists settings per serial, renders one static image with contain/cover/center, and shows a basic clock. Keep a schema capable of later playlists: isTransparent, bgFillMode, gapInterval, gapIntervalUnit, playMode, displayMediaList entries with name/type/filePath/duration/format. An empty installation uses an app-owned neutral background, not recovered proprietary files. Use an asset reference resolved by main rather than a renderer-writable arbitrary file URL. Imported file URLs normalize through that adapter with a diagnostic.

Later add transparency, image/video lists and sequential/random scheduling. Preserve source timing units and video minimum, but require actual decoder support rather than treating a .mov/.mkv extension as sufficient. Pause/dispose inactive media and timers on mode switch, profile/device change, window closure, or replacement. Random selection excludes the current item when another playable item exists; source's ten-retry algorithm can repeat, so this stricter behavior is approved. No requirement transfers MP4 bytes over A2.

### Approved (Ramiro, 2026-10-23): open question 6, resource scope and proof gate

Agree a typed request with L1: `{deviceId,profileId,pageId,revision,assetId,format:'jpeg',target}`. Target is either a verified logical key or an explicitly verified full-panel resource target. Media adapters supply encoded bytes; the coordinator owns cancellation, bounded buffers, transfer identity, and delivery state; L1 owns framing, chunk segmentation, sequence/checksum encoding, transport scheduling, and acknowledgments. Do not assign a made-up key code such as 0,0 for wallpaper.

Recovered source supports opcode 2, resource type 0 and terminal sequence 0 as a decoder hypothesis, plus keyed icon replacement. It does not establish a valid full-panel address, JPEG baseline/progressive rules, maximum dimensions/size, 33-byte chunk timing, sequence rollover, resend, or ack semantics. Keep those fields as unknown device capabilities until L1 returns fixtures and hardware evidence. Use an approved 8 MiB desktop reassembly bound, separate from unknown device limits, and reset buffers after every terminal transfer, failure, disconnect, or revision change. The recovered receiver does not visibly clear its completed cache; do not reproduce stale concatenation.

First-release hardware gate: record firmware/device identity, exact input file hash, image encoding and dimensions, target/key mapping, L1 framing fixture reference, actual chunk order/sizes, timing, response/ack observations, and visible display result. Use a nonproprietary checkerboard with labeled corners, then a second different image to detect old-buffer reuse. Verify one keyed icon and the actual wallpaper target/path separately. Validate interruption/reconnect and oversized-resource rejection without assuming an ack. If full-panel A2 wallpaper is unsupported, report the failed hypothesis to Ramiro; first-release item 3 remains blocked until its scope is explicitly revised. Do not silently replace it with panel-window success.

### Approved (Ramiro, 2026-10-23): clock and later display events

Clock reads the injected host clock, defaults to local 24h, refreshes at least once per second, and supports 12h with AM/PM. It uses a registered dkDesktopClock tile; no invented firmware clock message. Overlay events carry device ID, profile/page revision, and keyCode, and only affect their matching visible tile. The shared renderer handles countdown, alert, and progress; meeting/audio/AI state events are handed to their runtime owners and remain unsupported when those runtimes are absent.

Preserve user-visible countdown semantics from DisplayEvent: ms formatted HH:MM:SS, natural completion retains zero, alarm type 2 does not add an alarm icon, the first user click clears zero and the next starts again. Replace the source's 120-ms positive-event suppression heuristic with an explicit activation identity agreed with the timer domain. Approved progress policy clamps 0..100, negative hides, changed intermediate value expires in 5s, 100 expires in 1s, repeated identical value does not extend expiry. Newer events cancel stale expiry tasks. Alerts 0 clear, 1 invalid expires in 2s, 2 alarm suppresses icon, 3 success remains until clear/replacement. Overlay hit-testing never intercepts touch input.

### Approved (Ramiro, 2026-10-23): binding and remote socket scope

First release reuses existing single-panel placement. Later binding selects a detected display for a device serial and persists only a confirmed association. A missing display leaves an unbound state; it cannot take over an unrelated monitor silently. Arbitrary app capture and LAN remote access remain out of scope until behavior is recovered. If a compatibility socket is later needed, verify its server before defining a handshake; this design documents the recovered localhost URL only.

## Risks / Trade-offs

- Renderer video can look like hardware streaming. Separate the statuses and hardware evidence in acceptance.
- File paths can disappear or decode fail. Retain settings, use a neutral fallback, and report the affected item without a retry loop.
- Old overlay timers or image chunks can overwrite new profile content. Key all work by session/revision and cancel before publishing a newer snapshot.
- Full-panel A2 may be a false hypothesis. Keep the release gate explicit and let Ramiro decide the cut if the hardware contradicts it.

## Migration plan

Import only user-selected settings, convert local references through the media adapter, retain the original export, and write into the new serial-scoped repository. Do not modify DK-Suite storage or distribute its default videos. Roll back to the prior local settings revision if validation/persistence fails. Tasks 1.1–1.5 implement the desktop static-image and clock cut. Hardware resource coordination remains a separate acceptance gate.

## Approval and remaining verification

Approved (Ramiro, 2026-10-23): all recommendations in this design, including first-release static-image/clock scope, serial scoping, empty-background policy, resource bounds, explicit hardware gate, and later event/binding behavior. Full-panel A2 targeting, actual panel output, USB timing/acks, and multi-display binding remain unverified. These cannot be closed by fake transport or renderer tests.
