# Weather and system media

`weather-media-parity` implements cluster 6's weather providers, settings and
cards. Its native system-media adapters are explicit stubs. Ramiro approved a
separate follow-up to vendor a reviewed MediaRemote helper, tracked as
`open-quake-lih.7.1.6`. This PR does not install or bundle one.

The recovered main bridge launches `mediaremote-adapter.pl` with
`MediaRemoteAdapter.framework` from `vendor/mac-mediaremote`. Source evidence:
`~/dev/dark-encyclopedia/dk-suite-introspeccion/v0.4.95/app-resources/background.js`
near offset 1759558. Neither is present here. `nowplaying-cli` is also absent.
The alternatives are the approved reviewed vendored helper, or an explicitly
approved CLI dependency. App-specific AppleScript would miss other system
sessions and does not satisfy the generic system-media contract.

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
- `SystemMediaAdapter` exposes `read()` and `control(play|pause|previous|next)`.
  Expected OS failures are schema-derived states. A future helper must map
  TCC denial, transport failure and session loss, bound subprocess time and
  output, validate cover bytes, release observers/processes on quit and never
  start a player. Windows SMTC stays behind the `win32` check and reports
  `SMTC_UNAVAILABLE`. macOS reports `MEDIAREMOTE_UNAVAILABLE`; other hosts
  report `UNSUPPORTED_PLATFORM`. Stubs spawn no process.
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
initiates a network image request. SVG/CSS turntable artwork is drawn in this
repo; no vendor binary assets are copied.

`PlayerCard.volumeOverlay` is a ReactNode placed at design x1471 y355,
380×88. The knob lane retains all volume state, activation and arbitration;
this lane sends no volume commands. Session capabilities and progress are
available on the shared `WeatherMediaSnapshot.media` contract. Local MP3
soundboard execution remains owned by `soundboard-player`; the new renderer
is system mode. Spotify Web API/login/lyrics are excluded by decision 12.

The macOS stub uses the recovered generic unavailable hint. The recovered
MediaRemote-specific hint promises fallback controls, which the stub cannot
provide, so showing that text would be misleading.

## Verification

Tests use recording fakes and Effect TestClock. No live HTTP, OS media calls,
HID or local servers are used. Run all six lane gates from the repo root,
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
Real QUAKE touch/rendering, macOS MediaRemote and Windows SMTC remain unverified.
