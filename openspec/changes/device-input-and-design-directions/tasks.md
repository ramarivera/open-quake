# Tasks

- [x] 1 Explain the ring and fix Y inversion, unwanted click indicator and visible DK claw branding. Bead open-quake-mr7.1.
- [ ] 2 Produce three materially different directions using the same three scenes and show an interactive comparison. Bead open-quake-mr7.2.
- [x] 3 Add device-screen automated regressions and safe structured Effect/Pino diagnostics, then management coverage. Bead open-quake-mr7.3.
- [ ] 4 Deliver correctness changes after focused checks and one bot addressing round; preserve human redesign selection and physical acceptance limits.

## Implementation evidence

The rotating dial counts raw detents at 15 degrees per tick and expires after four seconds. It doesn't represent a control value. The ordinary panel now omits that dial and raw touch markers; development diagnostics require explicit URL opt-in and use the same coordinate normalization as tile routing. Offline status and actual control/selector feedback remain.

Mounted pointer/vendor tests distinguish the top and bottom rows at supported viewport rotations 0/90 and half scale. Diagnostic marks cover all four vendor rotations. Persisted `DKClaw` displays as Agent in the catalog and mounted management settings without rewriting saved names or IDs.

Focused panel, mounted touch, catalog, locale, manager, key editor, touch controller, selector and strip interaction suites pass. Both owning typechecks pass. The hidden production Electron guided self-test passed with live-input assertions and an inspected frame without diagnostic markers. Synthetic input doesn't establish physical touch accuracy.

Diagnostics reuse the Effect/Pino pipeline with bounded tile/action/outcome fields and existing touch health counters and named runtime spans. The persistence test rejects private serial/text and invalid identities.
