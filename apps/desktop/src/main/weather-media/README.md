# Weather and system media

`weather-media-parity` implements weather providers, settings, cards and native
system-media transport. macOS builds compile the BSD-3-Clause helper source
pinned in `vendor/mediaremote-adapter/UPSTREAM.md` for Apple Silicon and unpack
it beside the application resources with its license. No downloaded executable
or npm dependency is required. Windows uses fixed PowerShell WinRT SMTC.
Linux and mock-device roots retain explicit unavailable adapters. Tests may
inject a native adapter independently of mock hardware.

The shared service owns card and committed media-key control. It never starts
a player. Enabled native commands determine capabilities, and control rechecks
the observed source. macOS pins both PID and bundle identity, including
unbundled processes. Windows pins SourceAppUserModelId. Neither OS offers an
atomic global read-and-send transaction, so source validation minimizes but
cannot eliminate a player change between validation and delivery.

## Boundaries

- `WeatherNetwork` is the only forecast/geocoding/IP network capability.
  Production HTTP rejects redirects, limits response bytes to 1 MiB, aborts
  after 10 s, and validates JSON before use. The fallback only receives a
  verified city; IP services run only with enabled weather, empty city and
  explicit IP consent. Custom forecast URLs cannot contain credentials.
- `WeatherService` owns provider selection and a 30 min Celsius cache. The
  cache key includes location, city, provider URL, consent and locale. Unit
  changes convert the same source values before rounding. A refresh failure
  can retain only matching cached data. Ready replies include the remaining
  cache lifetime so visible cards schedule at expiry, including cache hits.
  IP lookup retains validated coordinates for both forecast providers instead
  of geocoding an ambiguous city name. No stale city coordinates are reused.
- `WeatherSettingsRepository` atomically saves `weather-media-v1/settings.json`
  under Electron userData. Settings are global while per-profile editing is
  owned by other lanes. Invalid/unreadable files load safe disabled defaults.
- `SystemMediaAdapter` exposes native reads and play/pause/previous/next/stop,
  fifteen-second seek, repeat and shuffle commands. Child IO has a five-second
  deadline, four-MiB output limit, fixed argv and a minimal environment. Runtime
  interruption kills and awaits the child. Metadata is Schema-decoded. Raster
  dimensions and compressed bytes are bounded before native cover decoding.
  Missing dependencies, access denial and unexpected failures project to stable
  UI states after catalog errors and failed spans reach local diagnostics.
  Titles, artists, artwork, paths and raw stdout/stderr never enter logs.
- `SystemMediaService` serializes controls, reads live state to resolve a
  toggle and re-reads on rejection. The renderer client subscribes before its
  initial read and independently guards settings and media revisions.
- IPC accepts only the application's exact renderer document and top frame.
  Settings and city verification additionally require main's management-window
  identity. Panel can read forecasts and control the shared session.
- The renderer owns visible refresh timing, city verification sequencing and
  transient tips. City edits invalidate coordinates immediately; only the
  latest query is saved after 600 ms idle and verification, together with its
  matched coordinates. Native mock smoke exercises production IPC/preload/renderers
  with injected fake IO. It cannot prove native media control works.

## Provider condition and temperature normalization

The condition audit uses World Weather Online's `Condition` column at
https://www.worldweatheronline.com/feed/wwoConditionCodes.txt, retrieved on
2026-10-24. Some icon filenames contradict that column, such as the sleet
icon for code 179's patchy snow. The text semantics govern the conversion.
All 48 existing mappings were audited. Code 122 is overcast, WMO 3, and 179
is patchy snow, approximated by light snow showers, WMO 85.

The supported WMO set loses some provider distinctions:

- Cloudy and overcast both use WMO 3; mist uses fog 45. Freezing fog uses
  depositing-rime fog 48, without claiming the provider measured rime.
- Nearby rain/snow use light showers 80/85. Patchiness and intermittent
  precipitation have no separate representation. Blowing snow uses light
  snow 71; blizzard uses heavy snow 75, losing the wind component.
- Sleet has no code in this compact WMO forecast set. Codes 182/317/320
  use snow 71/71/75; sleet showers 362/365 use snow showers 85/86. Ice pellets
  350/374/377 use snow grains 77, retaining frozen precipitation while losing
  pellet size, intensity and shower distinctions. These are approximations,
  never freezing rain. Provider text, when supplied in the requested locale,
  preserves the more specific description.
- Freezing drizzle 185/281/284 uses 56/56/57 and freezing rain 311/314 uses
  66/67. Rain showers 353/356/359 use 80/81/82; snow showers 368/371 use 85/86.
  Moderate-or-heavy conditions choose the moderate code when one exists.
- Thunder conditions 200/386/389/392/395 all use 95. Thunder takes priority
  over the rain/snow distinction; hail codes 96/99 would invent hail.
- Clear, partly cloudy, ordinary drizzle/rain/snow and fog retain their
  corresponding WMO groups and stated intensity. The current official table
  also lists 12 haze/dust/smoke codes outside the supported conversion set.
  They retain the existing generic cloud fallback; no fog or precipitation
  is inferred for those unsupported conditions.

Default and custom forecast URLs always request `temperature_unit=celsius`.
Required parameters replace every duplicate of the same name; unrelated
custom parameters, including repeated parameters, survive. Current/high/low
remain unrounded Celsius in the cache and each response converts and rounds
once for the selected display unit.

## Rendering and knob integration

`ClockWeatherCard` implements the clock lane's typed weather props. The clock
slots mount only when enabled, with no reserved width when disabled.
`ClockMusicCard` and `PlayerCard` consume the same `MediaSnapshot` and intent
function. Media art is limited to bounded raster data URLs, so neither card
initiates a network image request. The flat player design is owned by `independent-device-design`; no vendor
binary assets are copied.

`PlayerCard.volumeOverlay` is a ReactNode placed at design x1471 y355,
380×88. The knob lane retains all volume state, activation and arbitration;
this lane sends no volume commands. Session capabilities and progress are
available on the shared `WeatherMediaSnapshot.media` contract. Local MP3
soundboard execution remains owned by `soundboard-player`; the new renderer
is system mode. Spotify Web API/login/lyrics are excluded by decision 12.

Unavailable adapters use the generic unavailable hint. No fallback controls
are promised. Settings reuse the player's localized failure text, per the Opus
copy review.

## Verification

Unit tests use recording fakes, Effect TestClock and bounded owned Node child
processes. No live HTTP, HID or local servers are used. Run all six lane gates from the repo root,
then the README media smoke and this focused smoke. Pass any non-empty
artifacts directory. During parity lane work, set TMPDIR and the artifacts
argument to the lane scratch folder required by LANE-BRIEF.md. Other checkouts
can use a build-output directory:

```sh
pnpm --filter @open-quake/desktop exec electron-vite build --config src/main/weather-media/smoke.config.ts
env -u ELECTRON_RUN_AS_NODE OPEN_QUAKE_MOCK_DEVICE=1 pnpm --filter @open-quake/desktop exec electron out/weather-media-smoke/smoke.js out/weather-media-smoke/artifacts
```

The focused smoke checks disabled-card zero-network behavior, manual-city
weather, effective versus ineffective sub-touch, shared pause state, panel
write denial, source/capability states and the guide. It captures the clock
with both cards and DK-Player playing, paused, idle, unavailable, navigation
unavailable and unknown-duration states. Every window and runtime is disposed.
The 2026-10-25 actual-root acceptance used mock hardware and a silent native
macOS publisher. Clock effective sub-touch paused it, player controls resumed
it, and an ordinary saved media key paused it through the production key
runtime. Five 1920×480 captures include playing, paused and injected EACCES
failure. The persisted sink contained 629 records with matching request/trace
IDs, failed native spans, catalog identity and EACCES; player metadata and the
private error sentinel were absent. Runtime/publisher cleanup completed.

A read-only Windows SSH session returned SMTC_UNAVAILABLE for the exact missing
service HRESULT 0x80070424. This is session-0 absence evidence, not interactive
Windows control acceptance. Interactive Windows metadata, artwork and commands,
third-party players and physical QUAKE gestures/audio remain unverified.
The local arm64 app package boots its renderer/preload/native bindings in the
standard package smoke. Its unpacked helper independently read the synthetic
publisher and delivered pause/play with observed state transitions. This
proves resource delivery and native loading, not an installed live-device app. The task remains open through delivery and native acceptance.
Evidence is under the approved `system-media` scratch directory, especially
`root-YsaxQ7`, `native-session` and `windows-classified.json`.
