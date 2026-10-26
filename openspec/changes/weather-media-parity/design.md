# Design

## Context

See proposal.md. PR #25 provides ReactNode slots and typed weather/music view props in `strip/tiles/clock/clockCards.ts`. The strip registry currently handles only the clock. Existing Electron bridges use shared Schema commands, exact-document/top-frame authorization and main-owned runtimes.

Research is local-only at `~/dev/dark-encyclopedia/dk-suite-introspeccion/v0.4.95/`: AUDIT_WIDGETS rows 040..055/111..118, AUDIT_KNOB rows 088..099; ClockWeatherDisplay.vue, DkMusicCard.vue, AudioPlayerView.vue and MusicGuideToast.vue; background.js WeatherService at 1322786 and mac bridge at 1759558. The mac bridge launches Perl plus MediaRemoteAdapter.framework. Neither that helper nor a nowplaying CLI exists here. Native implementation stops at an explicit adapter stub as permitted by the lane request. Options for later approval are a reviewed vendored helper or an external CLI dependency.

## Goals / Non-Goals

Implement weather, shared media orchestration and both renderers without npm additions. The approved native follow-up below supersedes the original stub-only restriction. Do not implement local soundboard ownership, volume arbitration, Spotify Web API, real hardware validation or an unapproved native bridge.

## Decisions

- A shared weather-media Schema defines settings, snapshots, expected failure results and commands. Keep renderable unavailable outcomes in the success channel; use catalog TaggedErrors for actual network, decoding and persistence failures.
- WeatherNetwork is an injected IO interface; production uses bounded main-process fetch with redirect rejection, fixed public default endpoints and abort signals. Tests install a recording fake. WeatherService owns validated geocoding, provider fallback, locale/code mapping and a city/provider/locale cache in Celsius. Unit conversion is a pure final projection. Never send automatic location requests without persisted opt-in.
- A main-owned settings repository retains the global weather-media-v1 compatibility settings. Clock keys own their weather action and clockStyle.musicEnabled in the canonical profile repository. Explicit decoded settings on weather/cache requests avoid mutating global preferences. Cache entries are bounded to 128 instance/side scopes and retain canonical Celsius; read performs no HTTP, clear removes only its scope, and refreshRevision broadcasts reschedule mounted live cards with their own settings.
- A shared media conductor serializes transport intents and reads from an injected SystemMedia adapter. Its production platform factory uses the approved native adapters below, with explicit unavailable adapters for mocks and unsupported hosts. Tests exercise the real conductor with a mutable fake. Renderer state is subscription-first, revision-guarded and shared across cards; no renderer calls native APIs.
- Refresh scheduling lives at visible renderer subscription edges, with the main cache deduplicating fetches. Ready replies return the remaining cache lifetime; each load schedules its successor after completion, including an early cache hit. City edits clear the saved coordinates immediately, but the latest city and its verification result persist together after 600 ms idle and verification. IP providers must supply bounded coordinates, which both forecast providers use directly; an ambiguous IP city name never triggers worldwide geocoding. Japanese queries retain their locale, explicit countries override the Chinese-country hint, and UK matches GB without dropping the country constraint. Native smoke loads the built renderer and production preload with fake main adapters, then captures actual hidden Electron windows. It accepts a portable artifacts directory and does not use a development server.
- Render the turntable using repository-native SVG/CSS rather than copying vendor binary artwork. Preserve measured positions, palette, typography, timing and control states. Titles use measured truncation and luminance-aware cover text. The knob owner can insert its overlay via a ReactNode prop; no volume controller is added here.

## Risks / Trade-offs

- The original PR delivered unavailable macOS/Windows adapters. The approved follow-up below replaces them; keep native acceptance distinctions explicit and show unavailable UI when native dependencies are absent. Mock screenshots are presentation evidence only.
- Forecast providers change schemas. Decode strictly enough to reject malformed temperatures/codes and fall back rather than invent values.
- IP location discloses the public IP to a third party. Require opt-in and name the recipients in the UI; empty manual city never means consent.
- Global weather/media preferences remain compatible with older consumers. Per-key clock preferences use profile revisions and preserve unrelated metadata; rapid editor patches serialize against the latest successful reply.

## Migration Plan

Absent global settings load disabled weather/music and no consent. First-install clock catalog actions explicitly enable both cards with empty city and IP consent off; missing per-key weather fields backfill without replacing valid saved values. Validated settings persist atomically; write failure leaves the last committed state. Removing the new settings file rolls back to safe defaults. No native dependencies or hardware state need migration.

## Approved native follow-up, 2026-10-25

Task 3.2 now implements the approved helper using BSD-3-Clause mediaremote-adapter
source pinned to 0e82bf1, compiled locally for Apple Silicon and shipped as
resources with its license. No downloaded executable or new npm dependency.
Expose only native enabled commands; pin the observed source before control,
bound process runtime/output, validate metadata and native-decode bounded covers.
Windows uses fixed PowerShell WinRT SMTC with the same source guard and explicit
capabilities. Linux retains UNSUPPORTED_PLATFORM until a qualified owner exists.
Mock-device roots retain zero native IO unless an explicit adapter is injected.
The shared service owns serialization for cards and committed media-action keys;
errors preserve private causes and named spans before projecting stable UI states.
No renderer trace ids, native paths, titles, artists or artwork enter diagnostics.
