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

The system SHALL provide a clock tile with exactly one hourFormat action of value 24h or 12h, default 24h. It SHALL use the host's current local time and update displayed seconds at least once per second while active. 12h SHALL display midnight/noon as 12 with AM/PM; 24h SHALL display midnight as 00. Preview and panel SHALL use the same time snapshot and saved format. The clock SHALL NOT require an account or an invented firmware clock event.

#### Scenario: Midnight and noon

- **WHEN** the injected host clock reaches midnight and then noon in 12h format
- **THEN** both renderers show 12 AM and 12 PM respectively

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

The wallpaper editor SHALL persist enableSound per serial with default false for old records, and SHALL display the saved ordered media list. Dragging a media card or using its keyboard-accessible move controls SHALL save a permutation without adding, losing or duplicating assets. Removing one card SHALL retain the others. Adding the same managed asset twice SHALL preserve its original position. Stale revisions and invalid indices SHALL retain the previous revision. Sequential playback SHALL follow the saved order and wrap; singleton videos SHALL loop. Only the active panel video SHALL be eligible for sound, never a management preview or inactive video. This covers `WIDGETS-128/130`; proprietary factory media and crossfade visual parity remain outside cluster 18.

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

The shared media controller SHALL advance videos at their metadata duration in milliseconds, independently of the one-second display clock. Each deadline SHALL build on the prior deadline so delayed work retains elapsed time and processes every overdue interval. Playlist replacement or selected-device changes SHALL reset the deadline; stopping the tick owner SHALL cancel transitions. Evidence: WIDGETS-128/130; recovered WallpaperView.vue metadata-driven video scheduling.

#### Scenario: Fractional video durations

- **WHEN** a two-item playlist contains two 2500 ms videos
- **THEN** selection changes at 2500 ms and 5000 ms and continues every 2500 ms without rounding or drift
