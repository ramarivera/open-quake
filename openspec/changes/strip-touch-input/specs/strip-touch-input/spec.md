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
