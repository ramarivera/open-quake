## 1. Contracts and evidence

- [x] 1.1 Define source-backed style, preview, metric availability and sampling contracts. Validate all specs before implementation. Bead open-quake-lih.8.1.1.

## 2. Collection and transport

- [x] 2.1 Implement scoped non-overlapping collection, platform adapters, validated persisted settings and selected media transport. Verify failure isolation, stale values, cleanup, revision conflict and permission boundaries. Bead open-quake-lih.8.1.2.

## 3. Consumers

- [x] 3.1 Implement all five source-derived canvases, management draft/Save fixture, backgrounds and disk sub-touch scrolling. Verify missing/no-battery/overflow/reduced motion behavior. Bead open-quake-lih.8.1.3.

## 4. Acceptance

- [x] 4.1 Run scenario tests, all six repository gates, native media smoke and five 1920×480 mock panel screenshots. Record platform/hardware limits and open a PR. Bead open-quake-lih.8.1.4.

Acceptance evidence: [verification.md](verification.md). PR #30 tracks delivery; physical hardware remains unverified.

## 5. Review round 1

- [x] 5.1 Address PR #30's seven review threads with regressions for power source/state, unavailable units, retained failed samples, IPv6 collection, bounded media reads and main-owned IPC permissions. Rerun six gates and both native mock smokes, push, reply with attribution and resolve addressed threads. Bead open-quake-lih.8.1.5.

Cluster open-quake-lih.8 and delivery epic open-quake-lih.8.1 remain open until merge and lead acceptance. Implementation tasks 1.1 through 4.1 retain their completed status and original evidence.

## 6. Physical acceptance

- [ ] 6.1 Verify all five layouts, supported live readouts, display placement/readability and physical disk-list touch scrolling on the real QUAKE. Capture screenshots and obtain confirmation for hands-on gestures. Bead open-quake-lih.8.1.6; shared hardware checklist open-quake-lih.24. Mock screenshots do not close this task.

## 7. monitor-panels burn-down

- [x] 7.1 Per-key visual settings, metric unit controls and conservative SysView migration. Bead open-quake-lih.8.5.
- [x] 7.2 Platform collectors, inert legacy data and bounded freshness. Bead open-quake-lih.8.6.
- [x] 7.3 Independent layouts, provenance, media lifecycle and mounted accessibility coverage. Bead open-quake-lih.8.7.

All burn-down beads remain open for lead merge.

Burn-down implementation evidence: production profile/restart and platform fixtures,
3,228 passing workspace tests with four skips, six typecheck tasks, 47 strict
OpenSpec items, build and both bundle modes. Biome checked 1,253 files with zero
errors and 14 existing warnings. Hidden monitor and media native smokes passed.
Monitor smoke exercises Save/Cancel, per-key units, all eight individual tiles,
all five flat styles and accessibility preferences, media timeout/error/hiding,
and disk sub-touch. Screenshots and logs are external to git under
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/burndown/monitor-panels/`.
Physical acceptance remains task 6.1. Windows/Linux native commands remain
fixture-tested only. All three burn-down beads stay open for lead merge.

## 8. PR #100 review round

- [x] 8.1 Enforce committed selected-key media ownership in main with failing-before IPC regression coverage. Bead open-quake-lih.8.5; review 4378998297.

- [x] 8.2 Preserve upgraded global presentation with idempotent per-key migration and restart regressions. Bead open-quake-lih.8.5; review 4378997492.
