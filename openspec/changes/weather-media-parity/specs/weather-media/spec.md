# Spec delta

## Purpose

Show verified-city weather and one consistent system-media session on the clock and DK-Player, with explicit privacy choices and unavailable states.

> **Visuals superseded (2026-10-25).** Ramiro rejected the DK-Suite imitation on the strip. Visual clauses in this delta (DK-Player turntable drawing and geometry, clock music card styling) are superseded by `independent-device-design` (`device-visual-design`). Behavior clauses here remain authoritative.

## ADDED Requirements

### Requirement: Weather consent and city verification

Weather SHALL default to disabled, manual city entry and Celsius. IP lookup SHALL default to off and require an explained opt-in setting naming the third-party IP location services. Disabled weather or an empty manual city SHALL cause no network requests. After 600 ms idle, city verification SHALL reject fewer than two letters or symbol/digit-only inputs, search open-meteo with a 12 s deadline, and show checking, matched name/country, not-found, network or timeout. A changed city SHALL immediately invalidate the saved location and older responses SHALL NOT replace the new query. Saved coordinates SHALL only be used when sourceCity matches the current input. Evidence: WIDGETS-045/050/051/052 and approved GAP-MAP decision 15.

#### Scenario: Empty manual city

- **WHEN** weather is enabled without a city and IP lookup is off
- **THEN** the card keeps its placeholders, the UI offers manual city entry, and no geolocation or forecast request runs

#### Scenario: City changes during verification

- **WHEN** Berlin is still being verified when the user types Paris
- **THEN** the saved Berlin location is cleared immediately and its late response cannot restore it

#### Scenario: Typing a manual city

- **WHEN** the user types city prefixes less than 600 ms apart
- **THEN** the input updates immediately and clears the saved location, but only the latest settled query is persisted with its verification result; intermediate prefixes cause no geocoding or forecast requests

#### Scenario: Japanese and explicit-country queries

- **WHEN** a Japanese user searches for 東京 or 東京, JP, or an English user searches for London, UK
- **THEN** Japanese queries retain the Japanese locale without a China restriction and UK matches GB; an explicit country always filters candidates, including in Chinese UI

#### Scenario: Country suffix cannot validate an invalid city

- **WHEN** a query has fewer than two city-name letters before the comma, such as `, DE` or `A, DE`
- **THEN** renderer verification and both public weather service paths reject it as not-found without network requests, including when saved coordinates match that invalid query

#### Scenario: Ambiguous city from IP lookup

- **WHEN** opted-in IP lookup identifies Paris in the United States
- **THEN** both forecast providers use the validated IP coordinates instead of selecting another Paris through a worldwide name search; missing or invalid coordinates fail over to the other IP provider

### Requirement: Weather providers and cache

Network access SHALL go through a typed main-process adapter with replaceable test fakes. The default SHALL geocode through open-meteo and fetch current temperature/WMO code and daily high/low with timezone=auto and forecast_days=3, with 10 s HTTP deadlines and rejected redirects. Forecast failure SHALL try wttr.in for the verified location, converting its codes to WMO. A matching city/provider/locale cache SHALL last 30 min; forecast failure SHALL retain matching cached data marked stale, and a different city SHALL never inherit it. Celsius and Fahrenheit SHALL round only after conversion. An optional HTTP(S) forecast URL SHALL reach the provider through the same adapter, contain no URL credentials, and replace the standard forecast parameters. Invalid URLs SHALL be rejected without changing saved settings. Evidence: WIDGETS-042/043/044/046/050/052. The custom-URL forwarding bug described in AUDIT_WIDGETS F3 SHALL NOT be copied.

#### Scenario: Primary forecast fails

- **WHEN** open-meteo fails and wttr.in returns current weather and today's range
- **THEN** the card shows the fallback data with the corresponding WMO icon and requested units

#### Scenario: Both forecasts fail after cache expiry

- **WHEN** both providers fail for a city with cached data older than 30 min
- **THEN** that city's cached values remain visible with a stale indicator

#### Scenario: Fallback condition text is missing

- **WHEN** the primary provider fails and wttr.in returns overcast or patchy snow without text in the requested locale
- **THEN** the decoded WMO condition produces a localized overcast or snow description and the matching cloud or snow icon

#### Scenario: Custom forecast requests Fahrenheit

- **WHEN** a custom URL includes Fahrenheit or duplicate temperature unit parameters
- **THEN** the request replaces them with one explicit Celsius parameter, preserves unrelated custom parameters, caches Celsius current/high/low values and converts each displayed value once for the selected unit; default requests also explicitly select Celsius

### Requirement: Weather refresh and card

The card SHALL occupy 564×153 design pixels with a radius of 32, an 88 px icon badge, 50 px temperature, 19 px city/description and TODAY H/L column as recovered in AUDIT_WIDGETS §3.1. WMO codes SHALL use the eight recovered groups and a generic-cloud fallback. Loading and failure SHALL retain temperature/range placeholders `--`, mark aria-busy during loading and show recovered error strings. Refresh SHALL start 800 ms after mounting, repeat every 30 min while visible, debounce configuration refresh by 50 ms and coalesce in-flight requests into one follow-up using the newest configuration. IP lookup failure SHALL retry once after 120 s. Hidden/unmounted views SHALL release their timers and listeners. Strings SHALL use the eight recovered locales; unknown weather text SHALL NOT fall back to English for another locale. Evidence: WIDGETS-040/041/047/048/049.

#### Scenario: Hidden card

- **WHEN** 30 min passes while the view is hidden
- **THEN** no forecast refresh starts until the view is visible

#### Scenario: Automatic location recovers between failures

- **WHEN** an automatic-location refresh fails, retries after 120 seconds and recovers, then fails again at normal expiry
- **THEN** the new failure receives one fresh 120-second retry, continued failures return to the normal interval, and hidden or disposed views start no requests

#### Scenario: Refresh after a slow load or cache hit

- **WHEN** a forecast finishes after the initial mount delay, or another visible card reads an existing cache entry
- **THEN** its next refresh uses the remaining cache lifetime returned by main, measured from response completion, so a cache hit cannot postpone the provider refresh by another 30 minutes

#### Scenario: Provider outage without cached data

- **WHEN** a valid city has no cached data and both forecast providers fail
- **THEN** the clock shows the recovered Weather unavailable string, while city-not-found keeps its distinct message

#### Scenario: Weather failure text stays legible on bright art

- **WHEN** Weather unavailable or City not found renders on any built-in clock theme, including the bright Season sky
- **THEN** the text sits on its own dark translucent chip with at least 4.5:1 contrast instead of tinted text on the glass card

#### Scenario: Portable mock smoke artifacts

- **WHEN** a developer runs the focused native mock smoke with an arbitrary non-empty artifacts directory
- **THEN** the smoke creates that directory and isolates and cleans its user data there without requiring a machine-specific volume path

### Requirement: Shared media intent and native boundary

Clock and DK-Player SHALL read one typed system-session snapshot with revision, source app, title, artist, safe cover URL, playing status, duration, position, transport capabilities and stable failure code. Controls SHALL serialize and refresh live state before deciding toggle direction, gate play/pause/previous/next by capability, and refresh state after accepted or rejected controls. macOS SHALL use the reviewed BSD-3-Clause helper source pinned in vendor/mediaremote-adapter, compiled locally for Apple Silicon and packaged with its license. Windows SHALL use fixed PowerShell WinRT SMTC behind its platform check. Native adapters SHALL bound child lifetime to five seconds and output to four MiB, await child termination on interruption, validate metadata and cover dimensions before native decoding, derive capabilities from the OS, and recheck source identity before command delivery. Unavailable dependencies SHALL report MEDIAREMOTE_UNAVAILABLE or SMTC_UNAVAILABLE, denied access SHALL report TCC_DENIED, and malformed replies or unexpected native failures SHALL report TRANSPORT_ERROR with privately retained catalog causes and correlated diagnostic spans. Mock roots SHALL perform no native media IO unless an explicit adapter is injected. Other platforms SHALL report UNSUPPORTED_PLATFORM. No npm dependency SHALL be added by this follow-up. Evidence: WIDGETS-054/111/113/117, KNOB-096/098. Spotify Web API/login/lyrics are excluded by approved decision 12; an OS session from a Spotify app is still system media.

#### Scenario: Stub platform

- **WHEN** the app reads or controls media through a disabled or unavailable native adapter
- **THEN** it returns a stable unavailable result, disables controls and starts no helper or player

#### Scenario: Stale play snapshot

- **WHEN** two toggle intents arrive while the native state is changing
- **THEN** each intent resolves against a fresh session in sequence rather than inverting a renderer snapshot

### Requirement: Clock music card

The card SHALL be 564 px wide with 22×24 px padding, radius 32, a 108 px cover with gradient-note fallback, ellipsized title/artist, 54 px previous/next and 70 px play/pause controls. It SHALL render idle, playing, paused and unavailable states. Unavailable SHALL use opacity .55, disabled controls and `Music unavailable`; control rejection SHALL show that tip for 1.8 s. Broken covers SHALL fall back. Effective strip sub-touch and pointer/keyboard controls SHALL dispatch one intent. Disabled cards SHALL render nothing in their clock slots. Evidence: WIDGETS-053/054/055, KNOB-089.

#### Scenario: Clock and player agree

- **WHEN** the native session changes to paused
- **THEN** both visible consumers show the same title and paused transport state

### Requirement: DK-Player turntable and guide

The system-mode playAudio tile SHALL use the recovered 1920×480 geometry: platter at 355,50 sized 415×416; source pill 1511,49 sized 300×76; play/stop at 1561,140 sized 200; previous at 1420,180 and next at 1782,180 sized 120. It SHALL show source app or `System Media`, safe album cover or red label, title on SVG arcs, cyan play/stop and disabled capability states. Playing SHALL rotate the disc counterclockwise once per 10 s. The needle SHALL rest at 25° and use 12−27×progress while playing, with 1600 ms updates and 900 ms track changes; unknown duration SHALL sweep over a 60 s loop. Motion reduction SHALL stop loops. The no-session guide SHALL use the recovered title/subtitle, a centered 780×160 toast, a 4.5 s lifetime, 3 s session-loss suppression, 1.5 s re-show guard and immediate dismissal when a session appears. The source indicator SHALL not launch an application. System errors SHALL show the recovered hints. Evidence: WIDGETS-112/114/117/118, KNOB-088/089/091/092/093/094/095/097/098/099. Local file playback remains governed by soundboard-player, including KNOB-090, and SHALL NOT be claimed by this system-mode renderer.

#### Scenario: Track change gap

- **WHEN** a session disappears and returns within 3 s
- **THEN** the guide does not interrupt playback

#### Scenario: System error hint is readable on the strip

- **WHEN** the DK-Player shows a system media error hint
- **THEN** it renders at 18 px or larger, bottom-anchored above the source pill, and a long localized hint wraps to at most two lines without overlapping the pill

### Requirement: Knob ownership and test safety

The DK-Player SHALL expose a 380×88 overlay insertion point at 1471,355 and readable session/transport state for the knob lane. It SHALL NOT create another volume owner or send volume commands. Unit and native mock smokes SHALL use typed weather/media fakes, never contact providers, never open HID and never bind a server. Evidence: WIDGETS-115 and KNOB-075..080 ownership in PR #24.

#### Scenario: Knob overlay supplied

- **WHEN** the knob lane supplies its volume overlay
- **THEN** it renders in the recovered location while this lane only controls the media transport

#### Scenario: Awaitable application shutdown

- **WHEN** shared application shutdown begins during an admitted settings write, media command or polling read
- **THEN** weather/media rejects new requests, drains admitted work without late broadcasts, and disposes its runtime exactly once alongside the maintenance, monitor, voice, profile and clock owners


### Requirement: Profile clock enrichment and cache operations

Weather and music controls SHALL save only the selected clock key's weather action and clockStyle.musicEnabled. City verification SHALL retain the 600 ms debounce, 12 second timeout, localized checking/matched/not-found/network/timeout states and invalid URL rejection through editor save. Weather saves SHALL preserve unrelated action fields, stamp updatedAt and increment weatherVersion. Missing weather fields SHALL backfill with empty manual city, Celsius and IP consent off. WeatherMediaController SHALL expose typed cache read/clear operations and per-instance/side weather fetch using explicit decoded settings, without mutating global settings. Configuration refresh SHALL fan out to every mounted live card while preserving each card's own configuration; passive cards SHALL not subscribe. Covers MAIN-142, MGMT-278, MGMT-279, WIDGETS-056.

#### Scenario: Independent weather caches

- **WHEN** two clock instances fetch different cities or sides and one clears its cache
- **THEN** a cache read performs no HTTP, the other instance retains its cached data, units convert once, and clear forces a new fetch only for the chosen instance

#### Scenario: Selected-key weather and music save

- **WHEN** clock A changes city, units, forecast URL and music switch
- **THEN** its valid actions survive restart, clock B remains unchanged, invalid URLs/timeouts show the expected status, and mounted live cards refresh using their own current settings

### Requirement: Weather group and card state consumers

The rendered weather card SHALL use clear codes 0/1, partly cloudy 2, cloudy 3, fog 45/48, drizzle 51/53/55/56/57, rain 61/63/65/66/67/80/81/82, snow 71/73/75/77/85/86 and thunder 95/96/99. Other numbers and null SHALL render the default cloud outline. The clock music card SHALL replace a broken cover with its note fallback, reset that failure for a different cover, reconcile transport capabilities, and remove a rejected-control tip after 1800 ms. Passive strip previews SHALL send no control requests. Sources: SCREEN-124, WIDGETS-041, WIDGETS-055.

#### Scenario: Weather code and music reconciliation

- **WHEN** every documented WMO code or an unknown/null code reaches a weather card and a music cover fails or transport is rejected
- **THEN** the card renders the corresponding SVG geometry, the music cover falls back, and the transient tip clears after 1800 ms
- **AND** subsequent snapshots update disabled capabilities while idle and unavailable remain distinct and passive previews cannot mutate playback
