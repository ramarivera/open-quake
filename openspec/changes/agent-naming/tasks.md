## Implementation, open-quake-ekc

- [x] 1.1 Update all eight locale labels and generic runtime copy, including catalog and templates, preserving identifiers.
- [x] 1.2 Preserve localized persisted built-in defaults and explicit custom names, with regression tests for rendered copy and saved data.
- [x] 1.3 Pass desktop typecheck/tests, device tests and root lint, then commit/push ui/agent-naming and open a main PR with a before/after table.

Verification: desktop typecheck passed; desktop Vitest 3707 passed and 1 existing skip with maxWorkers=2; device Vitest 722 passed; root lint zero errors with 20 warnings and 3 informational diagnostics; strict OpenSpec validation passed. All test commands used TMPDIR=/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/oq-tmp. The initial broad run had two stale template assertions, now updated, and one unchanged chat transport timeout. The focused transport rerun and complete two-worker suite passed. The final assignment-hint wording also passed the focused copy/Agents tests. Desktop, Electron, native acceptance and hardware were not launched. PR delivery is recorded on bead open-quake-ekc.

## Remaining source-language UI, open-quake-l86.36

- [x] 2.1 Resolve fresh and persisted built-in Agent key names through the selected locale, preserving custom names and saved action payloads.
- [x] 2.2 Use English prompt-library fallback for locales without a translated catalog, including regional English, while retaining explicitly selected Chinese.
- [ ] 2.3 Verify actual rendered strip and management labels plus focused regressions, types and lint; commit, push, review once, merge and update the owner app.

Localization verification: device catalog/editing 41 tests, prompt catalog 2 tests and actual strip rendering 29 tests pass. All six typechecks pass. Production build and hidden native profiles smoke pass, including an assertion and inspected capture of all four English Agent names. Native evidence: `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake/localization-fix/native/agent-english.png`. Native smoke needed Koffi kept external, matching the production build. Source-language user titles, configured actions, selected Chinese/Japanese defaults and locale dictionaries remain intact. Delivery remains pending task 2.3.

PR158 single review round: retain English-only default detection for non-Agent keys to preserve unmarked custom titles such as Discord "Stumm". The new Agent-specific resolver still handles known eight-locale defaults. Regression and device typecheck pass. No rereview requested; later findings move to the next PR.
