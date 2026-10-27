# Spec Delta

## Purpose

The DK-Suite 0.4.95 desktop clock on the QUAKE strip: glass flip digits, five themes with their art and tints, optional custom media, on-device theme switching with persistence and rollback, plus the settings that drive it. Audit rows are from `dark-encyclopedia/dk-suite-introspeccion/v0.4.95/audit/AUDIT_WIDGETS.md`.

> **Visuals superseded (2026-10-25).** Ramiro rejected the DK-Suite imitation on the strip. Visual clauses in this delta (glass flip digits, minute flip animation, DK stage pixel layout, readability scrim) are superseded by `independent-device-design` (`device-visual-design`). Behavior clauses here remain authoritative.

## ADDED Requirements

### Requirement: Local time and hour format

The clock SHALL show host-local hours and minutes with the saved `hourFormat` of `24h` or `12h`, defaulting to `24h`. Hours SHALL always render as two digits. In 12h the hour SHALL be `h % 12` with 0 shown as 12, and the tag SHALL be AM when the hour is below 12 and PM otherwise. Covers WIDGETS-021, WIDGETS-022.

#### Scenario: Midnight in 12h

- **WHEN** host-local time is 00:05 in 12h format
- **THEN** the digits read 1 2 : 0 5 and the AM/PM pill reads AM

#### Scenario: Morning with a leading zero

- **WHEN** host-local time is 09:05 in 12h format
- **THEN** the digits read 0 9 : 0 5 and the pill reads AM

#### Scenario: Noon and 24h

- **WHEN** host-local time is 12:05 and the format changes from 12h to 24h
- **THEN** 12h shows 1 2 : 0 5 with PM and 24h shows 1 2 : 0 5 with no pill

### Requirement: Weekday and date labels

The date rail SHALL show the localized weekday abbreviation from DK-Suite's `dkDesktopClockLang.weekdays` table (en `SUN…SAT`) at 30 px, weight 400, letter-spacing .22em, colour `--text-secondary`. Below it SHALL be the date at 72 px, weight 200, letter-spacing .02em, `margin-top` 14 px, colour `--text-primary`, both with text shadow `0 2px 26px rgba(0,0,0,.35)`. zh, ja and ko SHALL format the date with `toLocaleDateString(locale, { month: 'long', day: 'numeric' })`. Other locales SHALL use the upper-cased short month name, a space and the day number. The year SHALL never be shown. Covers WIDGETS-024, WIDGETS-025, WIDGETS-063.

#### Scenario: English date

- **WHEN** the locale is en and the date is Thursday 4 September
- **THEN** the rail reads THU above SEP 4

#### Scenario: Japanese date

- **WHEN** the locale is ja and the date is 4 September
- **THEN** the date reads 9月4日 and the weekday comes from the ja table

### Requirement: Glass flip digits

The clock SHALL render four flip cards, each 160×300 px, made of 150 px upper and lower halves. Upper half radii SHALL be 22 22 8 8 and lower half radii 8 8 22 22. Each half SHALL have a 1 px `--glass-border` (0.5 px at the seam), `--glass-bg`, shadow `--glass-hl, 0 18px 46px rgba(0,0,0,.18)` and `backdrop-filter: --glass-blur`. Cards SHALL be 14 px apart. Digits SHALL be 260 px, weight 100, tabular figures, `--text-primary` with `--digit-shadow`, centred across the full 300 px card with each half clipping its own copy. A 26 px dark gradient SHALL shade the bottom of the upper half and a 30 px light gradient the top of the lower half. The colon SHALL be two 12 px glass dots 34 px apart, vertically centred in 300 px, with glow `0 0 14px rgba(255,255,255,.35)`. In 12h an AM/PM glass pill SHALL sit 18 px right of the minutes: 22 px, weight 400, letter-spacing .1em, padding 6×14, radius 14, `--glass-bg-strong`. Covers WIDGETS-023, WIDGETS-026.

#### Scenario: Card geometry

- **WHEN** the tile renders at 1920×480 in 24h
- **THEN** there are four 160×300 cards, a colon column, 14 px gaps and no AM/PM pill

### Requirement: Minute flip animation

Only the minute-ones card SHALL animate. When its digit changes, the upper flap SHALL keep the old digit and rotate from 0° to -92° over 380 ms (`cubic-bezier(.45,.05,.55,.95)`). It SHALL then show the new digit with `--glass-bg-strong` and rotate from 92° to 0° over 380 ms, then return to rest. The lower half SHALL show the new digit throughout. Hours and minute-tens SHALL change without animation. A change during a flip SHALL restart the sequence from the previously shown value. Nothing else on the stage SHALL animate except button press feedback. Covers WIDGETS-027, WIDGETS-028.

#### Scenario: Two-phase flip

- **WHEN** the minute changes from 10:07 to 10:08
- **THEN** for the first 380 ms the upper flap shows 7 flipping away, for the next 380 ms it shows 8 falling into place, and after 760 ms the card is at rest showing 8

#### Scenario: Hour rollover

- **WHEN** the time changes from 10:59 to 11:00
- **THEN** the hour and minute-tens cards change at once and only the minute-ones card flips

#### Scenario: Reduced motion

- **WHEN** the OS requests reduced motion or the app motion setting is reduce, and the minute changes
- **THEN** the new digit appears immediately with no flip and no button transitions

### Requirement: Wall-clock synchronization

Each visible clock SHALL derive its labels from the current host instant at every minute boundary (every second boundary while seconds are shown), on becoming visible, and on mount, and SHALL release its timer on unmount. The management preview SHALL tick like the panel. Covers WIDGETS-029, WIDGETS-060.

#### Scenario: Boundary-aligned update

- **WHEN** a clock mounts at 10:07:42.300 with seconds hidden
- **THEN** its next update is scheduled for 10:08:00.000 and shows 10:08

#### Scenario: Resume after sleep

- **WHEN** the window becomes visible again after the host slept across midnight
- **THEN** the first frame shows the current time and date without replaying missed flips

#### Scenario: Unmount

- **WHEN** the last clock view unmounts
- **THEN** no clock timer remains scheduled

### Requirement: Optional seconds

The clock SHALL offer a persisted `showSeconds` setting, default off. When on, a glass seconds pill (AM/PM pill material, 40 px, weight 200, tabular figures) SHALL appear in the column 18 px right of the minutes, below the AM/PM pill when 12h is active. It SHALL update once per second without animation. Covers WIDGETS-030 (approved decision 6).

#### Scenario: Default look

- **WHEN** a new install shows the clock
- **THEN** no seconds are visible, matching DK-Suite

#### Scenario: Seconds on

- **WHEN** the user turns seconds on at 10:07:42
- **THEN** the pill reads 42 and the next second reads 43 while the minute digits stay put

### Requirement: Stage layout and scaling

The clock SHALL lay out on a 1920×480 design stage: flex row, items centred, `padding: 0 64px`. The date rail SHALL be 240×300 with `margin-left` 16 (x 80…320), weekday at the top, date below and theme nav at the bottom. The flip block SHALL be centred by auto margins between the rail and the right slot. The right slot SHALL be a column with a 20 px gap and `margin-right` 16 that collapses when empty. The font stack SHALL be DK-Suite's (`-apple-system, BlinkMacSystemFont, "SF Pro Display", …, sans-serif`). Outside a 1920×480 host the stage SHALL scale with `transform: scale(widthPx/1920, heightPx/480)` from the top-left. Covers WIDGETS-061 and §3.1.

#### Scenario: Full strip without cards

- **WHEN** the tile renders at 1920×480 in 24h with no cards
- **THEN** the rail spans x 80–320 and the flip block spans x 726–1434

#### Scenario: Scaled preview

- **WHEN** the tile renders in a 960×240 host
- **THEN** the stage is scaled by 0.5 on both axes and nothing reflows

### Requirement: Card slots for weather and now playing

The tile SHALL accept optional weather and now-playing card nodes in the right slot, weather first. It SHALL export typed data contracts for those cards (weather: city, temperature, unit, WMO code, description, today high/low, loading or error state; now playing: title, artist, cover, can-previous, can-next, playing, available). An absent card SHALL render nothing: no placeholder data and no reserved width. Covers the slot side of WIDGETS-040 and WIDGETS-053; the cards themselves belong to `open-quake-lih.7`.

#### Scenario: No cards

- **WHEN** neither card is supplied
- **THEN** the right slot has no children and no width, and no weather or music text appears

### Requirement: Theme catalogue, art and tints

The clock SHALL offer five themes in the fixed order `season, cyber, anime, tactical, aurora`, default `season`, named Season, Cyberpunk, Anime, Tactical and Aurora in English. Each theme SHALL have built-in 1920×480 art owned by open-quake that follows DK-Suite's composition for that theme. The base glass tokens SHALL be DK-Suite's, and each theme SHALL apply DK-Suite's tint overrides: cyber border rgba(0,229,255,.32/.40), cyan inner highlight and magenta digit shadow rgba(255,45,180,.22); anime border rgba(140,210,255,.34); tactical dimmer glass .10/.04/.07 with green border rgba(178,255,190,.25/.32); aurora violet border rgba(190,140,255,.30). Because open-quake's anime art puts bright cumulus behind the digits, anime SHALL also add a crisp blue digit shadow for legibility. This is an open-quake addition to DK's tint list. Covers WIDGETS-031, WIDGETS-032.

#### Scenario: Cyber tint

- **WHEN** the cyber theme is active
- **THEN** card borders use rgba(0,229,255,.32) and digits cast a magenta shadow

#### Scenario: Anime digits over cumulus

- **WHEN** the anime theme renders its built-in art
- **THEN** the white digits keep a defined edge over the white cloud mass behind the cards

### Requirement: Background modes, custom media and fallback

The background SHALL be one of `none` (solid `#0b0e14`, nav label "—") or `theme`. Each theme SHALL have at most one custom slot `{ kind: image | video, path }`. Images SHALL be jpg, jpeg, png, gif, webp or bmp, and videos mp4, webm, mov or mkv and at least 2 s long. The background layer SHALL draw the theme's custom media with `object-fit: cover` (video autoplay, muted, looped, inline) or its built-in art otherwise. A custom image that has not loaded, or a video that has not started playing, within 5 s SHALL fall back to that theme's built-in art. So SHALL any media error. Events from replaced media SHALL be ignored, and video SHALL pause while the document is hidden. Fallback SHALL not change saved settings. The renderer SHALL never receive a file path; custom media SHALL be served by theme id through an app-private protocol. Covers WIDGETS-033, WIDGETS-034, WIDGETS-035 and SCREEN-123. The five built-in scenes SHALL remain independent app-owned SVG artwork, replacing vendor JPGs under independent-device-design. Read migration SHALL preserve per-theme slots and music; theme-only writes SHALL retain those migrated fields.

#### Scenario: Slow video

- **WHEN** aurora has a custom video that does not start playing within 5 s
- **THEN** the aurora built-in art is shown and the saved slot is unchanged

#### Scenario: Missing file

- **WHEN** the season custom image file was deleted
- **THEN** the season built-in art is shown and management marks the slot as missing

#### Scenario: Path never reaches the renderer

- **WHEN** a theme has a custom slot
- **THEN** the renderer receives only its kind, file name, availability and an opaque theme URL

### Requirement: Readability scrim

A scrim SHALL sit above the background: left rgba(0,0,0,.38)→transparent over 20 %, right .38→transparent over 18 %, and a vertical gradient from rgba(0,0,0,.06) at 0 to transparent at 14 %, transparent at 72 % and rgba(0,0,0,.30) at 100 %. Covers WIDGETS-036.

#### Scenario: Scrim present

- **WHEN** any background mode renders
- **THEN** the scrim layer is drawn above it and below the content

### Requirement: On-device theme switcher

The rail SHALL end with a theme nav: ◀ button 54 px, theme name 132 px, ▶ button 54 px, 18 px gaps. Buttons SHALL be round glass with 20 px chevrons. The name SHALL be 17 px, letter-spacing .08em and ellipsised. ◀/▶ SHALL cycle the five themes with wrap, and from `none` SHALL use season as the cycle base (▶ selects cyber, ◀ selects aurora, matching `dkDesktopClock.vue:329-333`). Pressing SHALL scale to .94 with brightness 1.18 and an inner shadow within 90 ms, then spring back over 260 ms (`cubic-bezier(.34,1.56,.64,1)`). The action SHALL fire exactly once, on click or on an effective `quake-sub-touch-end`. Buttons SHALL carry DK-Suite's sub-touch attributes. Covers WIDGETS-037, WIDGETS-039.

#### Scenario: Wrap

- **WHEN** aurora is active and ▶ is pressed
- **THEN** the clock shows season

#### Scenario: From None

- **WHEN** the background is None and ◀ is pressed
- **THEN** the clock switches to a theme and leaves None

#### Scenario: Ineffective touch

- **WHEN** a sub-touch ends with `isEffective` false
- **THEN** the press feedback clears and the theme does not change

### Requirement: Theme persistence with rollback

A device theme switch SHALL show the new theme immediately and persist it by patching only the clock key's `clockStyle.background.themeId`, setting `mode` to `theme`. Other actions, custom slots and keys SHALL be preserved, and the stored revision SHALL change only when content changes. A missing `clockStyle` action SHALL be added with defaults. Failures SHALL return one of `bad-config, invalid-keycode, invalid-theme, cell-missing, cell-not-clock, no-target, write-failed`. On a failure or a thrown error the tile SHALL revert to the persisted theme, unless the user has selected a newer theme since. When the persisted theme arrives from storage, the preview SHALL end. Covers WIDGETS-038.

#### Scenario: Save succeeds

- **WHEN** the user presses ▶ on season and the save succeeds
- **THEN** cyber is shown at once, stays after the change broadcast, and survives a restart

#### Scenario: Save fails

- **WHEN** the user presses ▶ on season and the store answers `write-failed`
- **THEN** cyber is shown briefly and then season is shown again

#### Scenario: Patch is narrow

- **WHEN** the theme changes on a key with a custom aurora video and seconds on
- **THEN** the stored aurora slot and the seconds setting are unchanged

### Requirement: Clock style normalization

Reading a stored clock style SHALL be total. A v0.4 style (`mode/themeId/themes`) SHALL be validated slot by slot and invalid slots dropped. A v0.3 style SHALL be migrated: `builtin` with a source becomes that theme; `image` or `video` with a source becomes theme season with a season slot; `none` stays none. Anything else SHALL become theme season with no slots and music off. Covers WIDGETS-062.

#### Scenario: v0.3 video

- **WHEN** a stored style is `{ background: { mode: 'video', source: '/v/rain.mp4' } }`
- **THEN** it reads as theme season with a season video slot for that path

### Requirement: Clock settings

Management SHALL offer a Desktop clock section with: Theme background (segmented Theme / None and five theme cards in catalogue order), Seconds (switch), and per card a 4:1 thumbnail, a ✓ when selected, a "Custom" badge when a slot exists, a red "!" when its file is missing, "Restore default background" and "Change background". Choosing media SHALL use a main-process dialog, check existence and extension, require videos of at least 2 s (6 s probe timeout), and save nothing on cancel. Errors SHALL use DK-Suite's strings "File missing or unusable; fell back to built-in" and "Video duration too short, should be longer than 2 seconds.". Every change SHALL save immediately and broadcast to the panel. Covers WIDGETS-056 (clock format, theme and seconds; weather and music cards are lih.7), WIDGETS-058, WIDGETS-059.

#### Scenario: Short video rejected

- **WHEN** the user picks a 1.5 s mp4 for cyber
- **THEN** the error reads "Video duration too short, should be longer than 2 seconds." and the cyber slot is unchanged

#### Scenario: Restore default

- **WHEN** the user restores the default background on a theme with a custom image
- **THEN** the slot is removed and the panel shows the built-in art

### Requirement: Clock profile configuration

The DK-Desktop-Clock profile SHALL hold one `dkDesktopClock` key at `1,1` rendered full-strip (8×2), with `supportKnob` and `supportTouchEffect` false, an empty title and icon, and title, grid, icon, delete and drag editing disabled. Its default actions SHALL be `hourFormat: '24h'` and `clockStyle: { background: { mode: 'theme', themeId: 'season', themes: {} }, musicEnabled }`. The strip tile registry SHALL render a `dkDesktopClock` key as this clock over the key's full-strip box. Covers WIDGETS-020, WIDGETS-021.

#### Scenario: Panel shows the clock profile

- **WHEN** the active profile is the DK-Desktop-Clock profile
- **THEN** the strip shows the full-strip clock with the saved theme, season by default

#### Scenario: Clock store unavailable

- **WHEN** the clock store cannot be reached
- **THEN** the strip still shows the clock with DK-Suite's defaults instead of an empty tile

#### Scenario: Invalid stored format

- **WHEN** a stored clock record has an unknown `hourFormat` or a malformed `clockStyle`
- **THEN** the record is normalized to defaults for the bad field and the other fields keep their values

### Requirement: Safe clock updates and rendering

Clock saves SHALL preserve unknown metadata and legacy media, report committed saves accurately, and recover unreadable settings. Main SHALL authorize media by the requesting app frame and independently decode video duration. Time rendering SHALL remain accessible and boundary timers SHALL stay positive across DST fall-back. Covers WIDGETS-019/029/034/038/059/060/062.

#### Scenario: Review regression boundaries

- **WHEN** a clock change saves keys with unrelated metadata or a legacy image/video background
- **THEN** metadata at key, config and action levels survives and legacy custom media remains in the season slot before the theme patch is applied

#### Scenario: Unreadable settings and committed saves

- **WHEN** saved settings cannot be read
- **THEN** management receives recovered defaults and can attempt a new save
- **WHEN** a settings rename succeeds but temporary-file cleanup fails
- **THEN** the save succeeds and the theme does not roll back

#### Scenario: Private media and trusted duration

- **WHEN** a page outside the app renderer requests saved clock media
- **THEN** it cannot read that media even after an app window navigates to it
- **WHEN** management supplies a forged video duration
- **THEN** the main-owned decoder independently probes the candidate with a six-second timeout and rejects short or unusable media without saving

#### Scenario: Accessible time and repeated DST hour

- **WHEN** a clock renders with optional seconds and AM/PM
- **THEN** it exposes one formatted accessible time and hides decorative digit copies
- **WHEN** local time repeats during DST fall-back
- **THEN** every next boundary delay is positive and the clock avoids a tight timer loop

### Requirement: Canonical profile clock configuration

The profile owner SHALL persist each clock key's `hourFormat`, `clockStyle` and `showSeconds` actions in `profiles-v1.json`. Changes SHALL target a profile, page and key, preserve unrelated actions and metadata, and increment only that profile's revision. The strip and editor SHALL read that key's configuration. Covers WIDGETS-020/021/022/038/056/062 and beads open-quake-t10.2 and open-quake-t10.4.

#### Scenario: Independent profiles after restart

- **WHEN** profile A saves 12h and seconds and profile B saves 24h without seconds
- **THEN** both retain their own format and style after restart and editing A leaves B and wallpaper unchanged

### Requirement: One-time legacy clock migration

Before publishing the first profile snapshot, the profile owner SHALL atomically migrate `clock-v1/clock.json` and serial-scoped `wallpaper-v1/settings` into clock keys and persist `clockConfigVersion: 1` in the same envelope. Existing non-default profile actions SHALL win. Missing actions and actions equal to the built-in preset SHALL inherit matching legacy actions, then defaults. Legacy style keys SHALL match by key code. For hour format, serials selecting that profile SHALL be tried in lexical order, followed by desktop-preview and all remaining saved serials in lexical order; the first existing saved serial supplies the format. A profile without such a selection SHALL use desktop-preview, then the lexically first available serial. All original legacy files SHALL remain untouched. Failure SHALL publish no migrated snapshot and SHALL permit retry. A completed migration SHALL never import legacy stores again. Covers WIDGETS-021/022/038/056/062.

#### Scenario: Fresh and legacy-only stores

- **WHEN** the profile owner starts without legacy files or with legacy files and no profile file
- **THEN** it persists defaults or migrated built-in clock values respectively and marks the atomic envelope complete

#### Scenario: Partial migration and retry

- **WHEN** a key already has custom profile settings, other actions are absent, and the first migration write fails
- **THEN** custom settings and unrelated fields survive, originals remain intact, retry fills only missing or built-in-default actions, and a completed repeat writes nothing

### Requirement: Recover and target canonical clock configuration

Profile clock migration SHALL recover a valid wallpaper backup when its primary is missing or invalid. If legacy clock or wallpaper data is unusable, migration SHALL retain the originals, record a scrubbed diagnostic and commit defaults without blocking profile publication. Migrated backups SHALL archive only profile-owned clock media. Legacy archive imports SHALL migrate only imported profiles before deduplication and SHALL be idempotent. Screen controls SHALL target the same serial-scoped profile/page/key as the displayed strip. Profile-targeted clock consumers SHALL ignore other targets and targetless compatibility broadcasts. An unchanged editor draft SHALL not add a write before a clock auto-save. Covers WIDGETS-020/021/022/038/056/062.

#### Scenario: Corrupt legacy files

- **WHEN** legacy primary data is corrupt
- **THEN** a valid backup supplies the hour format, or defaults and a scrubbed diagnostic permit profiles to load if neither copy is usable

#### Scenario: Legacy media after migration

- **WHEN** abandoned legacy clock media is deleted after migration
- **THEN** the backup succeeds with only the profile-owned clock media

#### Scenario: Legacy import into a migrated destination

- **WHEN** a pre-migration archive is imported twice into a migrated installation
- **THEN** imported clocks inherit the archive configuration, existing clocks stay unchanged and the second import adds no profiles

#### Scenario: Clock control ownership

- **WHEN** a physical serial and desktop-preview select different clocks
- **THEN** Screen controls edit the physical serial's displayed clock, unrelated and targetless broadcasts cannot replace it, and one editor clock change with an unchanged draft creates one revision

### Requirement: Keep clock media paths in main

Renderer-facing profile responses and broadcasts SHALL project absolute clock media paths to opaque references. A key editor round trip SHALL restore only references belonging to its original saved key without dropping selected media. Covers WIDGETS-034/038/056.

#### Scenario: Profile with custom media

- **WHEN** a renderer reads or receives a profile with selected clock media and saves that key again
- **THEN** no absolute clock media path crosses IPC, and the persisted slot retains its original path


### Requirement: Per-key clock editor and targeted publication

Each clock key SHALL independently own hourFormat, clockStyle, weather, and showSeconds in the canonical profile repository. Theme updates SHALL carry profile/page/key and revision and main SHALL stamp source pc-grid or device-screen from authenticated window identity. Omitted device targets SHALL resolve only from the sender's active device selection. Unknown targets, mismatched owners, stale revisions and failed writes SHALL leave committed data unchanged. A targeted broadcast SHALL patch only the changed clock actions and the matching editor revision, preserving selection and unrelated unsaved edits without reloading the editor or another clock. Covers MAIN-141, SCREEN-142, WIDGETS-038, WIDGETS-056.

#### Scenario: Theme changes while a draft is open

- **WHEN** a device saves a theme for clock A while its editor has unsaved format changes and clock B has different settings
- **THEN** A's theme and revision update without losing its draft or selection, B stays unchanged, and a failed or stale write publishes nothing

### Requirement: Clock defaults and format draft

The built-in clock SHALL retain all title/icon/grid/delete/drag locks and no knob/touch-effect support. First-install clock actions SHALL enable weather and music with empty city, Celsius, season theme, and 24h format. IP lookup SHALL remain off until explicit consent. Missing weather fields SHALL backfill without replacing valid saved fields. Each key SHALL render its persisted actions independently of wallpaper format. A key editor's hour-format change SHALL preview immediately, revert on Cancel/navigation, and persist only on Save. Covers MGMT-346, WIDGETS-020, WIDGETS-021, WIDGETS-022, WIDGETS-057.

#### Scenario: Two independent clocks and cancellation

- **WHEN** clock A uses 12h and clock B uses 24h, and A's format draft is cancelled
- **THEN** their saved formats survive restart, wallpaper stays unchanged, and the panel returns to A's original format

#### Scenario: First-install cards without consent

- **WHEN** the built-in clock first renders with an empty city
- **THEN** both cards show empty placeholders and no IP or forecast request starts

### Requirement: Passive clock hosts

Clock hosts SHALL distinguish passive, edit, and panel modes. Passive mode SHALL freeze the mount instant, force 24h and render weather/music switches as static placeholders without clock, weather or media bridge subscriptions or requests. Edit and panel modes SHALL tick at second/minute boundaries, resynchronize on visibility resume, and release timers/listeners on unmount. Covers WIDGETS-029, WIDGETS-060.

#### Scenario: Passive preview beside a live clock

- **WHEN** time crosses midnight and visibility resumes
- **THEN** the passive host stays frozen with no IPC while edit/panel clocks show the current local time and dispose their timers on unmount

### Requirement: Bounded theme thumbnails

Custom video theme cards SHALL capture a decoded first frame at min(0.1 seconds, duration/2) into a 960 by 240 JPEG at quality 0.72. Capture SHALL complete or fail within 4 seconds and release media/listeners/timers on failure or unmount. Failure SHALL show a filename placeholder and video tag. Theme radios SHALL support Enter/Space, selection/custom/missing badges, change/restore actions, and disabled controls while saving/probing. Covers WIDGETS-058.

#### Scenario: Video has metadata but no decoded frame

- **WHEN** metadata loads but a frame never decodes within 4 seconds
- **THEN** the card shows its filename placeholder, saves no empty thumbnail, and releases the decoder

### Requirement: Window-owned clock media references

Main SHALL issue opaque, unguessable custom-media references only after an authenticated clock request resolves a committed target. References SHALL belong to that window and target, expire on target change or navigation, and require the panel's current committed selection on every read. Raw profile selectors SHALL never authorize renderer media reads. Responses SHALL never grant wildcard CORS. Covers WIDGETS-034/038 and review 4377943205.

#### Scenario: Media from another profile or window

- **WHEN** a panel requests a management window's reference, guesses a profile selector, or reuses its reference after switching profiles
- **THEN** main refuses the request, while the issuing window can load its current target's media and capture its decoded thumbnail

### Requirement: Selected-key Screen enrichment controls

Screen SHALL expose one weather/music control set backed by the selected clock key and SHALL leave legacy global weather settings unchanged. Covers WIDGETS-056 and review 4377943008.

#### Scenario: One Screen weather and music editor

- **WHEN** Screen displays clock B while clock A and the legacy global weather settings differ
- **THEN** it shows exactly one weather/music control set, saves city and music to B, and leaves A and global settings unchanged

### Requirement: Clock visibility and activation consumers

Clock media SHALL pause when mounted or replaced while the document is hidden, resume on visibility when paused, and remove visibility listeners on disposal. Theme navigation SHALL release pressed feedback on cancellation, save once per effective native touch or browser activation, and ignore compatibility clicks within 500 ms of a native end or pointer cancellation unless a new pointer or keyboard action starts. Sources: WIDGETS-035, WIDGETS-039.

#### Scenario: Hidden media and duplicate activation

- **WHEN** a hidden clock mounts or replaces a video and a theme button receives an effective native release followed by a compatibility click
- **THEN** the video stays paused and only one theme selection is saved
- **AND** a new pointer or keyboard activation remains usable, cancelled releases save nothing, and unmount removes listeners and timers
