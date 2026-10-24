## ADDED Requirements

### Requirement: Seven-module full-screen panel

The system SHALL render the first visible systemMonitorPanel anchor as a 1920×480 design stage scaled into the existing padded 8×2 slot using the monitor theme, covering other cells. It SHALL compose CPU, GPU, Memory, Processes, Disks, Network and Power, excluding Bluetooth. Evidence: WIDGETS-064–066.

#### Scenario: Panel selected

- **WHEN** the active page contains a visible panel tile
- **THEN** it occupies all 8×2 cells and exposes all seven modules without generic key art

### Requirement: Five source-derived styles

The panel SHALL support glass, cyber, anime, tactical and wasteland in recovered order with glass as default and invalid-style fallback. Geometry and colours SHALL follow the five recovered Vue canvases and AUDIT_WIDGETS §3.2. Animations SHALL respect reduced motion; contrast/transparency preferences SHALL produce opaque readable surfaces. Evidence: WIDGETS-067, 069–074, 079.

#### Scenario: Change styles

- **WHEN** each of the five styles is selected
- **THEN** its own complete layout renders at 1920×480 with the recovered labels and seven metric modules

### Requirement: Backgrounds and draft settings

Management SHALL offer Built-in, None and Custom backgrounds with one image/video slot per style, Change background, Restore default background and panel-wide Celsius/Fahrenheit. Video SHALL be muted, looped and at least two seconds, with a bounded native probe. Invalid/missing custom media SHALL fall back to the built-in background with the recovered error text. Draft changes SHALL affect only the labelled fixture preview until Save, and Revert SHALL restore the committed record. Evidence: WIDGETS-068, 080–081 and F6.

#### Scenario: Unsaved preview

- **WHEN** a user changes style, unit or background
- **THEN** management shows the draft fixture while the live panel keeps the committed settings until Save

#### Scenario: Missing custom background

- **WHEN** a selected file disappears or cannot decode
- **THEN** the panel uses its built-in background and management reports the missing file without losing the saved slot

#### Scenario: Multiple saved style backgrounds

- **WHEN** all five styles have saved videos
- **THEN** settings reads and broadcasts include bytes only for the active custom background, not the other four; management loads a different saved style's media only when previewing it, without changing the committed panel

### Requirement: Truthful values and formatting

The panel SHALL use timestamped availability states from system-monitor-tiles and SHALL show unavailable values as `--` from startup. Confirmed no-battery SHALL show AC Power with no fabricated percentage or charging bolt. Temperatures outside (0,150] Celsius SHALL be unavailable; valid temperatures SHALL convert to Fahrenheit when selected. Disks SHALL retain all rows up to eight, otherwise show eight sorted by usage and an English overflow summary. A successful empty disk list SHALL show No disk detected. Evidence: WIDGETS-075–077, 083, 091–092; approved decision 4 overrides vendor startup zeros and fake battery.

#### Scenario: No sample or unsupported GPU

- **WHEN** collection has not returned or GPU collection is unsupported
- **THEN** the affected readouts show `--` and an explicit unavailable state while supported modules continue

#### Scenario: Missing measurement units

- **WHEN** a readout is unavailable, including a confirmed absent battery, analog temperature, ticker rate or disk usage
- **THEN** the value is `--` with no appended numeric unit; a measured zero retains its unit

#### Scenario: Laptop on AC power

- **WHEN** the platform reports AC power with an internal battery charging, charged or not charging
- **THEN** Supply Mode shows AC Power and Power State preserves the reported battery state, never inferring Discharging from battery presence

#### Scenario: Overflow disk list

- **WHEN** ten disks are returned
- **THEN** the eight most used appear and the remaining two are identified by an English overflow summary

### Requirement: Scoped configurable sampling

The system SHALL reuse system-monitor-tiles rate bounds 0.2–10 Hz with persisted default 1 Hz and master switch. It SHALL allow one in-flight request per collector, isolate failed modules, label a retained value stale after three intervals, and release collection on disable, last live-panel unmount and shutdown. Management fixture previews SHALL NOT start collectors. Node os and platform-checked execFile commands SHALL be used without adding a dependency. Evidence: WIDGETS-080, 082–083; approved decision 5 overrides DK's ten-second interval.

#### Scenario: Slow collection and disable

- **WHEN** a sample exceeds one interval and monitoring is then disabled
- **THEN** no overlapping request starts and a late response cannot restart sampling

#### Scenario: Invalid rate

- **WHEN** 0 Hz or 11 Hz is saved
- **THEN** validation rejects the change and the last committed configuration remains active

#### Scenario: Failed collection after success

- **WHEN** a valid sample is followed by errors, permission failures or unavailable attempts
- **THEN** the last successful values and timestamp remain, become stale after three intervals, and are replaced only on a successful recovery; a module that has never succeeded retains its explicit failure state

#### Scenario: IPv6-only external interface

- **WHEN** a macOS external interface has IPv6 addresses and no IPv4 address
- **THEN** its link row supplies byte counters and rates without requiring an IPv4 address

#### Scenario: Non-panel window requests metrics

- **WHEN** management, a profile thumbnail, a spoofed panel URL or a child frame requests a live subscription
- **THEN** main rejects it and starts no collectors; only the main-owned panel's top frame may subscribe, and settings broadcasts go only to the main-owned management and panel documents

### Requirement: Disk list touch scrolling

Each canvas SHALL register its disk list as smDiskList with move support through the merged strip recognizer. Vertical dragging SHALL scroll the list, release SHALL fling within bounds, and a new gesture/unmount SHALL cancel inertia. Scrollbars SHALL be hidden; reduced motion SHALL disable inertia. Evidence: WIDGETS-078 and F7.

#### Scenario: Drag and release

- **WHEN** touch moves vertically over an overflowing disk list and releases
- **THEN** scrollTop changes, remains within bounds and no key action fires
