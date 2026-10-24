# Verification and handoff

Validated 2026-10-24 in `/Volumes/ExtSSD/devplane/oq-strip-touch` on
`lane/strip-touch`, based on main commit `322db542bd07d9da4aff4ecdde4f78181a140f6d`.
No hardware was opened and DK-Suite was not started.

## Gates

All required gates passed:

- `pnpm biome check packages apps`
- `pnpm typecheck`
- `pnpm test`: 543 tests, including 317 device, 174 desktop, 27 edge and 25 protocol.
- `pnpm build`
- `pnpm --filter @open-quake/desktop test:bundle`: default HID tested through
  substituted I/O; built mock mode resolved/enumerated no native HID.
- `openspec validate --all --strict`: 28 changes passed.
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
- SCREEN-056: injected resolver contract only. strip-grid owns geometry, covered
  cells, spans and type-specific touch flags.
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
All six task beads, the epic and cluster are closed with source/test evidence.
PR: https://github.com/ramarivera/open-quake/pull/20 against main.
Implementation commit: `3629150`; delivery metadata is recorded in a follow-up
commit. The branch is pushed, the PR is linked to the T3 thread and remains
unmerged. Hardware limitations above are retained in the closure evidence.
