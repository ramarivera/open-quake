# Knob model

## Purpose

Make physical knob gestures select profiles and control the focused tile or player consistently across strip renderers and profile changes.

> **Visuals superseded (2026-10-25).** Ramiro rejected the DK-Suite imitation on the strip. Visual clauses in this delta (selector arc/vignette/label drawing, focus dial drawing, cyan volume fill) are superseded by `independent-device-design` (`device-visual-design`). Behavior clauses here remain authoritative.

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

Each detent SHALL route once, in order: visible knob-capable tile, available armed player volume, thumbnail picker, FunctionWheel. Stored center/left/right slots SHALL NOT run on idle rotation. Profiles SHALL wrap in menu order. Selection SHALL serialize with profile edits, publish only after persistence, and reach the strip and management preview through the same committed snapshot. Failed writes SHALL retain the prior selection. The picker SHALL use only ready thumbnails in menu order, 15 per page, open one detent from the active profile, follow focus across pages, and auto-commit 5000 ms after the last detent or page arrow. Focus equal to current SHALL close without a write. Cold or empty thumbnail caches SHALL fall through to the ring and warm asynchronously without consuming or replaying that detent. The ring SHALL commit 200 ms after the last detent; unchanged selection SHALL hide after 3000 ms from input, and successful commits SHALL keep feedback for 1200 ms after commit; the ring SHALL NOT render while the picker is open. Logical deltas SHALL be retained when visual updates coalesce at 16 ms. Audit KNOB-010..012/024, SCREEN-072/074/078/079/085/086/090/091.

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
- **THEN** page 2 appears, its first card is focused, and the deadline matches that focus

#### Scenario: Portrait picker input

- **WHEN** the panel uses rotation 90 and the user taps a card or page arrow
- **THEN** pointer coordinates are transformed into the logical canvas and normalized physical touch uses the shared strip overlay route; both select the same target without activating a grid tile

#### Scenario: One selector at a time

- **WHEN** ready thumbnails open the picker
- **THEN** no FunctionWheel arc or label renders over it; a cold cache still renders the FunctionWheel alone

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

### Requirement: Action failure feedback and available adapters

Focused screen luminance SHALL use the hardware session's typed Luminance command, and focused volume and armed volume SHALL use the native volume adapter. Unsupported monitor-brightness, hotkey or voice actions and native failures SHALL publish only the catalog code in the authoritative notice channel, render a warning toast, and request the hardware error tone AI_ERROR [[90,200]] using Device Alert Volume. Disabled or zero alert volume SHALL remain silent. Buzzer failure SHALL preserve the original notice and SHALL NOT recursively alert. Audit KNOB-018..021/066, MAIN-022.

#### Scenario: Failed physical action

- **WHEN** a physical detent targets an unavailable focused control or a hold cannot start voice
- **THEN** the panel receives the sanitized failure code and displays the warning, and an available hardware session plays the error tone without changing the selected profile


### Requirement: Source-aware wheel visibility and menu reconciliation

SCREEN-078, SCREEN-090, SCREEN-100 and SCREEN-106 SHALL use one authoritative committed context containing the ordered menu and active profile. Boot synchronization SHALL remain closed. A real external profile ID change SHALL show ring feedback at its new index for 1200 ms without selecting again. An own-commit publication SHALL NOT reopen or extend feedback. Added, edited or deleted entries SHALL retain the active ID when present; deletion of the active ID SHALL use the repository's first visible profile. An open selector SHALL rescan to the committed active ID and restart its settle deadline on a catalog edit, without opening a closed selector. The committed active profile SHALL remain a picker entry with a placeholder when its thumbnail is missing. Catalog edits SHALL NOT invoke persistence for a different profile. Ready thumbnails with matching content keys SHALL survive unrelated edits. Active page/content changes SHALL clear focus and disarm volume; inactive-only edits SHALL preserve them. A committed snapshot received before the initial read SHALL take precedence over that late read. Canonical model revisions and 16 ms renderer coalescing SHALL replace repeated nextTick/150 ms index resynchronization.

#### Scenario: External change versus boot and own commit

- **WHEN** the model first synchronizes, then receives a different committed profile, then its unchanged publication
- **THEN** boot remains closed, the real change shows feedback for exactly 1200 ms, no selection port runs, and the unchanged publication does not extend the deadline

#### Scenario: Menu mutation during selection

- **WHEN** a profile is added, renamed, reordered or deleted while the picker or ring is open
- **THEN** the menu order and active ID come from the same context, focus rescans to that ID and page, the new settle deadline selects no stale entry, and a closed selector remains closed

#### Scenario: Missing active thumbnail during a catalog edit

- **WHEN** the active thumbnail is missing or invalidated while another ready profile is highlighted, then a catalog edit publishes
- **THEN** the picker rescans to the active profile's placeholder, expiry retains the committed profile without persistence, and a subsequent deliberate detent can select another ready profile

#### Scenario: Coalesced multi-page movement

- **WHEN** rapid detents cross multiple 15-entry page boundaries before a render
- **THEN** every delta contributes to the canonical index and the rendered card, page and single focus rectangle agree with the latest model revision

### Requirement: Committed profile frame transition

SCREEN-079 SHALL reveal a committed colorful profile immediately. When committed knob truth switches from colorful to a grid profile before its profile snapshot arrives, the panel SHALL retain the colorful frame, disable stale grid input, then reveal only the matching committed grid. After 2000 ms without matching configuration, it SHALL show a bounded unavailable frame rather than expose the previous profile's controls. The transition SHALL be canceled by a newer switch or unmount. Same-profile confirmation SHALL not write or reset voice. Failed persistence SHALL retain committed profile truth. A successful profile switch SHALL cancel owned voice and disarm volume once; publication of its committed snapshot SHALL NOT repeat those effects.

#### Scenario: Delayed and missing grid snapshot

- **WHEN** colorful switches to a committed grid profile whose snapshot is delayed
- **THEN** colorful remains until the matching snapshot arrives, or for at most 2000 ms before an unavailable frame, and no old-profile grid action is enabled

#### Scenario: Failed persistence

- **WHEN** selecting a different profile fails storage
- **THEN** the old committed profile remains visible and the failure code remains sanitized

### Requirement: Independent wheel presentation with recovered dimensions

SCREEN-075, SCREEN-076, SCREEN-077 and SCREEN-080 SHALL use the independent-device-design flat list and palette, with the recovered 423 by 470 right-edge footprint centered within 1920 by 480. Five wrapped labels SHALL use vertical offsets -166.81, -88.37, 0, 88.37, 166.81; 40 px type with 48 px line height and center scale 1.404. All labels SHALL truncate within the canvas, including the center, with a 600 px maximum measured label width. The opaque legibility sheet SHALL expand to max(480, widest center/adjacent label plus 400) when that measured label exceeds 240 px, bounded to 1920. It SHALL not capture input. The flat direction indicator SHALL expire after 300 ms and the interrupted direction nudge SHALL reset after 200 ms easeInOutQuad. OS or app reduced motion SHALL remove motion without changing selection deadlines. The dormant cyan arc, radial vignette, halo/glow and glass blur SHALL remain replaced by flat surfaces as required by independent-device-design; their compositor internals SHALL NOT return.

#### Scenario: Long names and small menus

- **WHEN** one, two or many profiles include a title wider than 600 px and the active index wraps
- **THEN** exactly five names render, the center and neighbours stay clipped to the canvas and their legibility sheet, and the sheet leaves underlying grid input available

#### Scenario: Interrupted nudge and reduced motion

- **WHEN** consecutive detents arrive within 200 ms, or reduced motion is enabled
- **THEN** direction and names update immediately, prior animation is canceled, the final nudge resets by 200 ms, and reduced motion renders a stable final frame

### Requirement: Picker presentation and shared input geometry

SCREEN-087, SCREEN-088, SCREEN-089 and SCREEN-094 SHALL retain the recovered 58 px header inset 20, 38 px footer, 370 px card band, 16 px gaps, strict 4:1 count-based cards, 40 px radii and fixed 300 by 75 cards above 15 entries. Incomplete pages SHALL center their actual row count within the band. A single 3 px accent focus rectangle SHALL move in 140 ms; cards SHALL transition in 120 ms, show thumbnail or neutral 8 by 2 placeholder, distinguish current/focus/pressed with a word or outline, hide the current badge when paged, and shrink to .97 when pressed. The backdrop and name legibility band SHALL be opaque flat surfaces under independent-device-design. Header title/current/hint and footer page hint/current badge SHALL use shared source strings in en, de, es, fr, it, ja, ko and zh, with English fallback. Long current names SHALL ellipsize without hiding hints. Paged arrows SHALL derive both rendered bounds and hit rectangles from one source: 160 by 220 at x=0 or 1760, y=130. First/last unavailable arrows SHALL retain bounds with visibility hidden and no input. The settle bar SHALL be 3 px and reflect canonical progress; page indicator/hint SHALL appear only for paged lists.

#### Scenario: Paging boundary and incomplete last page

- **WHEN** a 16-entry picker advances to its last page
- **THEN** its one card and focus ring center in the 370 px band, previous arrow accepts input only inside its rendered rectangle, and the hidden next arrow cannot select a page

#### Scenario: Localized header and current states

- **WHEN** any of the eight source locales renders one or several pages
- **THEN** source title, current prefix/badge and hints render with the correct current name, page fraction and settle progress without overlapping the card band

### Requirement: Complete painting and deliberate management entry omission

SCREEN-081 SHALL keep tile painting complete before, during and after selector visibility. Clock and chat SHALL retain their existing flat surfaces. Monitor cards SHALL use opaque, blur-free fallbacks while a selector is visible, restoring their selected theme on exit. The shared selector visibility state SHALL replace private compositor events and repaint nudges. SCREEN-084 SHALL deliberately omit the source's dormant management button from both strip selector and management preview; existing management navigation remains the accessible route and selector rendering SHALL NOT invoke management opening.

#### Scenario: Selector compositor and management preview

- **WHEN** clock, monitor and chat tiles render before, during and after a wheel session in the strip and in management preview
- **THEN** all tile content paints completely, no glass blur is introduced by the selector, and neither selector offers or calls a management-opening button
### Requirement: Saved host volume, mute and brightness

The action catalog SHALL register legacy vol with audio_vol_down/up and supportKnob, mute with two audio_mute actions and actual-state alternate artwork, and host brightness with directional level values 1/0 and supportKnob. Quick 2,1/2,2/2,3 SHALL activate these same owners. Volume SHALL clamp at 0/100 and skip redundant native writes. A single shared native volume/mute observation SHALL feed matching active key states every 2000 ms even when player volume is unarmed; reads SHALL serialize with writes and teardown with the owner. Armed knob observation SHALL consume that shared reading. Covers MAIN-073, MAIN-089, MGMT-167, MGMT-168, MGMT-169, MGMT-375, MGMT-376, MGMT-377.

#### Scenario: Save and activate Quick controls

- **WHEN** saved Quick volume/brightness keys receive directional input and mute is activated
- **THEN** the shared host owner changes only the intended control, respects bounds and publishes the actual mute alternate state to every matching active tile

#### Scenario: External mute and shutdown

- **WHEN** the OS changes mute while the player is unarmed and two consumers subscribe
- **THEN** one native sample updates both consumers and disposal stops further native reads

### Requirement: Bounded host brightness transitions

Host brightness SHALL retain every logical 5 percent detent while coalescing concurrent bursts. The first write SHALL begin after 1 ms; later write batches SHALL start no more often than 500 ms. Smooth native targets SHALL ease by 20 percent of the remaining distance every 16 ms until within 0.5 percent, then write the exact target. Discrete native targets SHALL use their reported quantum. Every write SHALL recheck the target and validate readback; unavailable or failed native reads SHALL remain unavailable rather than invent 100 percent. Covers MAIN-074.

#### Scenario: Burst and unsupported adapter

- **WHEN** multiple detents arrive in a burst or the native adapter is unavailable
- **THEN** bounded writes reach the retained target with the specified fake-clock timing, or return the catalog failure without a fabricated reading

#### Scenario: Physical brightness leaves device input responsive

- **WHEN** a physical burst rotates a focused brightness key while native transitions are pending
- **THEN** every detent contributes five percent, subsequent presses and disconnects dispatch before the native timer elapses, and focus/context replacement or disposal cancels pending native writes

### Requirement: Twelve audio operations and composite media leaves

The hotkey Audio group and Media selector SHALL retain exactly mute, volume down/up, play, pause, stop, previous, next, rewind, forward, repeat and random. Pause SHALL be explicit and playPause SHALL retain fresh toggle semantics. Media tokens SHALL route to the same native media/host-volume owners and reject unsupported commands. Composite actions SHALL validate and execute mute and all eight media leaves in order, preserve corrected next-track identity and stop at the first native failure. Covers MGMT-208, MGMT-209, MGMT-226, MGMT-290.

#### Scenario: Sequence stops on failure

- **WHEN** a saved sequence contains mute and transport steps and one native command rejects
- **THEN** prior steps run once in order and subsequent steps never run
