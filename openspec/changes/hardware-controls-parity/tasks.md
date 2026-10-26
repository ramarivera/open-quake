## 1. Hardware controls parity

- [x] 1.1 Record source evidence and correct related specs, validate all changes strictly.
- [x] 1.2 Implement typed protocol commands/replies with golden byte and property tests.
- [x] 1.3 Implement scoped hardware controls, keyboard adapter, timing and persistence with mock transport tests.
- [x] 1.4 Wire device settings and OS lock events, verify IPC and native mock UI with screenshots.
- [x] 1.5 Run every lane gate, record reverse-engineering findings and limitations, commit, push and open the PR.

- [x] 1.6 Address PR #22 review round 1, integrate main, prove native-write shutdown and latest preference ordering, preserve slider drags and polling recovery, verify local serial handling, and repeat all gates and native mock smokes.

- [x] 1.7 Merge strip-touch main into PR #22, preserve both integrations and hardware write shutdown, and repeat all six gates and both native mock smokes before committing and pushing.

## 2. Preserve ring state through OS lock

- [x] 2.1 Add the approved knob LED query/reply, read the current ring state before a serialized duplicate-safe lock cycle, restore only a successfully disabled previously-on ring, and verify codec and actual connection consumers. Query failure leaves lighting untouched. Bead: open-quake-da4.10.1.

Source and verification, 2026-10-26: approved Query.knobLed / KnobLedState codecs have golden read bytes and strict boolean/length rejection. Eight new actual QuakeConnection/fake-transport lock regressions fail on the preceding implementation and pass with serialized state capture and one-time restoration. Full device suite 434 tests and protocol suite 63 tests pass; both package typechecks, desktop typecheck/build, scoped Biome and strict validation pass. A real read-only QUAKE query through NodeHidLive returned KnobLedState.on=false with no lighting writes. This qualifies reading only; physical lock/unlock effects were not exercised. Artifacts remain outside git under open-quake-finish/service-graph/knob-*. Reviewed PR delivery remains pending in open-quake-da4.10.1.

PR76 review fix: timer shutdown now settles its pending reply as HardwareUnavailable. Four new regressions close the session during query/disable with external and same-scope callers; the original external cases hang on the preceding source and all pass with this fix. All 438 device tests and device typecheck pass. No HID write behavior changes beyond the already-reviewed lock policy.

## 3. Hardware burn-down lane

- [ ] 3.1 Persist acknowledged mic/luminance separately from session synchronization, and implement bounded arbitrary, long, mark and success tones. Bead open-quake-lih.11.25.
- [ ] 3.2 Register saved hardware controls, hydrate serial state and implement gaming mode consumers. Bead open-quake-lih.11.26.
- [ ] 3.3 Wire QUAKE QMK ownership, origin permission and lighting settings; record ARIS scope limitation. Bead open-quake-lih.11.27.
- [ ] 3.4 Merge current main, run all required gates and mock native EN/DE smoke, push and open a PR. Leave row beads open for lead merge.
