# Design

## Context

See proposal.md. PR #25 provides ReactNode slots and typed weather/music view props in `strip/tiles/clock/clockCards.ts`. The strip registry currently handles only the clock. Existing Electron bridges use shared Schema commands, exact-document/top-frame authorization and main-owned runtimes.

Research is local-only at `~/dev/dark-encyclopedia/dk-suite-introspeccion/v0.4.95/`: AUDIT_WIDGETS rows 040..055/111..118, AUDIT_KNOB rows 088..099; ClockWeatherDisplay.vue, DkMusicCard.vue, AudioPlayerView.vue and MusicGuideToast.vue; background.js WeatherService at 1322786 and mac bridge at 1759558. The mac bridge launches Perl plus MediaRemoteAdapter.framework. Neither that helper nor a nowplaying CLI exists here. Native implementation stops at an explicit adapter stub as permitted by the lane request. Options for later approval are a reviewed vendored helper or an external CLI dependency.

## Goals / Non-Goals

Implement weather, shared media orchestration and both renderers without native or npm additions. Do not implement local soundboard ownership, volume arbitration, Spotify Web API, real hardware validation or an unapproved native bridge.

## Decisions

- A shared weather-media Schema defines settings, snapshots, expected failure results and commands. Keep renderable unavailable outcomes in the success channel; use catalog TaggedErrors for actual network, decoding and persistence failures.
- WeatherNetwork is an injected IO interface; production uses bounded main-process fetch with redirect rejection, fixed public default endpoints and abort signals. Tests install a recording fake. WeatherService owns validated geocoding, provider fallback, locale/code mapping and a city/provider/locale cache in Celsius. Unit conversion is a pure final projection. Never send automatic location requests without persisted opt-in.
- A main-owned settings repository serializes atomic writes. It stores a validated city/location, units, IP consent and card switches under weather-media-v1. Do not rewrite profile keys or the clock store owned by another lane. Document that this is the current global settings bridge until per-profile editors own these fields.
- A shared media conductor serializes transport intents and reads from an injected SystemMedia adapter. Its production platform factory returns explicit unavailable adapters. Tests exercise the real conductor with a mutable fake. Renderer state is subscription-first, revision-guarded and shared across cards; no renderer calls native APIs.
- Refresh scheduling lives at visible renderer subscription edges, with the main cache deduplicating fetches. Native smoke loads the built renderer and production preload with fake main adapters, then captures actual hidden Electron windows. It does not use a development server.
- Render the turntable using repository-native SVG/CSS rather than copying vendor binary artwork. Preserve measured positions, palette, typography, timing and control states. Titles use measured truncation and luminance-aware cover text. The knob owner can insert its overlay via a ReactNode prop; no volume controller is added here.

## Risks / Trade-offs

- Native system-media integration remains unavailable on macOS/Windows. Ramiro approved the separate reviewed MediaRemote helper follow-up in open-quake-lih.7.1.6. Keep that task open and show unavailable UI until implementation and qualification; mock screenshots are presentation evidence only.
- Forecast providers change schemas. Decode strictly enough to reject malformed temperatures/codes and fall back rather than invent values.
- IP location discloses the public IP to a third party. Require opt-in and name the recipients in the UI; empty manual city never means consent.
- Weather and media preferences are currently global. Use an independent versioned file to avoid rewriting another lane's profiles or clock store.

## Migration Plan

Absent settings load disabled weather/music and no consent. Validated settings persist atomically; write failure leaves the last committed state. Removing the new settings file rolls back to safe defaults. No native dependencies or hardware state need migration.
