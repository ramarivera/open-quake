## Implementation

- [x] 1. Fix icon library opening and add a click regression. Bead open-quake-di9.
- [x] 2. Replace built-in artwork with Phosphor and offer its library group. Bead open-quake-jxh.
- [x] 3. Cover prototype names, panelBrightness and Discord mic mute. Artwork portion of open-quake-l86.24.
- [x] 4. Run install, desktop typecheck/tests with SSD TMPDIR, root lint. Delivery follows in the linked beads and PR.

Validation on 2026-10-28: root `pnpm install`, desktop `pnpm typecheck`,
`TMPDIR=/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/oq-tmp pnpm test --maxWorkers=2`
and root `pnpm run lint` passed. Desktop suite: 3,715 passed, one skipped.
Lint: zero errors, 20 warnings and three infos. Strict OpenSpec validation passed.
Focused artwork/editor/library/strip/main IPC suite: 157 passed. The original
locked-Quick click regression failed before the button fix.

The native chooser, preload request channel and IPC ownership checks were traced
in source. Click tests render the real library at a mocked host boundary, and
main-process tests use mocked Electron windows. No actual app, Electron,
hardware or native tests ran; the exact owner-build selection remains unverified.
Knob geometry, title sizing and accent arc findings remain in open-quake-l86.24.
