# Tasks

Parent-owned Beads should mirror one epic and one issue per checkbox in this directory. L1 owns codecs and transport; this change consumes them. Hardware-only tasks remain unverified until actual evidence is attached.

## 1. First-release display and wallpaper contracts

- [ ] 1.1 Record Ramiro's decisions on serial-scoped settings, static image/clock release scope, resource bounds, and open question 6's proof gate; verify the record distinguishes desktop rendering from A2 hardware acceptance.
- [ ] 1.2 Add display/media/resource-request Schemas and pure fill/interval invariants in packages/device; verify every wallpaper field, unit conversion, invalid mode/duration, and unsupported target has acceptance/rejection fixtures.
- [ ] 1.3 Add the serial-scoped desktop media repository and image decoder/asset-reference adapter; verify local JPEG/PNG acceptance, missing/decode-failed assets, backup/rollback, and independence between two serials; document the media schema.
- [ ] 1.4 Add shared static wallpaper rendering on the existing 1920x480 panel and management preview; verify contain/cover/center geometry, neutral fallback, theme/reduced-motion compatibility, and that render success does not mark device delivery applied.
- [ ] 1.5 Add the dkDesktopClock registry entry and shared injected-clock renderer; verify midnight/noon, 12h/24h, one-second updates, and matching preview/panel snapshots without a new firmware event.

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
