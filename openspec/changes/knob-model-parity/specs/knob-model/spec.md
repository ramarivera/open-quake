# Knob model

## Purpose

Make physical knob gestures select profiles and control the focused tile or player consistently across strip renderers and profile changes.

## ADDED Requirements

### Requirement: Firmware gestures and voice arbitration

The system SHALL consume source-confirmed press codes 1 short, 2 double, 5 hold start, 255 hold release, and rotation byte 1 as increase. Short SHALL interrupt the current voice turn. Double SHALL select the first Colorful Screen profile unless already there. While the thumbnail picker is open, short SHALL confirm its focused profile; double and hold SHALL dismiss without committing the focused profile. Double SHALL then jump to Colorful Screen and hold SHALL continue to the existing push-to-talk contract. Release SHALL be correlated to the matching hold generation; no host hold or double timer SHALL classify firmware events. Audit KNOB-001..007, SCREEN-071/082/083/092, MAIN-029..033.

#### Scenario: Picker owns short press

- **WHEN** the picker is open and firmware sends 1
- **THEN** the focused profile is committed once and no voice interruption or center assignment runs

#### Scenario: Dismiss before voice

- **WHEN** the picker is open and firmware sends 5 then 255
- **THEN** it closes without committing its selection and one correlated hold-start/release pair reaches push-to-talk

### Requirement: Idle profile selectors

Each detent SHALL route once, in order: visible knob-capable tile, available armed player volume, thumbnail picker, FunctionWheel. Stored center/left/right slots SHALL NOT run on idle rotation. Profiles SHALL wrap in menu order. Selection SHALL serialize with profile edits, publish only after persistence, and reach the strip and management preview through the same committed snapshot. Failed writes SHALL retain the prior selection. The picker SHALL use only ready thumbnails in menu order, 15 per page, open one detent from the active profile, follow focus across pages, and auto-commit 5000 ms after the last detent or page arrow. Focus equal to current SHALL close without a write. Cold or empty thumbnail caches SHALL fall through to the ring and warm asynchronously without consuming or replaying that detent. The ring SHALL commit 200 ms after the last detent and hide after 3000 ms; picker ring feedback SHALL hide after 1200 ms. Logical deltas SHALL be retained when visual updates coalesce at 16 ms. Audit KNOB-010..012/024, SCREEN-072/074/078/079/085/086/090/091.

#### Scenario: Deadline restarts

- **WHEN** a ready picker opens, 4999 ms elapses, then another detent arrives
- **THEN** no profile changes until 5000 ms after that last input

#### Scenario: Cold cache

- **WHEN** a detent arrives before thumbnails are ready
- **THEN** the ring moves immediately, commits after 200 ms and the late thumbnail result affects only future inputs

### Requirement: Strip selector presentation and touch

Selectors SHALL render within the strip logical 1920 by 480 canvas. The ring SHALL have height H minus 10, width 0.9 times height, five circular labels, a right arc with cyan radius 357.5 stroke 7, a 200 ms eased angular nudge, and a radial black vignette sized from the center and adjacent labels. The client template SHALL retain the cyan arc and directional glow without resurrecting its removed halo layer. Labels SHALL use 40/48 Inter with recovered offsets 166.81/88.37/0/88.37/166.81, center scale 1.404 and cyan emphasis. Picker SHALL use the recovered 4:1 cards, 16 px gaps, 40 px radius, count-based columns 2/3/3/4/3/4/5, fixed 3 by 5 pages above 15 items, 58 px header, 38 px footer, single 3 px focus ring and bottom settle bar. Strings SHALL match locale-en.json. Touch down/up on the same card SHALL commit; leaving SHALL cancel; blank tap SHALL dismiss; visible page arrows SHALL select the target page's first card and restart the deadline. Reduced motion SHALL remove motion without altering deadlines. Audit SCREEN-075..080/087..089/093, KNOB-011/012.

#### Scenario: Page arrow

- **WHEN** the next arrow is tapped with more than 15 profiles
- **THEN** page 2 appears, its first card is focused, and the ring and deadline match that focus

### Requirement: Tile focus and dial

Tapping a visible volume, screen brightness, monitor brightness or knob-supported hotkey SHALL toggle one focused tile. Tapping another or an unsupported tile SHALL clear prior focus. Page/profile replacement SHALL reset focus. Rotation SHALL dispatch decrease/increase only to that committed tile, hotkey action 0/1 respectively. The tile SHALL display a 50 percent black scrim, a disc of floor(min(width,height) times 0.65), 30 ticks at 12 degrees and a 14 by 12 pointer moving 12 degrees per detent. Audit KNOB-014..021, SCREEN-072.

#### Scenario: Focus wins over player

- **WHEN** player volume is armed and a supported hotkey is focused
- **THEN** rotation dispatches only that hotkey direction and moves only that tile pointer

### Requirement: Player knob volume

Tapping the DK-Player volume capsule SHALL toggle armed volume mode only when a driver is available. Detents SHALL change volume by exactly 1 percentage point, rounded and clamped 0..100, mute at zero and unmute above zero. Native writes SHALL coalesce to the latest desired value while retaining every logical detent. Desired volume SHALL take precedence over external observations for 500 ms after a detent; stale observations SHALL be probed after 5 s. Profile changes SHALL disarm volume. Capsule SHALL occupy 380 by 88 at 1471,355 with inactive, activating, active and unavailable states, cyan active fill and aria-pressed. Touch SHALL suppress duplicate click for 600 ms. Management previews SHALL be read-only. Audit KNOB-013/075..080, SCREEN-073.

#### Scenario: Profile switch disarms volume

- **WHEN** a profile changes while volume is armed
- **THEN** the next idle detent selects a profile and performs no volume write

#### Scenario: Shared committed profile selection

- **WHEN** the knob selects a profile through the shared profile repository
- **THEN** both the strip and management preview receive the persisted selection, and its own publication does not restart the knob session or close ring feedback
