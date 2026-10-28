## Implementation, open-quake-ekc

- [x] 1.1 Update all eight locale labels and generic runtime copy, including catalog and templates, preserving identifiers.
- [x] 1.2 Preserve localized persisted built-in defaults and explicit custom names, with regression tests for rendered copy and saved data.
- [x] 1.3 Pass desktop typecheck/tests, device tests and root lint, then commit/push ui/agent-naming and open a main PR with a before/after table.

Verification: desktop typecheck passed; desktop Vitest 3707 passed and 1 existing skip with maxWorkers=2; device Vitest 722 passed; root lint zero errors with 20 warnings and 3 informational diagnostics; strict OpenSpec validation passed. All test commands used TMPDIR=/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/oq-tmp. The initial broad run had two stale template assertions, now updated, and one unchanged chat transport timeout. The focused transport rerun and complete two-worker suite passed. The final assignment-hint wording also passed the focused copy/Agents tests. Desktop, Electron, native acceptance and hardware were not launched. PR delivery is recorded on bead open-quake-ekc.
