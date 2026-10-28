# Spec Delta

## Purpose

How the device strip looks. Ramiro rejected the DK-Suite imitation on
2026-10-25. This capability replaces the recovered DK-Suite visual
constraints for the strip with an independent design. Behavior stays
governed by the owning feature deltas.

## ADDED Requirements

### Requirement: Supersession of recovered strip visuals

The visual clauses of the following in-flight requirements SHALL be superseded by this capability: strip-key-grid "Slot visuals and empty slot setting", "Generic icon-and-title tile" (glow, ring and DK title metrics) and "Strip press motion" (0.8 scale and white glow); desktop-clock "Glass flip digits", "Minute flip animation", "Stage layout and scaling" (DK pixel positions) and "Readability scrim"; weather-media "DK-Player turntable and guide" (platter, needle, metal controls and pixel geometry) and "Clock music card" visuals; strip-voice-ui "Full-screen voice overlay layout", "Mic mountain bar" (drawing only), "AI key decorations", "Strip toasts", "AI Copilot view" and "ClawBotView" colours and "Energy orb"; knob-model "Strip selector presentation and touch" (arc, vignette, label offsets and colours) and "Tile focus and dial" (disc, ticks and pointer drawing), and the cyan fill in "Player knob volume". Every behavior clause SHALL remain in force, including geometry of the logical 1920 by 480 canvas, cell and span layout, hit-testing, sub-touch targets, timing, deadlines, state machines, level computation, strings, capability and error truth, accessibility names and reduced motion. A visual requirement SHALL NOT be re-derived from DK-Suite artwork.

#### Scenario: Behavior survives a visual change

- **WHEN** a superseded visual clause is replaced by this capability
- **THEN** the touch targets, `tileAt` results, timings and dispatched requests produced by the owning requirement are unchanged

### Requirement: Device palette and type

The strip SHALL use one fixed dark palette that does not follow the app's light/dark theme: canvas `#000000`, surface `#15171a`, raised `#1e2124`, hairline `#26292d`, line `#3a3e43`, text `#f2f1ee`, muted `#a3a29d`, subtle `#74746f`, accent `#5fcab5`, success `#62c98a`, warning `#e7b153`, danger `#f08a78`. The accent SHALL mean selection, focus or an active/live state. Success, warning and danger SHALL mark state only and SHALL always appear together with a word or glyph. Text SHALL use the system UI family with tabular numerals for changing values. Primary text SHALL be at least 22 logical px and SHALL meet 4.5:1 contrast against its actual backdrop. The strip SHALL NOT draw glass blur, glow, bevel, gradient rings, noise or decorative gradients. A scrim used only to keep text legible over user imagery is allowed.

#### Scenario: App theme switch

- **WHEN** the management window switches to the light theme
- **THEN** the strip canvas stays `rgb(0, 0, 0)` and strip surfaces keep the device palette

### Requirement: Flat key tiles and state feedback

Grid tiles SHALL render as flat surface plates with one hairline border and a corner radius proportional to the cell (28 px for a 220 px cell, 0 for themes with square corners). The tile's own artwork SHALL be centred, with the label below it in the text colour at 22 px or larger. Explicit user title styling (text colour, position, bold, italic, underline, size) SHALL be honoured. A pressed tile SHALL change both fill and shape: raised fill, a 2 px accent inset ring, and a 0.96 scale when motion is allowed. Empty slots SHALL show a dashed `line` border only while the "Empty Slot Dashed Border" setting is on. Countdown, progress, alarm and invalid-operation runtime states SHALL render inside the tile as an opaque chip or a 6 px accent progress bar, never as bare coloured text over artwork. The profiles-unavailable status SHALL be an opaque sheet with a danger rule, a title and a muted code.

#### Scenario: Pressed tile in daylight

- **WHEN** the held key is a tile with press feedback
- **THEN** the tile shows the raised fill and the accent ring, and its scale shrinks unless reduced motion applies

### Requirement: Typographic clock

The desktop clock SHALL show hours and minutes as one tabular typographic readout, without glass or flip cards and without a decorative minute-flip animation. Seconds and AM/PM, when enabled, SHALL appear as a muted secondary readout. A date block SHALL show the weekday and date. The theme switcher SHALL be a labelled chip with previous/next controls, each at least 64 px, and SHALL keep the existing sub-touch identifiers. Built-in theme art and user images or video SHALL remain selectable. They SHALL sit under an even scrim that keeps every clock text at 4.5:1 or better. Theme "none" SHALL show the plain canvas. When enabled, weather and now playing SHALL share one opaque information column split by a hairline.

#### Scenario: Bright custom image

- **WHEN** a user's bright custom image is the clock background
- **THEN** the time, date and theme name remain at 4.5:1 or better and the image is still visible behind the scrim

### Requirement: Flat now-playing player

The system-media playAudio tile SHALL render a flat now-playing panel: a cover image (or a neutral note glyph), the source app or `System Media`, title, artist, a progress line with elapsed and total time when known, and previous, play/pause and next buttons. Play/pause SHALL be the single accent-filled control. Unsupported or disabled capabilities SHALL render disabled with an accessible name, and SHALL never be faked. A system error or permission hint SHALL appear as a warning status line above the source label, wrap to at most two lines, and never overlap it. The no-session guide SHALL keep its timing and texts, presented as an opaque sheet. No platter, needle, vinyl or metal controls SHALL be drawn.

#### Scenario: Media control unavailable

- **WHEN** the media snapshot reports `MEDIAREMOTE_UNAVAILABLE`
- **THEN** the hint shows in warning tone above the source label and the transport buttons are disabled

### Requirement: Voice and AI surfaces

The full-screen voice overlay SHALL be a near-opaque sheet showing a state chip (a dot and a localized stage word, with the error countdown when present) and the stage text in the text colour at 40 px or larger. It SHALL keep the existing marquee and reduced-motion truncation. The recording mic indicator SHALL be a bar meter driven by the same smoothed real level (the existing `stepBarMotion` level) and SHALL show no level when none was received. The grid-hold transcript row SHALL sit on an opaque bottom sheet, so it never prints over tile content. Strip toasts SHALL be opaque raised pills with a state glyph and text at 24 px or larger. The AI Copilot, ClawBotView and ClawBotInput tiles SHALL use flat surfaces with a status text (dot plus word) instead of the energy orb glow, and keep every existing hint, chip, tool and warning element and its sub-touch target.

#### Scenario: Grid key recording

- **WHEN** a grid AI key is recording with transcript text
- **THEN** the transcript appears on an opaque sheet at the bottom of the strip and no tile label shows through it

### Requirement: Knob overlays and panel feedback

The tile focus SHALL be a 2 px accent ring around the focused tile with a compact angle indicator that moves by the existing detent angle. No metal disc or tick crown SHALL be drawn. The function wheel SHALL present the same five neighbouring profile names on a full-height right-edge sheet whose blurred backdrop fades to transparency toward the left: the centre entry large in the text colour with an accent marker, the neighbours muted. The profile picker SHALL use flat cards with thumbnails, a single accent focus ring, a "Current" badge, page arrows and the settle bar. The volume capsule SHALL be a flat pill in its existing bounds, with its existing phases, accent fill when active and a numeric value. The panel's knob readout SHALL be a legible opaque flat dial (hairline track, accent arc, tabular value at least 28 logical px) that may briefly cover the tiles behind it while knob input is active. Touch marks SHALL be thin accent rings. The controls-offline notice SHALL be an opaque sheet with a danger rule.

#### Scenario: Knob detent feedback stays legible

- **WHEN** live knob input displays its detent count on a two-row panel
- **THEN** an opaque dial shows the value at a readable size and hides again after the input goes idle

#### Scenario: Wheel rotation

- **WHEN** the ring selector advances one entry
- **THEN** the list sheet shows the new centre entry with the accent marker and the existing direction nudge, without a cyan arc or flashing direction bar


#### Scenario: Focus gauge across tile sizes

- **WHEN** knob focus renders at 220 by 220, 460 by 220 or 1920 by 480 with zero, positive or negative detent angles
- **THEN** a two-pixel accent outline fits inside the focused tile, one compact gauge rotates its pointer around the tile centre, and no disc artwork, tick crown, filter or decorative label appears
- **AND** these rendered properties establish the independent replacement for KNOB-016

### Requirement: Burn-down strip visual reconciliation

For SCREEN-023, SCREEN-029, SCREEN-030, SCREEN-033, SCREEN-034, SCREEN-126, SCREEN-134, MGMT-055, MGMT-058, MGMT-059 and SETTINGS-013, the flat palette and code-native plate SHALL replace recovered alpha slots, extracted-icon accent fallback, glow SVG variants, scanlines, sparkles and lamp loops. Theme geometry is common 216/24/12, meeting 236/4/2, system 221/20/10 and monitor 220/20/10. Visible radii SHALL be rounded recovered radius times 7/12, so common/system 28, meeting 14 and panel 0. Default generic metrics SHALL use 9 percent inner padding, icon min(42 percent of short edge,168), font clamp(22,11 percent of short edge,34), weight 550 and bottom label. Explicit user title style SHALL override defaults. Enlarged slots SHALL retain local layer 10 and opaque surface under knob focus. Empty borders SHALL be two logical pixels at full opacity with no hover animation. Press transitions SHALL be 120 ms, panel scale 0.96 and management scale 0.98, with no scale/transition in either reduced-motion mode. Clock hover SHALL remain inert and geometrically stable.

#### Scenario: Accepted flat result across hosts

- **WHEN** the retained themes and spans render in panel and management preview with long, alternate or delayed artwork and user-styled titles
- **THEN** the recovered grid geometry stays intact while the flat plate, title/icon metrics, square panel corners and bounded feedback follow this requirement
- **AND** no superseded decorative artwork or animation is restored

#### Scenario: Profile wheel near the physical knob
- **WHEN** the owner rotates the knob to select a profile
- **THEN** the backdrop becomes progressively more diffuse and transparent toward its left edge while labels remain readable near the knob
- **AND** no transient top or bottom direction bar appears
