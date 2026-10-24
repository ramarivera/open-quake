# Verification and handoff

Validated 2026-10-24 in `/Volumes/ExtSSD/devplane/oq-strip-touch` on
`lane/strip-touch`, started at main commit `322db542bd07d9da4aff4ecdde4f78181a140f6d`.
Integrated main `dbc35c31b70dafccfa6f3e2883b1ebd506402103` after PR creation,
preserving the management redesign and touch mount through an import conflict.
All gates below were rerun on that merged tree.
No hardware was opened and DK-Suite was not started.

## Gates

All required gates passed:

- `pnpm biome check packages apps`
- `pnpm typecheck`
- `pnpm test`: 553 tests, including 317 device, 184 desktop, 27 edge and 25 protocol.
- `pnpm build`
- `pnpm --filter @open-quake/desktop test:bundle`: default HID tested through
  substituted I/O; built mock mode resolved/enumerated no native HID.
- `openspec validate --all --strict`: 29 changes passed.
- Native smoke from `apps/desktop/src/main/media/README.md`, run with
  `OPEN_QUAKE_MOCK_DEVICE=1`, `env -u ELECTRON_RUN_AS_NODE` and scratch TMPDIR.
  The production preload and mounted panel emitted one key down and one up from
  raw synthetic vendor frames. Media checks and runtime disposal also passed.

Logs and screenshots are local-only in
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/strip-touch/`:
`biome.log`, `typecheck.log`, `test.log`, `build.log`, `bundle.log`, `openspec.log`,
`native-smoke.log`, `panel.png`, `management.png`, `management-narrow.png`.
The screenshots check renderer regression; the smoke assertions prove input flow.
They do not establish physical panel behavior.

## Audit coverage

- MAIN-002, 035–040: collection identity, raw parsing, presence tracking, idle
  lift, scoped binding/recovery and panel-only delivery.
- MAIN-041: generation-cancelled lock/wake recovery API, tested through injected
  transport. OS event hookup is available to the device lifecycle owner through
  `connection.touch`; it is not asserted by the native smoke.
- SCREEN-005, 053–055, 057–058: source-derived orientation, first-contact policy,
  overlay capture and ordinary-key down/up arbitration.
- SCREEN-056: the mounted panel uses strip-grid geometry.tileAt and the current
  rendered layout. Grid owns covered cells, spans, gaps and touch flags.
- SCREEN-061–065, AI-206: sub-target dispatch, deferred tap/scroll handoff,
  stale-bound repair/rescan, portrait bounds and minimum 44×44 targets.
- SCREEN-066–068, AI-163: reusable recognizer, monitor inertia/rubber band and
  distinct chat fast-flick physics with unit/property tests. Widget adoption and
  visual scrolling are left to their owning lanes.

SCREEN-059/AI-205 voice hold timing and action execution are separate-lane work.
This change exposes idle-lift suppression for capture; it does not claim those
voice interactions are wired.

## Reverse-engineering findings

`background.js` accepts A3 at byte 0 and 1A at byte 3. Count is byte 4, followed
by five bytes per contact: raw action, yLo, yHi, xLo, xHi. The touch parser checks
no checksum, and bytes 1/2 are not interpreted. The renderer forwards only the
first contact in all phases.

The tracker ignores raw action bytes and marks all reported contacts active.
Missing points and the 100 ms inactivity timer generate releases. Timeout in the
source leaves stale last-frame entries behind; this implementation clears them
to avoid reviving released IDs. The source also compares the chat slow-release
cutoff using 3.5×2.2, which drifts above 7.7 in JavaScript; this implementation
uses the documented exact 7.7 threshold.

All findings are from static source, not captured frames. Physical report size,
optional report ID, padding, actual action meaning, coordinate range/orientation,
real reconnect behavior and voice capture release remain unverified. The guarded
lead-only probe was written but never executed.

## Beads

Epic `open-quake-lih.3.1` is a child of cluster `open-quake-lih.3`.
Task mapping: 1.1 → `.3.1.1`, 1.2 → `.3.1.2`, 2.1 → `.3.1.3`,
2.2 → `.3.1.4`, 3.1 → `.3.1.5`, 3.2 → `.3.1.6` under prefix `open-quake-lih`.
The six original task beads are closed. Review-round tasks 4.1–4.5 map to
`.3.1.7` through `.3.1.11`. All eleven task beads and the epic are closed with source and verification
evidence. The parent cluster remains open per the lead until PR #20 merges.
PR: https://github.com/ramarivera/open-quake/pull/20 against main.
Implementation commit: `3629150`; delivery metadata is recorded in a follow-up
commit. The branch is pushed, the PR is linked to the T3 thread and remains
unmerged. Hardware limitations above are retained in the closure evidence.


## PR #20 review-fix round 1

Merged main `2ac4a2ff3867e0fd5bc1e9c878278bf8af9b9753`, including PR #23's
strip grid. Both README sections and both native smoke suites are preserved.
`main/index.ts` retains profile registration and panel-only touch forwarding.
`StripPanel` now binds input to the layout actually painted by `StripScreen`,
using `geometry.tileAt`. DOM rectangles locate only sub-targets. Held keys drive
strip press feedback.

All three connector findings were verified against code and accepted:

- Native open is now acquired with `Effect.acquireRelease`, whose acquisition
  is uninterruptible. Fake promise tests prove late handles close once after
  teardown, lock and wake, without subscribing to reports, writing or reopening.
  The tests failed on the previous code with zero closes in all three cases.
- Child and sub-target attribute mutations invalidate membership. The next
  eligible local rescan runs before accepting a known scroller hit. Unit tests
  preserve the 500 ms throttle and transient-empty behavior; the native smoke
  adds a clickable inside an already registered scroller and observes its tap.
- Axis locking preserves the initial velocity sample. `(0,0)@0ms` followed by
  `(30,0)@100ms` yields `30/101` px/ms on release at 101 ms and `0.3` at 100 ms.
  This intentionally corrects the recovered `shared/gesture/recognizer.js`
  timestamp reassignment instead of reproducing that source bug.

All six lane gates pass on the integrated code: Biome checks 229 files;
typecheck succeeds for all six packages; 605 tests pass (322 device, 231 desktop,
27 edge, 25 protocol); production build and both bundle modes pass; strict
OpenSpec validation passes all 30 changes. The native mock smoke passes media,
profile rendering, real preload/IPC, ordinary-key down/up, press feedback, inert
gaps, a live profile switch to an inward-growing span, dynamic sub-target
membership and runtime disposal.

Evidence is local-only under
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/strip-touch/review-round-1/`:
`biome.log`, `typecheck.log`, `tests.log`, `build.log`, `bundle.log`,
`openspec.log`, `native-build.log`, `native-smoke.log`, `panel.png`,
`panel-{quick,meetai,spans,clock,vivid}.png`, `management*.png` and
`panel-touch-complete.png`. The final touch screenshot includes the smoke-only
injected scroller and button. The initial smoke attempt captured a screenshot
inside the gesture, exceeding the valid 100 ms inactivity deadline; moving
capture after the gesture removed that test timing error. Production timings
were unchanged.

Native smoke ran with `OPEN_QUAKE_MOCK_DEVICE=1`, `env -u ELECTRON_RUN_AS_NODE`
and scratch `TMPDIR`. No hardware or probe was opened and DK-Suite was never
started. All started Electron processes exited. Physical behavior remains
unverified. There were no disagreements with the three review findings.


Review fixes and the main merge were pushed in conventional merge commit
`77c9f831aa43cc7de03bf60fa2e58bf371ea5903`. Normal commit and pre-push hooks
passed without bypass. The lane helper replied to and resolved exactly the
three verified connector threads, naming that fix commit. A GraphQL read
confirmed all three resolved and the PR still open. The PR description now
reflects real geometry integration, the regressions and current gate results.
This metadata-only follow-up closes task 4.5; it does not alter tested code.
