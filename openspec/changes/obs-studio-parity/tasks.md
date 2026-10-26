## 1. Evidence and contracts

- [x] 1.1 Record the recovered 21 ids, parameters and audit rows; validate the OpenSpec change and create matching beads.
- [x] 1.2 Add typed command contracts and the 21 entries to the existing key-function registry.

## 2. Runtime and desktop

- [x] 2.1 Implement protected connection repository, v5 transport, Effect service, local detection and reconnect/auth failure handling.
- [x] 2.2 Wire committed key dispatch and focused knob volume through existing action paths.
- [x] 2.3 Add connection/target editing and visible status, stats and screenshot tiles with 2000 ms polling and teardown.

## 3. Verification and delivery

- [x] 3.1 Test commands with an in-process fake server, refresh with TestClock, reconnect/auth failure, privacy and consumer wiring.
- [x] 3.2 Run all lane gates and hidden mock native smoke, record evidence, commit, push and open a PR against main without merging or resolving review threads.

## 4. PR80 review fixes

- [x] 4.1 Reconnect after explicit Auto-fetch, preserving startup/manual-disconnect policy; regression for thread 4375829071. Bead open-quake-lih.18.1.9.
- [x] 4.2 Include recovered audio/media-capable input kinds in target editors; regressions for threads 4375829250 and 4375833109. Bead open-quake-lih.18.1.10.
- [x] 4.3 Authorize panel screenshots against committed active keys, revoke stale leases and retry after Save; regressions for thread 4375829386. Bead open-quake-lih.18.1.11.
- [x] 4.4 Preserve stale scene targets as unavailable, retain replacement choices and reject missing-scene dispatch; regressions for thread 4375833113. Bead open-quake-lih.18.1.12.

- [x] 4.5 Honor OBS SessionInvalidated close code 4011 until explicit reconnect; regression for thread 4376190765. Bead open-quake-lih.18.1.13.

## 5. Final PR80 integration

- [x] 5.1 Merge current main while preserving OBS and per-profile clock/model behavior, explicitly invalidate and reload the editor catalog after reconnect, add a mounted regression for thread 4376364138, handle other unanswered bot feedback, and run all gates. Bead open-quake-lih.18.1.14.
- [x] 5.2 Clear source choices immediately when changing scenes and cover a delayed catalog reload for thread 4376500025. Bead open-quake-lih.18.1.15.
- [x] 5.3 Subscribe read-only editor previews to live OBS data without enabling input actions for thread 4376500032. Bead open-quake-lih.18.1.16.

## 6. Native smoke regression after knob editor integration

- [x] 6.1 Fix the native smoke's selected-key Save selector after the knob editor added an earlier primary button. Assert committed screenshot and volume settings rather than draft reads, reproduce failure before the fix, and run the full smoke plus all gates. Beads open-quake-4e1 and open-quake-c5w.16.1.

First-parent bisect identified main merge `95f6a69` as the first bad revision; `4b2e537` passed the full OBS smoke. The knob editor introduced an earlier primary Save button, so the smoke clicked disabled Save knob. The draft read hid the missed commit. OBS correctly rejected the panel's uncommitted scene. The smoke now targets the selected key's group, checks committed settings, and waits for save/catalog readiness. The committed-scene assertion failed before the selector fix. Full hidden mock native smoke, 3126 tests with four existing skips, six package typechecks, Biome with no errors and 14 existing warnings, build, and strict OpenSpec validation passed. Logs and panel captures remain outside git under `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/media-smoke-fix/`.
