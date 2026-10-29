# Tasks

- [x] 1 Explain the ring and fix Y inversion, unwanted click indicator and visible DK claw branding. Bead open-quake-mr7.1.
- [x] 2 Produce three materially different directions using the same three scenes and show an interactive comparison. Bead open-quake-mr7.2.
- [x] 3 Add device-screen automated regressions and safe structured Effect/Pino diagnostics, then management coverage. Bead open-quake-mr7.3.
- [ ] 4 Deliver correctness changes after focused checks and one bot addressing round; preserve human redesign selection and physical acceptance limits.
- [ ] 5 In the next PR, consider avoiding hidden diagnostic expiry work and adding a dedicated development diagnostic launch control. Bead open-quake-mr7.4. Nonblocking review follow-up, outside PR165.

## Implementation evidence

The rotating dial counts raw detents at 15 degrees per tick and expires after four seconds. It doesn't represent a control value. The ordinary panel now omits that dial and raw touch markers; development diagnostics require explicit URL opt-in and use the same coordinate normalization as tile routing. Offline status and actual control/selector feedback remain.

Mounted pointer/vendor tests distinguish the top and bottom rows at supported viewport rotations 0/90 and half scale. Diagnostic marks cover all four vendor rotations. Persisted `DKClaw` displays as Agent in the catalog and mounted management settings without rewriting saved names or IDs.

Focused panel, mounted touch, catalog, locale, manager, key editor, touch controller, selector and strip interaction suites pass. Both owning typechecks pass. The hidden production Electron guided self-test passed with live-input assertions and an inspected frame without diagnostic markers. Synthetic input doesn't establish physical touch accuracy.

Diagnostics reuse the Effect/Pino pipeline with bounded tile/action/outcome fields and existing touch health counters and named runtime spans. The persistence test rejects private serial/text and invalid identities.

## Proposal milestone

All three independent Opus 5.5 CLIProxyAPI directions are available in the scratch artifact `open-quake/device-input-and-design-directions/comparison.html`. The comparison switches all directions together between home, knob/profile and management editor; individual direction and 1:1 zoom controls are available. Parent previews inspected all three actual HTML artifacts, then checked every shared scene switch and direction filtering in a hidden browser. Proposals remain mockups; human selection is pending.

## Single review round

PR165's original head was reviewed by Codex, Devin and CodeRabbit. Copilot reported an internal review error. Accepted findings move admitted/suppressed input logging into KeyRuntime's actual contact decision and assert both down/up callbacks for pointer and vendor paths. The two informational development/performance suggestions are tracked in open-quake-mr7.4 for the next PR. No rereview requested; later findings carry forward.
