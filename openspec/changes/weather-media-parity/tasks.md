# Tasks

Each numbered task has a child bead under `open-quake-lih.7.1` referencing this path.

## 1. Weather and contracts

- [x] 1.1 Add shared Schemas, catalog errors, bounded network adapter, geocoding/provider fallback/cache/units and tests proving consent, failed providers, stale cache and location invalidation (WIDGETS-040..052).
- [x] 1.2 Add atomic settings persistence, authorized IPC/preload, visible refresh scheduling and city verification settings with tests for write failure, late queries, timer cleanup and no live requests (WIDGETS-045..052).

## 2. Media and presentation

- [x] 2.1 Add shared media conductor, serialized intent controls and explicit macOS/Windows/other-platform stubs; test real conductor consumers with fake sessions and document native approval options (WIDGETS-054/111/113/117, KNOB-096/098).
- [x] 2.2 Fill clock cards and implement system-mode DK-Player states, effective sub-touch controls, needle/title/cover/source/guide and knob overlay contract; verify state/timing tests and native mock captures (WIDGETS-040/041/048/049/053..055/112/114/118, KNOB-088/089/091..095/097..099).

## 3. Acceptance

- [x] 3.1 Run all six lane gates and native mock smokes, inspect screenshots, save lane report and open a PR with audit coverage, exact head and unverified native/hardware items.
- [ ] 3.2 Separate follow-up approved by Ramiro: vendor a reviewed macOS MediaRemote helper, implement and qualify real read/control, then verify on host media sessions. Windows SMTC also remains unimplemented behind its platform check. This task stays open after this PR's spec + stub delivery.

## 4. Review fixes

- [x] 4.1 Address PR #29 round 1's nine threads with regressions for expiry-relative refresh, portable fixtures and smoke artifacts, IP coordinates, Japanese and UK city lookup, outage text and debounced city persistence. Revalidate all six gates and both native mock smokes, push fixes and reply with attribution before resolving. Bead: `open-quake-lih.7.1.7`.

## Verification evidence

All six lane gates passed on 2026-10-24. Root tests report 907 passing tests, including 445 desktop tests. Focused weather/media tests cover real conductors with injected IO, Effect TestClock cache/deadline behavior, city sequencing, rejected writes, controls, schemas and renderer state. Both native Electron mock smokes passed with production preload/IPC/renderers and no local server or device access. Captures include the clock with both cards, city verification and IP consent, and DK-Player playing, paused, idle/guide, unavailable, navigation-disabled, pause-disabled and unknown-duration states. The existing media smoke also covers narrow layout, light theme, reduced motion and strip touch routing.

Logs, inspected captures and the lane report live under `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/weather-media/`. Native MediaRemote/SMTC, provider availability on the live network and real QUAKE rendering/touch remain unverified. Task 3.2 and its parent epic stay open.

PR: https://github.com/ramarivera/open-quake/pull/29. Implementation evidence is commit `6176f0d42dc75aeccb03d67376d2066ec0bc8c29`; the final head is recorded in the lane report after the acceptance bookkeeping commit.

Main integration: merged `cef6ee0` and then `19d7240` from origin/main, preserving lifecycle, knob and profile-manager registration/disposal, then reran all six gates and both native smokes. The focused smoke registers those boundaries with fake volume and display IO. Strict OpenSpec validation now covers 35 items.

Round 1 verification: all six gates passed again on 2026-10-24, with 922 tests across 92 files, including 460 desktop tests and 46 focused weather/media tests. The new refresh regression drives the real service with a delayed forecast and a cache hit 51 ms before expiry. Both native mock smokes passed; the focused smoke used a relative artifacts argument, exercised rapid city prefixes through the actual settings UI, and captured a provider outage. Screenshots were inspected and lane-owned processes exited. Logs and captures use the `round1-` prefix in the lane scratch folder. No dependency was added. A fresh fetch confirmed origin/main `19d7240` is already included. Fix commit `fda5e4b428f88af535d206395ab3f2f7e557bfb9` was pushed, and all nine review threads received an attributed reply before resolution. Native task 3.2 and the parent epic/cluster remain open.
