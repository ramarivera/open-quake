# Tasks

Parent-owned Beads should mirror one epic and one issue per checkbox in this directory. L1 owns codecs and transport; this change consumes them. Hardware-only tasks remain unverified until actual evidence is attached.

## 1. First-release display and wallpaper contracts

- [x] 1.1 Record Ramiro's decisions on serial-scoped settings, static image/clock release scope, resource bounds, and open question 6's proof gate; verify the record distinguishes desktop rendering from A2 hardware acceptance.
- [x] 1.2 Add display/media/resource-request Schemas and pure fill/interval invariants in packages/device; verify every wallpaper field, unit conversion, invalid mode/duration, and unsupported target has acceptance/rejection fixtures.
- [x] 1.3 Add the serial-scoped desktop media repository and image decoder/asset-reference adapter; verify local JPEG/PNG acceptance, missing/decode-failed assets, backup/rollback, and independence between two serials; document the media schema.
- [x] 1.4 Add shared static wallpaper rendering on the existing 1920x480 panel and management preview; verify contain/cover/center geometry, neutral fallback, theme/reduced-motion compatibility, and that render success does not mark device delivery applied.
- [x] 1.5 Add the dkDesktopClock registry entry and shared injected-clock renderer; verify midnight/noon, 12h/24h, one-second updates, and matching preview/panel snapshots without a new firmware event.

## 2. First-release resource coordination and hardware gate

- [ ] 2.1 Agree the typed resource target/capability/completion contract with L1 and cite its encoding fixtures; verify unknown full-panel targets reject without bytes and no guessed wallpaper key code enters this change.
- [ ] 2.2 Add resource coordinator state, bounded buffers, revision/session cancellation, and distinct catalog errors; verify two consecutive images, corrupt/oversized data, interrupted transfer, and stale chunks through the real SDK adapter consumer.
- [ ] 2.3 Add typed IPC updates and management status for local saved/rendered/pending/sent/verified results; verify disconnect leaves the local wallpaper intact and never reports hardware-applied from preview alone; document status semantics.
- [ ] 2.4 On available hardware, qualify keyed JPEG icon delivery with a labeled checkerboard and a second image; verify recorded firmware, asset hash/encoding/dimensions, target mapping, L1 fixture, chunk order/limits, timing/responses, and visible results.
- [ ] 2.5 Independently qualify the actual full-panel wallpaper target/path and interruption/reconnect on hardware; verify the same evidence set and keep first-release A2 wallpaper unresolved if only renderer or keyed-icon success exists, recording any scope revision from Ramiro.

## 3. Later playlists and overlays

- [ ] 3.1 Add transparency, multiple images, decodable videos, sequential/random playback, and cleanup; verify 2-second video minimum, singleton behavior, no immediate random repeat when alternatives exist, timer/media disposal, and reduced motion; document codec limits.
- [ ] 3.2 Add targeted overlay schemas and display-state reducers for countdown, alert, and progress; verify stale revision rejection, countdown zero/clear/restart, 2-second invalid alerts, 5-second intermediate progress, 1-second completion, and cancelled stale expiries with a controlled clock.
- [ ] 3.3 Connect timer and available meeting/audio/AI runtime events through the shared renderer without intercepting touch input; verify activation identity deduplication, absent-runtime behavior, and cleanup on profile/window changes; document event ownership.

## 4. Later binding and integration close-out

- [ ] 4.1 Implement confirmed serial-to-display binding after multi-display behavior is approved; verify unplug produces unbound state and never silently captures another monitor, and document recovery.
- [ ] 4.2 Investigate any requested legacy socket/binding compatibility before adding it; verify recovered localhost endpoint/server behavior and keep LAN control/arbitrary app mirroring unavailable without a separately approved contract.
- [ ] 4.3 Run desktop end-to-end display scenarios, OpenSpec validation, and repository gates; verify recorded evidence separates mock/renderer tests from real resource delivery and attach remaining hardware gaps to open issues.

## 5. Cluster 18 wallpaper behavior

- [x] 5.1 Add backward-compatible sound and ordered managed media persistence, video metadata validation, per-item removal, deduplication and validated reorder; test reload, stale revisions and per-serial isolation (`WIDGETS-128/130`, open-quake-lih.19.1).
- [x] 5.2 Add drag and keyboard reorder controls plus Wallpaper sound on/off; render ordered looping media with muted management previews and clean lifecycle; test reducer and renderer interactions (`WIDGETS-128/130`, open-quake-lih.19.3).
- [x] 5.3 Run all lane gates and silent mock native smoke; save screenshots externally, record hardware and audible-output limits (`WIDGETS-128/130`, open-quake-lih.19.4).


## Cluster 18 verification, 2026-10-26

Before this change, main had the static managed image repository, shared vivid
canvas and clock, but no playlist editor or wallpaper sound. Cluster 18 extends
those owners with append/deduplication, revision-checked reorder/removal and
backward-compatible enableSound persistence. Main broadcasts active selection;
previews stay muted and panel sound uses the existing canonical AudioOutput.

The full lane gates pass. The suite passes 2,890 tests with four existing skips
using `TURBO_ENV_MODE=loose TMPDIR=<lane scratch> pnpm test -- --maxWorkers=2`.
The limit avoids existing profile tests exceeding their unchanged five-second
timeout under full host concurrency. Scratch TMPDIR preserves filesystem safety
checks on macOS. Typecheck passes six packages, build passes, both bundle-smoke
modes pass, Biome checks 1,156 files with zero errors and 14 existing warnings,
and strict OpenSpec validation passes all 46 items.

Hidden mock Electron exercises actual PNG/JPEG and silent WebM import, metadata,
video playback and singleton looping, move buttons, drag reorder, persisted order,
sound on/off, preview muting, light/reduced-motion/narrow layout and shutdown.
All windows stay globally muted. Eighteen screenshots and logs live under
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/wallpaper-soundboard/`.
The desktop playlist, narrow playlist and native video images were inspected.
All owned smoke processes exited. Native callback and pending-audio cancellation
regressions are covered by tests.

Coverage is WIDGETS-128 sound/order/deduplication/removal and WIDGETS-130 active
video sound eligibility/singleton looping. Other portions of those broad rows,
including crossfade/preload geometry, remain outside this lane. Physical sound,
QUAKE delivery, display binding and the full codec matrix remain unverified.

## PR79 review fixes

- [x] 5.3 Schedule playlist transitions at real deadlines independently of display-clock ticks, preserving elapsed time; prove two 2500 ms videos switch at 2.5 s and 5 s with TestClock. Evidence: WIDGETS-128/130; open-quake-lih.19.7.

Review-fix verification: all six new cases fail against PR79 head `95a6844`
and pass with these fixes. Full gates pass with 2,896 tests and four existing
skips, six package typechecks, production build, both bundle modes, Biome
1,158 files with zero errors and 14 existing warnings, and 46 strict OpenSpec
items. External logs, including `regressions-final-before.log`, stay under
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/wallpaper-soundboard/fix1/`.
No renderer UI changes, real QUAKE access, DK-Suite execution or audible playback.

## PR79 round 2

- [x] 5.4 Restart renderer playback whenever the playlist clock resets, including singleton append. Evidence: WIDGETS-130; open-quake-lih.19.8, review 4375809611.
- [x] 5.5 Revoke wallpaper audio on panel hide and reject hidden acquisitions. Evidence: WIDGETS-130; open-quake-lih.19.8, review 4375809620.
- [x] 5.6 Probe video metadata once per content hash at import/save outside the controller semaphore; retain verified managed-byte reads. Evidence: WIDGETS-128/130; open-quake-lih.19.8, review 4375836049.
- [x] 5.7 Ignore no-op playlist reorder in the editor and controller without revising storage. Evidence: WIDGETS-128; open-quake-lih.19.8, review 4375836057.
- [ ] 5.8 Use media-aware EN/DE labels and the active-item hint; update stored schema and IPC documentation; run six gates and muted mock native smoke with screenshots. Evidence: WIDGETS-128/130; open-quake-lih.19.8, review 4375836089.

Round-2 copy regression coverage now renders the real settings view in EN/DE,
checks Add Media… / Remove All and asserts the hint uses activeIndex.
Both locale cases failed before the copy fix; full gate and native evidence follow.
