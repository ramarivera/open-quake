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

- [ ] 4.5 Honor OBS SessionInvalidated close code 4011 until explicit reconnect; regression for thread 4376190765. Bead open-quake-lih.18.1.13.
