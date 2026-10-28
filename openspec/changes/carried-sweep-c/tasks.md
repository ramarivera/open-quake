## 1. Carried bug fixes
- [x] 1.1 Fix weather empty/failure/reconfiguration rendering with regression tests. Bead open-quake-ugb.
- [x] 1.2 Validate local agent executable paths with regression tests. Bead open-quake-ffm.
- [x] 1.3 Label CPU fallback hardware accurately with regression tests. Bead open-quake-7dj.
- [x] 1.4 Cancel DOM gestures on vendor takeover with regression tests. Bead open-quake-l86.22.
- [x] 1.5 Bound Windows installer waiting/retries with regression tests. Bead open-quake-eeu.
- [x] 1.6 Run desktop typecheck/tests, root lint and isolated management exerciser; document limits, commit, push and open a PR.

## Verification evidence
- Desktop typecheck passed. Full desktop suite passed 3742 tests with 1 existing skip using four workers. Initial default-worker run had one 5s timeout in unchanged profile-controller tests; isolated 16/16 and final full run passed.
- Release tests passed 26/26, including installer wait, recovery and failure propagation. Root lint passed with 20 existing warnings and 3 infos. Strict OpenSpec and script syntax checks passed. Device packages, dependencies and CI workflow files are unchanged.
- Full management main/branch runs visited 13/13 pages with zero uncaught errors. Main had 17 failures, branch 15. The wide-key selector failure reproduced on the unchanged baseline build replay; the other branch-only record was the explicitly known intermittent profiles Duplicate control. Remaining failures match main, including swap, obstructed controls, duplicate titles and revision conflicts. The exerciser therefore exits nonzero on both revisions.
- Reports: /Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-ui-exerciser/run-jZxTDz/report.json and /Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-ui-exerciser/run-B7wEXb/report.json. Replay evidence and test logs: /Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake/carried-sweep-c/.
- Native Windows arm64 install is unverified locally; CI owns native execution. No owner application, real QUAKE, foreground focus or physical cursor use.
