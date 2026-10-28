# Spec Delta

## Purpose

Translate the QUAKE touch controller's vendor reports into bounded contact lifetimes, strip key presses and reusable in-tile gestures without requiring hardware for development.

## ADDED Requirements

### Requirement: Vendor collection and bounded raw frames
The device abstraction SHALL select VID 0x0712 PID 0x0010 usagePage 0xFF73 usage 0x71, rejecting the digitizer and all other collections. It SHALL decode reports with byte 0 A3, byte 3 1A, byte 4 count 0–5 and count five-byte records from offset 5 containing action, yLo, yHi, xLo, xHi. Bytes 1/2 and trailing bytes SHALL remain opaque and no checksum SHALL be inferred. Truncated or unrelated frames SHALL produce no contacts. Sources: MAIN-002, MAIN-035, MAIN-038, SCREEN-053.

#### Scenario: Vendor frame differs from control framing
- **WHEN** a complete vendor frame contains arbitrary bytes 1/2 and LE coordinates
- **THEN** coordinates decode without a control-channel checksum and no control command is written

#### Scenario: Malformed count or wrong collection
- **WHEN** a report is truncated or exceeds five contacts, or enumeration contains only digitizer collections
- **THEN** no malformed contacts or digitizer handle are created

### Requirement: Contact tracking and idle lift
The system SHALL preserve IDs by one-to-one nearest-neighbour matching within 99 px, mark reported contacts active and emit releases for missing contacts. After 100 ms without a valid frame it SHALL release remaining contacts exactly once. Capture-active SHALL suppress idle lift; disabling capture SHALL rearm a 100 ms deadline. Sources: MAIN-039, MAIN-040.

#### Scenario: Move and silent release
- **WHEN** a contact moves 99 px, then frames stop
- **THEN** its ID persists and an up occurs at 100 ms, with no repeated up

#### Scenario: Replacement and capture
- **WHEN** a contact moves beyond 99 px or disappears
- **THEN** the old contact releases and a replacement gets a new ID
- **AND** capture suppresses only inactivity releases, preserving explicit missing-contact releases

### Requirement: Scoped binding and recovery
The system SHALL deduplicate descriptors, retry binds every 2000 ms up to five attempts, then recover after min(10000 + 5000·cycle, 30000) ms, with at least 60000 ms for empty enumeration. Read failure SHALL close the touch handle, release contacts and rebind after 2000 ms. States SHALL distinguish UNKNOWN, TOUCH_OK, HID_ENUM_EMPTY, DK_TARGET_NOT_FOUND, DK_TARGET_OPEN_FAILED, HID_READ_FAILED and RECOVERING. Health SHALL expose counters with scrubbed catalog error identities, never paths or native messages. Lock SHALL defer binding. Wake recovery SHALL reset backoff and try after 1500 ms then 4500 ms after failure, cancelling older wake generations. Scope exit SHALL cancel pending work and close each handle once. Sources: MAIN-035–037, MAIN-041.

#### Scenario: Read failure and replacement
- **WHEN** the touch read stream fails while control remains connected
- **THEN** held contacts release, the old handle closes, and touch binds again after 2000 ms without duplicate delivery

#### Scenario: Empty enumeration and teardown
- **WHEN** five attempts find no controller and the scope closes during recovery
- **THEN** the 60000 ms recovery is cancelled and no later open occurs

#### Scenario: Interruption during native open
- **WHEN** teardown, lock or wake interrupts a worker while a non-cancellable native open is pending
- **THEN** a handle returned by that open closes exactly once before cancellation finishes, without reading reports or starting a replacement early

### Requirement: Strip normalization and key arbitration
The strip SHALL convert y to H−y and keep x, then flip both axes for normalized rotations 90 or 180. It SHALL use only the first contact for every phase, route overlay-owned gestures exclusively to the overlay, and use strip-grid's pure `tileAt(point, layout)` resolver against the current rendered layout. Ordinary tiles SHALL emit down once at touch and up 10 ms after release anywhere, preserving the initial key across movement and allowing only one held ordinary key. A first-contact up at any coordinate SHALL release the held key; secondary contacts SHALL be ignored. Sources: SCREEN-005, SCREEN-053–058.

#### Scenario: Drag across tiles and lift outside
- **WHEN** touch begins on key A, moves to B, then releases outside the grid
- **THEN** only A receives down and up, with no slide-off cancellation

#### Scenario: Overlay gesture and rotation
- **WHEN** an overlay captures touch, or a portrait-native display uses rotation 90
- **THEN** the overlay gesture does not reach tiles and normalized coordinates follow the recovered flip rule

### Requirement: Reusable in-tile gestures
Sub-target routing SHALL prefer clickables over overlapping scrollers, defer taps until release within 16 px Euclidean slop and 500 ms, permanently cancel a tap after crossing slop, and hand movement to a scrollable sibling. Repeated identical points SHALL not produce movement. Registry bounds SHALL refresh after resize/mutation or a miss, with local rescans throttled to 500 ms, preserving old entries on an empty scan. Portrait sub-target bounds SHALL transpose x=b.y, y=H−b.width−b.x, width=b.height, height=b.width. Sources: SCREEN-061–065, AI-206.

#### Scenario: Child tap turns into scroll
- **WHEN** a finger begins on a clickable child and crosses 16 px then returns
- **THEN** the child does not tap and the scroller receives the gesture

#### Scenario: Clickable added inside a registered scroller
- **WHEN** a child mutation adds a clickable over an existing scroller
- **THEN** the next eligible local rescan discovers the clickable even when the scroller already hits, and clickables retain overlap priority

### Requirement: Scroll physics policies
Reusable monitor gestures SHALL use 6 px axis-lock slop, 44 px minimum area, 24 px valid span, 120 ms velocity window, stale release over 80 ms yielding zero velocity and a 5 px/ms cap. Monitor scroll SHALL expose the 8 px/1.2 vertical axis rule and 100 ms samples, 0.15 px/ms minimum fling, exponential decay to 0.05 per second, 0.02 px/ms rest, 64 ms step clamp, 600 ms hard stop, 0.5 rubber damping capped at 32 px and a 200 ms cubic return. Fling SHALL stop at bounds and respect reduced motion. Chat SHALL use 1:1 drag capped at 96 px/event within 20 ms, a last-segment velocity with at least 20 ms separation, 3.5 minimum and 90 maximum px/frame, friction 0.95/frame and stop below 1.75. At duration ≥320 ms, average below 2.8 px/frame or release below 7.7 SHALL suppress chat fling. Sources: SCREEN-066–068, AI-163.

#### Scenario: Bounded motion properties
- **WHEN** arbitrary finite drags, velocities and frame times drive scrolling
- **THEN** rubber displacement stays within 32 px, fling velocity decays, monitor fling stops by 600 ms, and reduced motion starts no fling

#### Scenario: First movement retains elapsed time
- **WHEN** a gesture starts at (0,0) at 0 ms, moves to (30,0) at 100 ms and releases at 101 ms
- **THEN** horizontal velocity is 30/101 px/ms, and release at 100 ms yields 0.3 px/ms

### Requirement: Hardware-free development and opt-in capture
OPEN_QUAKE_MOCK_DEVICE=1 SHALL supply synthetic vendor frames through the parser/tracker in development and built apps. Tests SHALL use synthetic or recorded frames without opening hardware. An opt-in capture script SHALL refuse competing open-quake or DK-Suite processes, restrict output to scratch, open only the exact vendor collection, never write HID commands, and close on timeout or signal. Sources: MAIN-002, MAIN-038; lane safety brief.

#### Scenario: Built mock run
- **WHEN** a built app starts with mock mode
- **THEN** synthetic touch events reach subscribers without loading native HID


### Requirement: DOM sub-target observation lifetime

The DOM registry SHALL observe each sub-target, its parent and its gadget for size and attribute changes, discover new children through subtree mutation, refresh bounds before routing, and dispatch non-bubbling events directly to the target. The event detail SHALL retain logical coordinates, phase, identity and effective-release status. Disposal SHALL remove observers and the native subscription and stop dispatching to detached elements. Evidence: SCREEN-061.

#### Scenario: Target moves without a new layout

- **WHEN** target, parent or gadget attributes or sizes change, or a child is added
- **THEN** the next eligible touch uses the new bounds and new child, without bubbling to the grid
- **AND** disposal disconnects observers and ignores subsequent native points

### Requirement: Scoped touch diagnostics
The touch source SHALL emit a structured health record every 60000 ms through the application diagnostic owner. Records SHALL contain only the enumerated state, bounded nonnegative report/frame/bind/recovery counters and allowlisted catalog error codes. State changes SHALL emit previous/current enum states. Native paths, serials, error messages and causes SHALL never enter these records. Scope disposal SHALL stop both diagnostics and recovery. Source: MAIN-036.

#### Scenario: Health deadline and private failure
- **WHEN** a fake source reads reports, suffers a native error containing private data, and reaches 60000 ms
- **THEN** one safe health record contains its counters and state transitions, no private data, and no records arrive after disposal

### Requirement: Held key edges and cancellation
Panel contact down SHALL immediately enter the committed key runtime. Ordinary actions SHALL execute once on successful release; cancelled contacts SHALL release held resources without executing an ordinary action. Hotkeys SHALL send a down edge at contact start and an up edge to the same keyboard owner on release, cancellation, profile replacement or disposal. Directional-only volume/luminance/brightness keys SHALL ignore ordinary press/release. Repeated moves and duplicate releases SHALL do nothing. Physical lift SHALL retain the 10 ms release delay; DOM fallback SHALL use 100 ms. Sources: MAIN-065, SCREEN-057, SCREEN-060.

#### Scenario: Lift anywhere and cancel after replacement
- **WHEN** an independently encoded vendor frame presses a hotkey, moves and lifts outside its original tile
- **THEN** host down occurs before lift and exactly one up occurs 10 ms after lift
- **AND** cancellation or a replaced profile releases the original owner without activating a different key

### Requirement: One mounted touch owner
The mounted strip SHALL route vendor pointer/touch gestures through one controller and SHALL ignore DOM pointer/touch events while the vendor device is connected. The DOM fallback SHALL be active only after vendor disconnect. This connection gate SHALL prevent a DOM pointerdown that arrives before its corresponding native touch report from triggering a tile. The strip SHALL suppress duplicate DOM input for 600 ms after physical input and suppress synthetic clicks after a handled gesture. Child controls SHALL own their gesture before the underlying key. Registration SHALL refresh moving rectangles and discover late targets. Registrations SHALL expose idle/requesting/registered/failed states, retry at most five times at intervals of at least 2000 ms, and share at most three fallback full scans separated by at least 3000 ms. Element delivery SHALL confirm registration. Configured local-player controls SHALL route committed previous/toggle/next/stop intents to the existing soundboard owner, preserving revision guards and never falling back to system media. Sources: SCREEN-060, SCREEN-066, KNOB-089.

#### Scenario: Late child and duplicate input
- **WHEN** a player child appears after mount, a physical contact taps it and a synthetic DOM click follows
- **THEN** only that child activates once and the underlying key remains idle

#### Scenario: Registration exhaustion
- **WHEN** a registration host is unavailable across five timed attempts
- **THEN** it reports failed, full scans obey the three-attempt/3000 ms gate, and disposal cancels all retries and handlers

### Scenario: Camera fallback requires its actual consumer
- **WHEN** a cameraView tile has no verified camera gateway consumer
- **THEN** shared pointer/touch routing SHALL remain cancellation safe and SHALL NOT fabricate a running stream or claim camera toggle parity
- **AND** SCREEN-060 remains partial until camera-and-printer-views supplies and tests the real toggle consumer

### Requirement: Focus and volume touch ownership
Physical and DOM taps SHALL toggle one supported knob focus, repeat taps SHALL clear it, and unsupported tile taps SHALL clear the previous focus. Dragged or cancelled focus gestures SHALL never acquire focus. Assistant completion SHALL restore focus only for the captured focus generation and session; late completion SHALL preserve a newer focus. Page/profile replacement SHALL reset focus. The volume capsule SHALL use the same child touch route, activate only on effective release, refuse unavailable/reentrant activation, suppress synthetic clicks for 600 ms, and support Enter/Space. Management previews SHALL remain read-only. Profile commit SHALL disarm volume before another detent. Sources: KNOB-014, KNOB-015, KNOB-075, KNOB-080, KNOB-089.

#### Scenario: Focus replacement and assistant completion
- **WHEN** supported, repeated and unsupported taps arrive through the mounted native path
- **THEN** focus follows the toggle rules, drag cancellation preserves focus, and an old assistant restore cannot clear a newer focus generation

#### Scenario: Volume release and preview
- **WHEN** native down/up and its synthetic click target the capsule
- **THEN** exactly one toggle occurs, cancelled presses and read-only previews make zero mutations, and unavailable drivers never arm

### Requirement: Scaled child touch feedback
Reusable chat touch targets SHALL use a minimum height of 44 times explicit scale, 16 times scale slop, a 500 ms tap cutoff, brightness 1.08 while pressed, and press-start/tap/press-end semantics. Mount/update SHALL refresh registration. Strip native events SHALL enter through the shared owner once. Sources: SCREEN-065.

#### Scenario: Scaled drag cancellation
- **WHEN** a scaled chat target is pressed, crosses its scaled slop and returns
- **THEN** pressed feedback clears and press-end reports no tap, without a duplicate strip action

### Requirement: Scroll completion and current bounds
Monitor disk lists SHALL admit vertical drag at 8 px and 1.2 axis ratio, render overscroll using translated content capped at 32 px, return over 200 ms, and stop fling by 600 ms or at bounds. Physical drag completion SHALL be distinct from tap effectiveness and cancellation. Chat SHALL resynchronize child hit rectangles after drag/fling completion, cancellation and reduced-motion completion. New contact and disposal SHALL stop old animation. Sources: AI-163, SCREEN-067, WIDGETS-078.

#### Scenario: Native scroll followed by child tap
- **WHEN** native contact drags and releases a scroll region and subsequently taps a moved child
- **THEN** inertia continues after release, the refreshed child activates once, and no underlying key activates
- **AND** reduced motion stops at release and cancellation starts no fling

### Requirement: Scoped panel teardown and inert grid gestures
Unmount, pagehide and beforeunload SHALL dispose the mounted touch owner, observers, retries, pending lifts, animations and active panel resources idempotently. Profile replacement SHALL cancel the old gesture and delayed callbacks. Strip swipes SHALL remain inert as in DK-Suite 0.4.95 and SHALL never navigate or create another key activation. Double-click SHALL be a safe no-op without extra device actions or folder navigation. Management mirror cells whose basicEditableItems.allowDrag is false SHALL suppress press/drag feedback and movement while remaining inspectable. Sources: SCREEN-010, SCREEN-069, SCREEN-070, SCREEN-141.

#### Scenario: Hide or replace during activity
- **WHEN** pagehide/unmount or profile replacement occurs with a held key, overlay and animation active
- **THEN** old resources stop once, no stale callbacks activate keys, and observers and subscriptions detach

#### Scenario: Swipe, double-click and locked mirror
- **WHEN** a directional swipe, a double-click or a drag on a locked mirror cell occurs
- **THEN** no navigation, duplicate action, locked animation or movement occurs, while inspection remains available

### Requirement: Scoped macOS touch-controller ownership
On macOS the exact vendor touch identity SHALL open exclusively so the shared controller does not also drive OS pointer input while the app owns raw touch. Control interfaces and other device identities SHALL retain non-exclusive opens, and Windows/Linux behavior SHALL remain unchanged. The existing scoped touch owner SHALL close the handle on disconnect, lock, stream failure and disposal.

#### Scenario: Shared controller collections
- **WHEN** the macOS device exposes vendor touch and digitizer/mouse usages at one native path
- **THEN** the app acquires the path once through its exact vendor-touch match in exclusive mode
- **AND** no separate mouse or digitizer handle is opened

#### Scenario: Release ownership
- **WHEN** the touch owner is disposed or locked
- **THEN** its acquired handle closes through the existing scope
- **AND** no global pointer hook or firmware setting changes
