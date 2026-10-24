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
in `screenshots/`; diagnostic-layout-failed and panel-touch-complete were inspected after the
final integration; diagnostic-narrow and panel-quick were also inspected during
the first integration. Electron exited and no
lane smoke processes remained.

Tracking: review tasks are `open-quake-lih.11.1.5` through `.9`, corresponding
to tasks 4.1 through 4.5. All five review tasks are complete. The epic is closed with source, gate,
push and review-thread evidence. Cluster `open-quake-lih.11` stays open
for the lead until PR #21 merges.

Disagreements: none with the three findings. The shared lane brief says not
to resolve review threads; the user's explicit instruction for this review
round authorizes replying to and resolving exactly these three. No hardware
was opened, no firmware was flashed, no dependency was added and no hook was
bypassed. Native CoreGraphics effects and physical device behavior remain
unverified.

### Review delivery

Implementation and main integration were pushed as
`0172be03e9bb0c0a218df42554d07ee8bbebe5ee` on `lane/device-lifecycle`.
GitHub reports PR #21 open, clean and mergeable. Normal commit and push hooks
ran; the pre-push Biome gate passed. Truth Mirror's existing disabled policy
was left unchanged.

Each connector thread received an attributed `addPullRequestReviewThreadReply`
naming fix commit `e485357b5f8fba31a24a9a7b45e8d899ff89469b`, followed by
`resolveReviewThread`. A fresh GraphQL read confirmed all three resolved:

- Reconnect: [reply](https://github.com/ramarivera/open-quake/pull/21#discussion_r4366611495), thread `PRRT_kwDOUADXpM6v26Kb`.
- Second instance: [reply](https://github.com/ramarivera/open-quake/pull/21#discussion_r4366611623), thread `PRRT_kwDOUADXpM6v26Kf`.
- Layout prompts: [reply](https://github.com/ramarivera/open-quake/pull/21#discussion_r4366611702), thread `PRRT_kwDOUADXpM6v26Kh`.

The scratch `thread-resolutions.json` and `push.log` retain delivery evidence.
PR #21 has not been merged.

## PR #21 hardware-controls merge round

Inputs: lifecycle head `f4fb66602c9aaeb9efd356fe490e65aa5bb78c47` and
`origin/main` at `4f736cf`, the merge of PR #22. This round only integrates
those branches and updates their verification fixtures and delivery evidence.
PR #21 remains open for the lead to merge.

### Conflict resolutions

- `apps/desktop/src/main/deviceBus.ts`: attach and refresh hardware sessions
  within each connection scope, clear them on teardown, and leave hardware
  replies to their session subscriber. Preserve lifecycle screen-power access,
  explicit recovery, selected-path checks, reconnect backoff and the
  late-arrival presence snapshot before the final retry delay.
- `apps/desktop/src/main/index.ts`: compose hardware preferences and controls
  with the existing runtime, use the hardware mock bus in explicit mock mode,
  and register/dispose hardware IPC alongside lifecycle IPC. Preserve the
  single-instance lock, shared second-instance/activate reopening path,
  close-before-reopen ordering, wake handling and release fallback policy.
- `apps/desktop/src/main/index.test.ts`: retain lifecycle dialog/shell mocks
  and every late-arrival, second-instance and shutdown regression. Keep
  main's stronger startup wait for an actual connected event.
- `apps/desktop/src/main/media/smoke.ts`: retain both hardware registration
  and lifecycle fixtures, including their cleanup. Preserve the diagnostic,
  repair-failure notice, media and touch integration checks.
- `apps/desktop/src/main/test/bundle-smoke.mjs`: share one power-monitor
  emitter, retain lifecycle window/app/shell mocks and test default plus
  packaged explicit mock mode without native device access.
- `apps/desktop/src/preload/index.ts`: load both lifecycle and hardware APIs,
  alongside the existing media, profile and event APIs.
- `apps/desktop/src/renderer/src/App.tsx`: retain Connection diagnostics and
  its persistent subscription, readiness/navigation behavior, Controls with
  HardwareSettings, and the existing appearance and screen pages.
- `packages/device/src/device-service.ts`: retain EIO recovery and selected
  path connections, plus typed hardware writes and their in-flight drain
  before close. Screen blanking delegates to typed `ScreenPower` through
  that same lock. Keepalive uses that lock too, preserving serialized writes.
  The lifecycle wrapper retains its existing write-failed error identity
  after close; `sendHardware` retains its connection-closed identity.

Two supporting integration edits accompany the conflict resolutions.
`packages/device/src/protocol-adapter.ts` delegates its compatibility
screen-power encoder to the typed command and retains HardwareReply decoding.
The dedicated hardware smoke registers/disposes mock lifecycle IPC because
ConnectionCheck now stays mounted while Controls is open. It never calls
native display operations.

Main's touch binding, touch modules, event forwarding and StripPanel files
are unchanged relative to `4f736cf`. No hook files or hook configuration were
changed. `core.hooksPath` stays `.husky/_`.

### Verification

All six lane gates passed on the resolved source:

- `pnpm biome check packages apps`: 272 files, no fixes.
- `pnpm typecheck --force`: six successful tasks, cache bypassed.
- `pnpm test --force`: 697 tests, protocol 47, edge 27, device 348,
  desktop 275; cache bypassed.
- `pnpm build`: production main, preload and renderer build passed.
- `pnpm --filter @open-quake/desktop test:bundle`: both default and explicit
  mock modes passed; the explicit mock loaded/enumerated no native HID.
- `openspec validate --all --strict`: 32 changes passed.

`git diff --check` also passed. Media and lifecycle native checks share the
existing media smoke entrypoint; it was run twice into separate `media/` and
`lifecycle/` artifact directories. Both passed the diagnostic read/Re-detect,
loading, resolution, readiness redirect, repair-failure notice, panel
permission, image/media, strip profile and synthetic vendor-touch checks.
The dedicated hardware native smoke passed firmware queries, LED lock policy,
mic, brightness, volume coalescing/persistence, polling recovery, and
light/dark/narrow/offline controls. Its isolated fixture now serves lifecycle
IPC through the production registration. Chromium emitted scratch cache
startup warnings; the process exited zero and all smoke assertions passed.

Every Electron invocation used `OPEN_QUAKE_MOCK_DEVICE=1`, a lane scratch
TMPDIR and `env -u ELECTRON_RUN_AS_NODE`. All started Electron processes exited.
Screenshots inspected after the merge: diagnostic-layout-failed,
panel-touch-complete, and hardware-narrow. Both Connection and Controls remain
in the management navigation. Hardware effects remain unverified.

Logs and screenshots are under
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/device-lifecycle/merge-round-2/`.
Logs are `biome.log`, `typecheck.log`, `test.log`, `build.log`, `bundle.log`,
`openspec.log`, `media-smoke-build.log`, `media-smoke.log`,
`hardware-smoke-build.log`, `hardware-smoke.log`, and `lifecycle-smoke.log`.
Screenshots are in `media/`, `lifecycle/` and `hardware/`. The hardware runner
requires its original screenshot directory under the hardware lane; originals
are at `hw-controls/pr21-merge-round-2/`, with copies in this lane's evidence.

OpenSpec task 5.1 maps to `open-quake-lih.11.1.10`. The cluster
`open-quake-lih.11` stays open for the lead until PR #21 merges. No new audit
coverage, dependency, firmware operation or real device access was introduced.

## PR #21 review-fix round 2

Starting head: `f10e0327e9e3945a4a1dedf1d242cae1f81f8692`.
All three new connector findings were reproduced and fixed. Before the fixes,
seven regression cases failed and the native mounted renderer stayed on Screen
after readiness loss. The before/after logs are retained in this round's scratch
folder. This round adds no new audit coverage beyond the existing MAIN-042/045,
MAIN-050/053/120 and MGMT-026-040 lifecycle scope.

- Real-device HDMI requires a transaction-confirmed binding from startup.
  A unique physical-size candidate remains diagnostic information until paired.
  Initial USB status starts pairing before synchronizing the panel, avoiding a
  brief development fallback window. The lifecycle regression inspects every
  notification through a 30-second TestClock timeout, then confirms readiness
  after a successful explicit retry. Management returns Screen to Connection
  when readiness turns false. It does this once per transition so deliberate
  offline Screen preview survives repeated failed status. The native smoke
  drives checking, timeout, preview and repair failure through production
  preload/IPC and the mounted subscriber.
- Dock activation shares the management restore/show/focus handler with second
  instance. Reopening checks management's destroyed state independently of the
  hidden fallback panel. Tests cover destroyed, hidden and minimized management
  in a packaged no-strip build, plus the existing close-before-reopen and native
  owner teardown cases for activate and second instance.
- Discovery returns unavailable without screen-power writes when no candidate
  exists. Topology events during a transaction are retained. After an unresolved
  transaction restores power, changed candidate IDs or physical dimensions cause
  another attempt. Off/on events restoring the same candidate set do not cause
  repeated checks. TestClock covers USB before HDMI, late HDMI arriving five
  seconds into an active transaction, recovery after the first timeout, and
  unchanged-topology timeout without repeated blanking. Discovery serialization
  and interruption/power-restoration regressions still pass.

Source regressions are in `apps/desktop/src/main/lifecycle/discovery.test.ts`,
`lifecycle-service.test.ts`, `apps/desktop/src/main/index.test.ts`, and the mounted
renderer checks in `apps/desktop/src/main/media/smoke.ts`.

All six required gates passed on the final implementation:

- `pnpm biome check packages apps`: 272 files, no fixes.
- `pnpm typecheck --force`: six tasks passed, cache bypassed.
- `pnpm test --force`: 704 tests passed, protocol 47, edge 27, device 348,
  desktop 282; cache bypassed. The focused lifecycle/main suite passed 35 tests.
- `pnpm build`: production main, preload and renderer passed.
- `pnpm --filter @open-quake/desktop test:bundle`: default and explicit mock
  modes passed; mock mode resolved/enumerated no native HID.
- `openspec validate --all --strict`: all 32 changes passed, both before
  implementation and after it.

`pnpm install --frozen-lockfile` and `git diff --check` also passed. The media
smoke was rebuilt and run into `media/` and `lifecycle/` directories, both passing
the new readiness/navigation assertions plus existing media, five strip profile,
synthetic touch, authorization, narrow layout, theme and disposal checks. The
separate hardware smoke passed firmware query, LED/lock policy, mic, brightness,
volume/coalescing/persistence, polling recovery, light/dark/narrow/offline UI.
Its Chromium scratch-cache warnings did not fail its assertions or exit status.
All Electron invocations used `OPEN_QUAKE_MOCK_DEVICE=1`, a lane scratch TMPDIR
and `env -u ELECTRON_RUN_AS_NODE`. Every started smoke process exited.

Logs, before/after evidence and screenshots are under
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/device-lifecycle/review-fix-2/`.
Logs: `install.log`, `regressions-before.log`, `regressions-after.log`,
`native-before-build.log`, `native-before.log`, `biome.log`, `typecheck.log`,
`test.log`, `build.log`, `bundle.log`, `openspec.log`, `media-smoke-build.log`,
`media-smoke.log`, `lifecycle-smoke.log`, `hardware-smoke-build.log` and
`hardware-smoke.log`. Screenshots are in `media/`, `lifecycle/` and `hardware/`.
Inspected `media/diagnostic-pairing-timeout.png`,
`media/diagnostic-layout-failed.png` and `hardware/hardware-narrow.png`.
Hardware originals are under `hw-controls/pr21-review-fix-2/` in the same parity
scratch root, as required by that runner.

OpenSpec tasks 6.1-6.4 map to beads `open-quake-lih.11.1.11` through `.14`.
Tasks 6.1-6.3 are complete; task 6.4 remains open through delivery and review
thread resolution. The user explicitly authorizes resolving these three threads
for this round, overriding the brief's general no-resolution instruction.
No real QUAKE or touch controller was opened, DK-Suite was not started, no
firmware was flashed, no dependency was added and no hook was bypassed or
redirected. `core.hooksPath` remains `.husky/_`. Physical blanking/enumeration,
real wake/unlock and native CoreGraphics effects remain lead-owned and unverified.
PR #21 must remain unmerged.
