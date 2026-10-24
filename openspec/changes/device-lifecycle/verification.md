# Device lifecycle verification

Verified on 2026-10-24 in `lane/device-lifecycle`, based on
`322db542bd07d9da4aff4ecdde4f78181a140f6d`.

Delivered in [PR #21](https://github.com/ramarivera/open-quake/pull/21), linked
to the T3 thread. Implementation commit:
`9a04fbbfc57749cfae4c2a419e17b30a64bbd215`.

Final integration incorporates `origin/main` at `dbc35c3`, preserving PR #18's
management redesign and PR #19's spec corrections. Diagnostics live on a
Connection page reached from the sidebar or Overview. The subscription stays
active across navigation; a completed passing check enters Screen automatically.
Platform capabilities hide unavailable settings/layout actions, and mock mode
does not offer native layout repair.

## Scope and audit evidence

The implementation covers these parts of the local DK-Suite 0.4.95 audits:

- MAIN-009, MAIN-010: EIO counting, same-handle resubscription, fallback and
  reconnect backoff through the existing QuakeDevice abstraction.
- MAIN-011, MAIN-012, SETTINGS-079: scoped handle teardown, immediate panel
  hiding and reuse through the 3000 ms USB disconnect grace.
- MAIN-024, MAIN-042, MAIN-045, MAIN-050, MAIN-053, SETTINGS-083: physical
  matching, screen-off/watch/screen-on pairing, topology updates and hiding.
- MAIN-056, MAIN-057, MAIN-058, SETTINGS-087, SETTINGS-088, SETTINGS-089:
  portrait confirmation, Later snoozes, mirrored-display detection and
  consent-based macOS arrangement repair.
- MAIN-059, MGMT-026 through MGMT-030, MGMT-032 through MGMT-037, MGMT-040,
  SETTINGS-086: mount/read and connection-driven checks, USB/HDMI readiness,
  resolution mismatch, diagnostic copy, troubleshooting, Re-detect and
  accessible responsive states. The combined check switches the existing
  settings mode between preview and device and enters Screen on success from
  Connection. Full first-run routing,
  wizard signaling and serial normalization remain in their owning lanes.
- MAIN-060, SETTINGS-085: control-HID and display recovery after lock/wake.
  Separate touch-HID recovery and knob-light policy remain in their lanes.
- MAIN-103, MAIN-120: refuse a duplicate instance before readiness or HID
  access, then focus the existing management window. No process takeover.
- Approved decision 7 and open-quake-l86.13: retain development fallback and
  hide it by default in release.

These are scoped claims. The change does not claim every subpart of those
audit rows, including boot shields, complete z-order guards, multi-device
recovery planning or Windows native display discovery. No bundled vendor
guide or vendor support integration is added.

Research is local-only at
`~/dev/dark-encyclopedia/dk-suite-introspeccion/v0.4.95/`.
The audit files, recovered diagnostic Vue sources, English locales and
byte-offset slices of `app-resources/background.js` supplied the behavior.

## Source findings and deliberate differences

- The recovered size predicate uses strict `<10`, although the audit says
  ±10. Tests reject exactly ten pixels of difference and accept scaled
  portrait/landscape sizes. Matching checks physical size before label.
- The existing protocol encoder emits screen off/on with opcode 1, command
  4 and value 0/1. Device tests assert the encoded HID bytes and one handle.
- DK-Suite's decline warning says it disconnects. Our Later action snoozes
  ten minutes, so the prompt explains that the device remains connected.
  Arrangement-only prompts do not claim mirroring.
- The macOS repair uses a fixed JXA CoreGraphics program through osascript.
  Consent describes unmirroring, primary demotion and far-right placement.
  A read-only system_profiler probe can recognize a named mirror omitted
  by Electron and offer Display Settings without guessing its display ID.
- A failed pairing must not pass HDMI through an unpaired size candidate.
  The lifecycle regression test drives timeout and successful retry through
  the actual service with TestClock.

## Gates

All commands exited zero after the final code changes:

| Command | Result |
| --- | --- |
| `pnpm biome check packages apps` | Passed, 202 files |
| `pnpm typecheck` | Passed, six tasks |
| `pnpm test` | Passed, 556 tests: protocol 25, edge 27, device 302, desktop 202 |
| `pnpm build` | Passed |
| `pnpm --filter @open-quake/desktop test:bundle` | Passed, native HID replaced with hermetic IO |
| `openspec validate --all --strict` | Passed, 29 changes |
| `git diff --check` | Passed |

The native media smoke was rebuilt and run with `OPEN_QUAKE_MOCK_DEVICE=1`,
`ELECTRON_RUN_AS_NODE` unset and scratch TMPDIR. It exercised the production
preload/IPC, diagnostic read and Re-detect, disabled/loading state,
resolution mismatch, automatic Connection-to-Screen navigation, readiness
across pages and rejected panel mutation.
Existing wallpaper/theme/motion checks and runtime disposal also passed.
The Electron process exited and no lane smoke processes remained.

This worktree initially lacked Husky's generated `.husky/_` launchers.
`pnpm exec husky` regenerated them without editing the committed hook chain.
The missed pre-commit, commit-msg, post-commit and pre-push hooks were then
run successfully with `git hook run`. The delivery evidence commit and push
use the restored normal hook path. Truth Mirror remains disabled by the
repository's existing policy; its off-switch was not changed.

Logs and visually inspected screenshots are under
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/device-lifecycle/`:

- Logs: `biome.log`, `typecheck.log`, `test.log`, `build.log`, `bundle.log`,
  `openspec.log`, `diff-check.log`, `native-smoke-build.log`, `native-smoke.log`.
- Screenshots: `screenshots/diagnostic-disconnected.png`,
  `screenshots/diagnostic-resolution.png`, `screenshots/diagnostic-ready.png`,
  `screenshots/diagnostic-narrow.png`, plus management and panel captures.

## Tracking

The lifecycle OpenSpec epic is `open-quake-lih.11.1`, under cluster
`open-quake-lih.11`. Its executable tasks are `.1.1` device resilience,
`.1.2` desktop lifecycle, `.1.3` diagnostics and `.1.4` verification/delivery.
All four tasks, the epic and cluster are closed with source, verification and
PR evidence. `open-quake-l86.12` and `open-quake-l86.13` are also closed with
evidence.
`open-quake-7fj` retains its lead-owned hardware tasks and links this work.

## Unverified and deferred

No real QUAKE, touch controller or DK-Suite was opened. No firmware was
flashed. No new dependency was added. All device and timing tests use mocks
and TestClock; native smoke uses simulated connections and display topology.

The lead still needs to verify screen blanking and display enumeration,
physical placement, real sleep/lock/unlock recovery, native JXA compatibility
and actual CoreGraphics layout effects. Consent behavior and proposed
coordinates are tested with mocks, which cannot prove those host effects.
Windows native enumeration and `DisplaySwitch.exe /extend` remain future
platform-gated, consent-based work as authorized in the lane scope.

## PR #21 review-fix round 1

Fix commit: `e485357b5f8fba31a24a9a7b45e8d899ff89469b`.
All three connector findings were confirmed against the code and fixed.

- Reconnect presence is captured before the final backoff wait. The TestClock
  regression starts absent, observes five failures by 16 seconds, attaches at
  20.5 seconds, and connects at 25 seconds on the first passive scan.
- Second-instance reopening shares activate's panel/bus startup and lifecycle
  wake. Unlock waits for old-owner teardown. Main entrypoint tests drive both
  events with fake HID, prove resumed input and diagnostic recovery, and hold
  rapid reopening/quit behind a blocked native close.
- A failed consented layout repair uses the ten-minute Later interval from
  failure time. Automatic polling reports only native-failed diagnostics and
  continues after failure; explicit repair stays available and success clears
  the notice. Tests cover delayed failure, the exact cooldown boundary, safe
  error identity, retained private cause and the real one-second service poll.
  Diagnostic markup and native smoke prove the explanation stays visible
  instead of triggering the passing-check redirect into Screen.

Main was first merged at `2ac4a2ff3867e0fd5bc1e9c878278bf8af9b9753`
for PR #23. Main then advanced with PR #20 during this round; the final
integration includes `969d165ad5896f2a4dac8d1fca2a327dc13c5161`.
Conflict resolutions preserve StripPanel, profile snapshot IPC, lifecycle IPC,
control-HID recovery/screen power, separately scoped vendor touch input,
panel-only touch forwarding, explicit mock mode in packaged builds and both
native smoke flows. The release fallback remains hidden by default.

All final code gates passed after that integration:

- `pnpm biome check packages apps`: 246 files, no fixes.
- `pnpm typecheck`: all six tasks passed.
- `pnpm test`: 647 tests passed, protocol 25, edge 27, device 325, desktop 270.
- `pnpm build`: passed.
- `pnpm --filter @open-quake/desktop test:bundle`: default and explicit mock
  modes passed; mock mode resolved/enumerated no native HID.
- `openspec validate --all --strict`: 31 changes passed.
- `git diff --check`: passed.
- The lane's native smoke build and Electron run passed with
  `OPEN_QUAKE_MOCK_DEVICE=1`, `ELECTRON_RUN_AS_NODE` unset and a scratch TMPDIR.
  It exercises diagnostics, the visible repair-failure notice, five strip
  profile fixtures, synthetic vendor touch through the real mounted panel,
  gesture feedback, native image decoding, preload/IPC authorization, themes,
  reduced motion, narrow layout and runtime disposal before quit.

Evidence is under
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/device-lifecycle/review-fix-1/`.
Logs: `biome.log`, `typecheck.log`, `test.log`, `build.log`, `bundle.log`,
`openspec.log`, `native-smoke-build.log`, `native-smoke.log`. Screenshots are
in `screenshots/`; diagnostic-layout-failed, diagnostic-narrow, panel-quick
and panel-touch-complete were inspected visually. Electron exited and no
lane smoke processes remained.

Tracking: review tasks are `open-quake-lih.11.1.5` through `.9`, corresponding
to tasks 4.1 through 4.5. Tasks 4.1 through 4.4 are complete; final push and
review-thread delivery remain in 4.5. Cluster `open-quake-lih.11` stays open
for the lead until PR #21 merges.

Disagreements: none with the three findings. The shared lane brief says not
to resolve review threads; the user's explicit instruction for this review
round authorizes replying to and resolving exactly these three. No hardware
was opened, no firmware was flashed, no dependency was added and no hook was
bypassed. Native CoreGraphics effects and physical device behavior remain
unverified.
