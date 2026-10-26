# Spec Delta

## Purpose

Define local QUAKE wallpaper and clock rendering, display events, and separately verifiable device resource delivery without claiming desktop preview as hardware proof.

Requirements reflect the recommendations approved by Ramiro on 2026-10-23 in `design.md`; later-phase sections apply only when enabled.

## ADDED Requirements

### Requirement: Serial-scoped wallpaper settings

The system SHALL persist wallpaper settings per nonempty device serial, independent of profile display name. The settings SHALL include the following fields, validating before save and retaining the previous revision on failure.

| Field | Contract |
|---|---|
| isTransparent | Boolean, default false |
| bgFillMode | contain, cover, or center; default cover |
| gapInterval | Integer 3..86400 for unit 0 or 1..1440 for unit 1; default 5 |
| gapIntervalUnit | 0 seconds or 1 minutes, default 0 |
| playMode | sequential or random, default sequential |
| enableSound | Boolean, default false, only active panel video may sound (`WIDGETS-128/130`) |
| displayMediaList | Ordered list of media records; ordered app-managed image/video playlist; duplicate assets are omitted (`WIDGETS-128`) |
| media.name | Nonempty display filename |
| media.type | image or decoded video |
| media.filePath | Validated app-managed local asset reference; legacy file URLs require import normalization |
| media.duration | Positive finite duration in milliseconds; image interval equals gapInterval multiplied by 1000 or 60000; later video duration comes from decoded metadata |
| media.format | image/jpeg or image/png for new first-release images; a supported decoded video MIME type for later video; legacy image empty string normalizes using decoded content |

#### Scenario: Two devices

- **WHEN** device A saves an image and device B saves another
- **THEN** each device reloads its own settings and switching profile names does not exchange their wallpapers

#### Scenario: Interval unit conversion

- **WHEN** an image interval is saved as value 2 with unit 1
- **THEN** its duration is 120000 ms and neither renderer interprets it as 2 ms or 2 seconds

### Requirement: First-release static wallpaper and shared canvas

The system SHALL decode user-selected local JPEG/PNG content before accepting it, preserve its aspect ratio, and render the same saved asset and fill mode on a logical 1920x480 panel canvas and management preview. Contain SHALL show the full image with unused space, cover SHALL fill and crop, and center SHALL show native-size centered content clipped at canvas boundaries. Missing, empty, unreadable, or unsupported media SHALL show an app-owned neutral fallback with an actionable status. No proprietary wallpaper files SHALL be required.

#### Scenario: Square image fit

- **WHEN** a 480x480 image uses contain on a 1920x480 canvas
- **THEN** the image remains 480x480 centered with horizontal unused space and no stretching in either window

#### Scenario: Removed source file

- **WHEN** a saved local image cannot be read after restart
- **THEN** the system retains the selection, shows fallback and media-unreadable status, and reports no successful device delivery

### Requirement: First-release clock

Clock rendering and configuration SHALL follow `desktop-clock`, owned by each profile clock key. Default display SHALL show hours and minutes only, matching DK-Suite 0.4.95, `AUDIT_WIDGETS.md` WIDGETS-030, recovered `dkDesktopClock.vue:140-153`. The approved open-quake seconds extension SHALL be optional and off by default; when enabled it SHALL update at host second boundaries. Wallpaper SHALL neither draw a second clock nor own the active clock format. The clock SHALL use host-local time without an account or firmware clock event. Covers WIDGETS-021/022/029/030 and resolves open-quake-b1b.

#### Scenario: Default clock and optional seconds

- **WHEN** a default clock profile is selected, then seconds are enabled on that key
- **THEN** the default shows only hours and minutes, and the enabled key updates seconds without changing another profile or wallpaper

#### Scenario: Midnight and noon

- **WHEN** the host clock reaches midnight and then noon in a profile with 12h format
- **THEN** preview and panel show 12 AM and 12 PM respectively using that profile's saved format

### Requirement: Resource requests use verified targets

A resource push SHALL identify device, profile, page, revision, asset, JPEG format, and a target supported by the verified device capability. Key targets SHALL use the logical coordinate contract; full-panel targets SHALL require explicit full-panel evidence. Unknown target encodings SHALL return resource-target-unverified before sending bytes. Framing and chunking SHALL come from the L1 SDK. Saving wallpaper, displaying a preview, and sending a transfer SHALL expose distinct statuses.

#### Scenario: Full-panel address unknown

- **WHEN** a wallpaper push has no verified full-panel resource target
- **THEN** the system can show the desktop image but reports device delivery unavailable and sends no guessed target bytes

### Requirement: Resource assembly and lifecycle isolation

Resource delivery SHALL associate chunks with a device session, transfer, target, and revision, accept only supported JPEG content, and expose the complete new image only after a valid terminal transfer. The approved desktop reassembly limit SHALL be 8 MiB; device limits SHALL come from verified capabilities and SHALL take precedence if smaller. Disconnect, failure, cancellation, revision change, and completion SHALL release buffers. Old or corrupt chunks SHALL NOT alter a new profile's image. Progress SHALL NOT be called hardware-applied without the verified completion evidence for that firmware.

#### Scenario: Two successive images

- **WHEN** image A completes and image B transfers to the same key
- **THEN** B contains only its own bytes, replaces A after completion, and cannot append A's cached bytes

#### Scenario: Interrupted transfer

- **WHEN** a device disconnects midway through an image and reconnects with a new session
- **THEN** the incomplete transfer is discarded and late chunks from the old session change no visible content

### Requirement: Hardware acceptance remains explicit

First-release resource-push acceptance SHALL require a real QUAKE test recording firmware/device identity, input asset hash and encoding/dimensions, verified target, L1 fixture reference, chunk order and limits, timing, observed responses, and visible results for two different images. Keyed icon delivery and full-panel wallpaper delivery SHALL be qualified separately. Desktop rendering or a fake transport SHALL NOT satisfy hardware acceptance. A failed full-panel hypothesis SHALL keep the inventory's first-release A2 wallpaper item unresolved until its scope is explicitly revised.

#### Scenario: Renderer-only success

- **WHEN** a checkerboard displays in the panel renderer but no hardware transfer has been tested
- **THEN** desktop rendering can be accepted while hardware resource parity remains unverified

### Requirement: Later playlist and mode behavior

When enabled, wallpapers SHALL render only in color-screen mode with isTransparent false and at least one playable media item. Sequential playback SHALL preserve list order and wrap. Random playback SHALL avoid the current item when another playable item exists. A single image SHALL stay visible and a single video SHALL loop. Wallpaper sound SHALL default off and only the active panel video may unmute when enabled; management previews SHALL remain muted (`WIDGETS-128/130`). Videos SHALL have decodable metadata and duration at least 2000 ms. Timers, decoders, and event listeners SHALL stop on replacement, mode/device switch, or destruction. Reduced-motion settings SHALL suppress decorative fades.

#### Scenario: Transparent mode

- **WHEN** isTransparent becomes true during video playback
- **THEN** wallpaper rendering and playback stop while the stored playlist remains intact

#### Scenario: Singleton video

- **WHEN** a valid single video playlist is active
- **THEN** the video loops without recurring playlist-switch timers, muted unless wallpaper sound is enabled

### Requirement: Later targeted display events

Display events SHALL include device/session identity, active profile/page revision, target keyCode, and a known type. Only matching active visible targets SHALL receive events. Unknown types and stale revisions SHALL leave visible state unchanged and produce a bounded diagnostic. Overlays SHALL NOT consume pointer input. Meeting/audio/AI events SHALL require their owning runtime rather than a fabricated generic notification implementation.

#### Scenario: Stale progress event

- **WHEN** a progress event for revision 3 arrives after revision 4 is active
- **THEN** revision 4's tile and overlays remain unchanged

### Requirement: Later countdown and alert behavior

Countdown events SHALL use integer milliseconds and display nonnegative remaining time as HH:MM:SS. Natural completion SHALL retain 00:00:00, and alarm alertType 2 SHALL NOT show an alarm icon. The first explicit activation after completion SHALL clear zero without restarting; the next SHALL start the configured countdown. A manual stop SHALL clear a running countdown. Duplicate events for one activation SHALL NOT restart it. showAlert types SHALL mean 0 clear, 1 invalid with 2000-ms expiry, 2 alarm without icon, and 3 success until clear or replacement.

#### Scenario: Completion then two activations

- **WHEN** a countdown completes naturally and the user activates the tile twice
- **THEN** the first activation hides zero and the second starts a new countdown, with no alarm icon

### Requirement: Later progress expiry

A progress event SHALL hide the progress overlay when percent is negative, otherwise clamp percent to 0..100. A changed intermediate value SHALL expire after 5000 ms without another change; 100 SHALL expire after 1000 ms. Repeated identical values SHALL NOT extend expiry. A newer event SHALL cancel earlier expiry work.

#### Scenario: New work after completion

- **WHEN** progress reaches 100 and a new value 20 arrives before its 1000-ms expiry
- **THEN** the old expiry cannot hide the new progress, which uses its own 5000-ms timeout

### Requirement: Later explicit display binding

When multi-display binding is enabled, a confirmed association SHALL bind a device serial to a detected display and persist it. Removing that display SHALL report unbound status without silently capturing an unrelated monitor. An IPC name or local socket SHALL NOT by itself enable arbitrary application mirroring or LAN remote control.

#### Scenario: Bound panel unplugged

- **WHEN** the confirmed target display disappears
- **THEN** its device becomes unbound and the management window explains the missing display without moving content onto another monitor automatically

### Requirement: Wallpaper playlist editing and sound

The wallpaper editor SHALL persist enableSound per serial with default false for old records, and SHALL display the saved ordered media list. Dragging a media card or using its keyboard-accessible move controls SHALL save a permutation without adding, losing or duplicating assets. Removing one card SHALL retain the others. Adding the same managed asset twice SHALL preserve its original position. Stale revisions and invalid indices SHALL retain the previous revision. Sequential playback SHALL follow the saved order and wrap; singleton videos SHALL loop. Only the active panel video SHALL be eligible for sound, never a management preview or inactive video. This covers `WIDGETS-128/130`; factory media SHALL use app-owned replacements rather than proprietary artwork.

#### Scenario: Reorder survives reload

- **WHEN** a user moves the third playlist item before the first and reloads that serial
- **THEN** both the editor and panel use the new order with each asset exactly once

#### Scenario: Sound setting migration

- **WHEN** an old serial record without enableSound loads
- **THEN** sound is off, and an explicit sound change persists independently from other serials

#### Scenario: Silent preview

- **WHEN** wallpaper sound is enabled and a management preview shows the active video
- **THEN** the preview stays muted and only the panel may produce sound

### Requirement: Exact playlist transition deadlines

The shared media controller SHALL preload videos 1000 ms before their metadata duration and begin the 800 ms fade 200 ms after preload, independently of the one-second display clock. Each deadline SHALL build on the prior deadline so delayed work retains elapsed time and processes every overdue interval. Playlist replacement or selected-device changes SHALL reset the deadline; stopping the tick owner SHALL cancel transitions. Evidence: WIDGETS-128/130; recovered WallpaperView.vue metadata-driven video scheduling.

#### Scenario: Fractional video durations

- **WHEN** a two-item playlist contains two 2500 ms videos
- **THEN** preload occurs at 1500 ms and selection changes at 1700 ms and 3400 ms, preserving each fade deadline without rounding or drift

#### Scenario: Late video mount

- **WHEN** the panel enters vivid mode or a management preview mounts 50 seconds into a running 60-second video interval
- **THEN** its video seeks to the controller's elapsed position after metadata loads and the existing playlist deadline stays unchanged

### Requirement: Complete serial wallpaper configuration

For MAIN-150, SCREEN-104 and WIDGETS-128, the owner SHALL accept one atomic settings Save, validate interval bounds and synchronize every media placeholder duration to the selected seconds or minutes. Video playback SHALL prefer decoded metadata duration. A typed local insertion SHALL prepend a decoded, deduplicated asset, retain other settings and publish the selected serial once. Unchanged lists SHALL retain playback. Legacy ws_ identity SHALL normalize once at the migration boundary, with canonical serial storage as the only writer.

#### Scenario: Two serials and insertion

- **WHEN** A saves random playback with a two-minute interval and B saves sequential playback with five seconds, then a valid video is inserted for A
- **THEN** the video is first in A's list, A retains its settings, B is unchanged, and A receives one committed publication

### Requirement: Factory media and confirmed reset

For WIDGETS-129 and MGMT-250, new serials and Restore factory SHALL use five app-owned muted video wallpapers, cover, five seconds, sequential and nontransparent. Restore factory SHALL require confirmation, commit one revision and publish once; cancellation or a failed write SHALL preserve the prior settings. Backup restore SHALL remain a separate operation.

#### Scenario: Selected-serial factory reset

- **WHEN** A confirms Restore factory while B has custom settings
- **THEN** A gets the five factory videos and default fields in one revision, B stays unchanged, and canceling the same action writes nothing

### Requirement: Native and renderer transparency

For MAIN-051, SCREEN-007 and WIDGETS-131, per-serial transparency SHALL suppress every wallpaper layer, neutral fill and playback timer while retaining the playlist. A transparent-capable panel SHALL apply transparent or black native backgrounds on updates, reconnect and rebind, preserving its bounds and stacking policy. Management previews SHALL show the same empty wallpaper state.

#### Scenario: Transparent then opaque

- **WHEN** A switches from playing media to transparent and back to opaque, including after rebind
- **THEN** native background and renderer agree, no hidden media keeps playing, A's stored list survives and panel bounds remain unchanged

### Requirement: Two-layer wallpaper playback

For SCREEN-105 and WIDGETS-130, the controller and shared canvas SHALL preload the next media at duration minus 1000 ms, begin an 800 ms ease-in-out crossfade 200 ms later, and retain at most two layers. Videos SHALL wait for canplaythrough before activation; failed items SHALL skip with bounded retries and fall back when no playable item remains. Only the active panel layer may sound. Random starts SHALL choose a random index and subsequent choices SHALL avoid immediate repeats. Single images stay and single videos loop. Hidden windows SHALL pause both layers, resume at the current timeline and release timers, listeners and media on teardown. Display-size changes SHALL remount the active media without changing saved settings.

#### Scenario: Preload and fade

- **WHEN** two five-second items play
- **THEN** B preloads at 4000 ms, becomes active at 4200 ms when ready, A releases at 5000 ms, and only B may sound during the fade

### Requirement: Vivid editor delegation

For MGMT-098 and MGMT-286, vivid profiles SHALL hide the key grid, expose the localized configure-vivid affordance, reject replacement of the colorfulScreen tile and host the selected serial's wallpaper editor. Wallpaper edits SHALL have their own explicit Save and Cancel, independent of key Save. Reset SHALL use the same confirmed factory command.

#### Scenario: Leave unsaved wallpaper settings

- **WHEN** an editor opens for A, changes transparency and cancels or changes device before Save
- **THEN** neither A nor the newly selected device changes, and key Save cannot commit the abandoned wallpaper draft

### Requirement: Explicit focus and serial rebind

For MAIN-148 and MAIN-149, explicit user commands SHALL focus management before the panel, return canceled file picking without paths, and queue bind requests for all connected serials or restart one validated connected serial. Concurrent requests SHALL coalesce under the existing lifecycle queue and SHALL reuse the HID owner.

#### Scenario: Restart one connected serial

- **WHEN** A and B are connected and concurrent restart commands target A
- **THEN** one queued restart recreates A's panel through the existing lifecycle owner, B's panel remains and no additional HID handle opens

### Requirement: Independent clock theme media

For SCREEN-123, the desktop-clock contract SHALL retain five independent app-owned theme scenes instead of vendor JPGs, migrate legacy per-theme image/video slots and music, and apply strip cycling as a theme-only write. Unsupported or unavailable custom media SHALL fall back to that theme's owned art without deleting the saved slot.

#### Scenario: Migrate and cycle all themes

- **WHEN** legacy background slots and music migrate, then season, cyber, anime, tactical and aurora are selected in turn
- **THEN** the renderer uses each retained custom slot or its theme fallback, music remains saved and cycling changes only theme identity and mode

#### Scenario: Failures leave one playable video

- **WHEN** SCREEN-105 and WIDGETS-130 media errors leave one playable video in a multi-item saved playlist
- **THEN** its retained element loops at native duration and the controller stops redundant preload and transition work until the playlist changes

#### Scenario: Discard staged local picks

- **WHEN** a WIDGETS-128 or MGMT-286 editor picks local media and then cancels, unmounts or changes serial before Save
- **THEN** its draft identity releases unreferenced files under the repository lock, including late picker responses, while current and backup revisions and other active drafts keep their assets

#### Scenario: User starts multi-screen binding

- **WHEN** MAIN-149 reports a multi-screen alert on the connection page
- **THEN** a visible Bind Quake screens action submits bind-all to the existing lifecycle queue, without opening another HID owner

#### Scenario: Preload promotion avoids repeated media bytes

- **WHEN** SCREEN-105 and WIDGETS-130 preload the next item and then promote it to active in an already subscribed window
- **THEN** each asset transfers as full bytes once and later snapshots use content references; a new or reloaded window receives complete media, with only the current and next asset retained per window
