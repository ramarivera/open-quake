# Tasks

The protocol kernel is merged on main. This integration owns `packages/device/**`,
the shared lockfile, and this change's planning artifacts. Beads updates are
deferred to the parent per lane COMMON.md.

## 1. Decide

- [x] 1.1 Document five recommendations in `design.md`, each approved by Ramiro on 2026-10-23, grounded in effect-conductor and open-quake-errors
- [ ] 1.2 Obtain Ramiro's answers and record the approved decisions on `open-quake-2qs.6` through the parent
- [x] 1.3 Extend `specs/device-sdk/spec.md` with inventory section 1 protocol requirements and explicit P-tier unknowns; validate with `openspec validate two-layer-sdk`

## 2. Build

- [x] 2.1 Protocol: schemas and pure functions for discovery identity, 33-byte reports, A1 JSON, A2 opaque resources, A3 short commands, modulo-FF checksum, matrix press decode, QMK commands 01/07/08/09, and DFU; preserve existing exports
- [x] 2.2 Protocol: catalog-backed Schema.TaggedError leaves, private parser causes and scrubbed serialization
- [x] 2.3 Protocol: vitest/fast-check round-trips, checksum invariants, corrupt/truncated-frame rejection, length/padding boundaries, known vectors and error identity tests in `packages/protocol/test/`
- [x] 2.4 Device: node-hid transport, using usagePage `0xFF60`, usage `0x61`, VID `0x4158`, PID `0x514B` (L2)
- [x] 2.5 Device: event subscription and keep-alive lifecycle per approved decision (L2)
- [x] 2.6 Device: plain-JS entry point (L2)
- [x] 2.7 Replace the mock source in `apps/desktop/src/main/deviceBus.ts` with the scoped QuakeDevice stream, HID catalog status events, retry after absence/unplug, and an explicit development mock flag (W1, `open-quake-l86.9`)
- [x] 2.8 Integrate protocol codecs and errors in the device adapter, declare the default transport dependency, verify custom layers, and regress unknown opcode/command handling
- [x] 2.9 Compose all production desktop main-process services into one Layer graph and one ManagedRuntime. Separate service preparation from IPC activation, retain operation-specific diagnostics, cancel registration-owned work before the single awaited runtime disposal, and verify the actual root plus bundle and media consumers. Bead: open-quake-l86.10.
- [x] 2.10 Separate domain layer preparation from registration activation and use execution-only views with explicit standalone ownership. Verify shared settings IPC/state, cancellation, diagnostic labels and delayed finalizer ownership. This is preparation for 2.9, not root integration. Bead: open-quake-l86.10.1.

## 3. Verify and resolve partial evidence

- [x] 3.7 Isolate and reset management scenarios, stabilize generated profile identities, explore select-revealed controls, detect all IPC failure replies, guarantee fixture exit and friendly scratch errors. Investigate emoji selection/validation and localized duplicate profile rename. Verify three identical sweeps, desktop types/tests and lint. Beads `open-quake-l86.28`, `open-quake-l86.30`, `open-quake-fuu`, `open-quake-0z4`.
- [x] 3.6 Build and run a production-root management UI exerciser with fixture-only fake HID, hidden windows and isolated scratch data. Enumerate every sidebar page and its safe controls using native Electron input; report effects/errors, screenshot pages, and assert icon-library opening, persisted move/swap/title edits and active-profile panel delivery. Track failures without fixing product bugs. Bead: open-quake-l86.25.

- [x] 3.1 L1: run `pnpm install`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`; all exit 0, lint checks 38 files, typecheck reports 6 successful tasks, protocol has 25 passing tests. `pnpm --filter @open-quake/device test` independently passes the real consumer wiring test; record results in the lane PR
- [ ] 3.2 Hardware: verify USB identity variants, live HID timing, physical matrix layout and release semantics
- [ ] 3.3 P-tier: establish A2 image encoding, key/icon mapping, sequence rollover, fragmentation, acknowledgments and retry behavior before claiming image-transfer parity
- [ ] 3.4 P-tier: validate meanings of other short-command opcode/cmdID pairs through hardware evidence
- [x] 3.5 Integration: run frozen install, direct Biome, typecheck, tests, build, and strict OpenSpec validation; record read-only QuakeDevice discovery separately from live I/O acceptance

Device implementation evidence: `packages/device/test/` has 36 passing tests
across 5 files; `pnpm --filter @open-quake/device test` and
`pnpm --filter @open-quake/device typecheck` exit 0. This verifies tasks 2.4,
2.5, 2.6 and 2.8 with mocked native I/O and the fake transport. Live connection
behavior remains part of task 3.2.

Integration verification on 2026-10-23: `pnpm install` and
`pnpm install --frozen-lockfile` exit 0; the approved node-hid install step
completed. `./node_modules/.bin/biome check packages apps` exits 0, 59 files.
`pnpm run typecheck` exits 0, 6 successful tasks, 5 cached. `pnpm run test`
exits 0, 3 successful tasks: device 36 tests executed here; protocol 25 and
desktop 19 tests replayed from Turbo cache. `pnpm run build` exits 0, 1
successful cached desktop build. `openspec validate two-layer-sdk --strict`
passes.

A temporary local test called native transport enumeration and
`QuakeDevice.discover()` only. It found VID `4158` / PID `514B` collections
`01/80`, `0C/01`, `01/06`, and `FF60/61`; the conductor selected exactly one
`FF60/61` control interface. Native binding loading and discovery are verified.
No handle was opened, no command was sent, and DK-Suite was never started.
Live I/O, timing, detach, matrix and separate touch acceptance remain unchecked
in task 3.2. The temporary hardware test was removed from the automated suite.

Panel display evidence on 2026-10-28 (bead `open-quake-l86.15`): the opt-in
`panel-display` fixture started the production app against the real QUAKE with
scratch `userData`. The panel filled the 1920x480 QUAKE display at x=1280. The
captured display matched the rendered panel (mean RGB difference 0.16 of 255)
and differed from the replaced desktop by 77. The device's active profile was
Vivid, whose single `colorfulScreen` key paints the full-screen gradient, so
zero tiles is expected there. The read-only native suite passed 10 checks with
3 mutation checks skipped and no failures, both before and after. The owner check no longer treats tools given the repo
path, such as octocode, as device owners. The macOS framebuffer isn't the
backlight, so physical light output, touch, knob gestures, matrix layout and
USB hot-plug remain unchecked in task 3.2.

Rerun on 2026-10-28 at `a2744a4e` (bead `open-quake-l86.17`), clean checkout,
each run in a fresh scratch directory. Read-only suite: 10 passed, 3 mutation
checks skipped, 0 failed, 7 supervised. Mutation suite: 13 of 20 passed (65%),
0 failed, with microphone, panel luminance and knob LED changed, read back and
restored. Extended suite: 7 passed and 3 skipped without mutations; with
mutations, the qualified effect-speed round trip also passed (8 passed), and
brightness and color stay skipped as unqualified for this firmware. Every run
retained diagnostics with zero drops. The audio fixture passed: two capture
sessions from the USB input with PCM framing, pause/resume, drain and worker
cleanup, a partial final frame, and native playback (peak RMS 0.07). It doesn't
prove audibility. The panel fixture passed with the per-channel flat-frame
metric: panel difference 0.16 of 255, desktop difference 77.5, color deviation
43.1.

Query probe on 2026-10-28 (bead `open-quake-l86.17`): the opt-in read-only
probe sent only flag-2 queries. Every one of the seven query-only commands
answered with a valid checksum: 0x02 reported 0, 0x04 screen power 1, 0x06
knob LED 0 or 1 across runs, 0x07 idle flags 0, 0x1E config byte 3, and 0x2D
the device tick. The 0x1F name reply is the device serial, so evidence keeps
only its length (11) and that it matches. The tick is in milliseconds:
1005 ticks over 1004 ms and 3005 over 3005 ms. Keep-alive pongs carry a
counter that increments by one. Starvation brackets on separate runs: the
counter kept counting after 20, 21.5, 23, 24 and 24.5 seconds without a
keep-alive and reset to 0 after 25, 30, 35 and 40 seconds, so firmware idle
tracking expires between 24.5 and 25 seconds. Screen power and idle flags
didn't change through 40 seconds, so starvation doesn't switch the screen off
in firmware state; the production 15-second interval stays inside the window.
Ramiro saw the LEDs flashing during these runs. This settles the reply meaning
of these queries for task 3.4. What their set forms do, and how 0x02, 0x06 and
0x1E map to visible output, needs someone watching the device. Task 3.3 needs
A2 resource writes to device storage plus visual confirmation, so it stays
with Ramiro.

## W1 desktop wiring

`apps/desktop/src/main/deviceBus.ts` consumes one main-owned QuakeDevice layer
through the existing node-hid adapter. It forwards rotation, raw press state,
checksummed touch, pong sequence and disconnect events with source `hid`.
Catalog errors cross IPC as `_tag`, `code` and `category` only. The supervisor
retries after one second, closing each attempt's scope before another connect.
The shared connection stays open while either window remains; last-window
teardown closes it, and reopening waits for that close before reconnecting.
Electron holds quit until connection finalizers and the runtime have completed.
Preload requests the current status after subscribing so reloads recover it.

The timer source is available only with `OPEN_QUAKE_MOCK_DEVICE=1` during
`pnpm --filter @open-quake/desktop dev`. Production defaults to HID even if
that flag is set. Workspace TypeScript is bundled; native `node-hid@3.4.0`
stays external so it resolves its own binding. Desktop declares the existing
catalog/runtime dependencies and its direct native dependency; device package
exports and code are unchanged.

Evidence: `apps/desktop/src/main/hidDeviceBus.test.ts`, `index.test.ts` and
`src/preload/index.test.ts` exercise fake HID selection from all four USB
collections, both-window IPC, absence, unplug, reconnect, discovery/open/read/
write/close/protocol failures, cause scrubbing, status replay, quit and window
teardown. `pnpm --filter @open-quake/desktop test:bundle`, after build, executes
the generated main bundle with Electron and native HID mocked. It checks typed
absence in both windows, native dependency resolution and awaited shutdown
without opening hardware. This smoke command uses Node's `registerHooks`,
available in Node 22.15+ and 23.5+; this lane ran Node 24.18.0.

Hardware verification remains unverified. This lane did not enumerate or open
physical HID devices or run DK-Suite. The service's four-field filter selects
`0xFF60/0x61`, rejecting the `0x1/0x80`, `0xC/0x1` and `0x1/0x6` collections.
Separate unchecked touch-interface handling is still unsupported and unverified;
the desktop only forwards the checksummed touch events the device layer emits.

W1 verification on 2026-10-23, all exit 0:

- `pnpm install`, existing catalog pins and `node-hid@3.4.0` reused. Existing
  electron-vite/Vite and Effect Vitest/Vitest peer-version warnings remain.
- `pnpm run lint`, 73 files, no fixes.
- `pnpm run typecheck`, 6 successful tasks, 5 cached.
- `pnpm run test`, 3 successful tasks, 2 cached. Desktop executed 101 tests
  across 9 files; cached device 36 and protocol 25 results were replayed.
- `pnpm run build`, desktop main/preload/renderer built with no cache hit.
- `pnpm --filter @open-quake/desktop test:bundle`, passed with mocked Electron
  and native HID, no hardware I/O.
- `openspec validate two-layer-sdk --strict` and
  `openspec validate panel-window-prototype --strict`, passed.
- `git diff --check`, passed.

Task 3.2 stays open. Beads status for `open-quake-l86.9` is handed to the parent
under COMMON.md; this lane did not run `bd` directly.

W1 review-fix round 1 on 2026-10-23: renderer statistics retain raw HID press
reports but exclude state zero from the press total. Disconnect and error
statuses clear the previous pong; reconnect remains waiting until a new pong.
The explicit development mock exposes and replays a connected status with
source `mock` through the same IPC status contract. The informational startup
status note requires no code change. GitHub's inline-comment API returned no
Codex or CodeRabbit findings for this round.

Regression evidence: `apps/desktop/src/renderer/src/useQuakeEvents.test.ts`
first failed on double-counting and stale keepalive, and
`apps/desktop/src/main/deviceBus.test.ts` first failed on undefined mock status.
All now pass. `hidDeviceBus.test.ts` drives fake reports through QuakeDevice,
the desktop bus and the renderer reducer for press/release and unplug/reconnect.
`index.test.ts` checks connected mock status delivery and preload status replay
for both windows. No physical device or live Electron session was exercised.

Review-fix gates, all exit 0: `pnpm install`; `pnpm run lint` (73 files);
`pnpm run typecheck` (6 successful tasks, 5 cached); `pnpm run test`
(106 desktop tests executed here, 36 device and 25 protocol tests replayed
from Turbo cache); `pnpm run build` (desktop built here);
`pnpm --filter @open-quake/desktop test:bundle` (mocked Electron/HID);
`openspec validate two-layer-sdk --strict`;
`openspec validate panel-window-prototype --strict`; `git diff --check`.
No dependencies were added. Parent should attach this evidence to
`open-quake-l86.9`; hardware acceptance in task 3.2 remains open.

Root graph delivery, 2026-10-26: PR73 squash merged as f147032 after current-head Codex review with no findings, all threads reconciled, validation, five native package jobs and the complete download matrix. Source includes awaited persistence finalizers before reset/import, failed HTTP repository direct-voice fallback, actual-root shutdown, and corrupt-store acceptance documented in verification-service-graph.md. A thumbnail cleanup test timed out in the first hosted run; its seven-test file passed twice locally and the exact failed-job rerun passed without changing assertions or source. Bead open-quake-l86.10 is delivered.

## Device burn-down lane 2026-10-26

- [x] Implement device lane requirements with fixture/TestClock/native mock coverage. Beads open-quake-lih.11.20-.22.
- [x] Run full gates after merging latest origin/main; hand PR to lead with hardware unverified.

Device lane validation: current main `4aa4a9f1` merged. Root test command with SSD TMPDIR passed 4,137 tests with four existing skips. Lint, six-package typecheck, build, bundle smoke, 47 strict OpenSpec items and hidden muted native media smoke passed. EN/DE screenshots and per-row evidence are in the lane scratch directory; hardware stays unverified. Beads remain open for the lead.

## PR #112 post-merge matrix follow-up

- [x] Restore state-derived panel matrix releases, ordinary KeyRuntime execution and held-hotkey/emoji routing. Bead `open-quake-lih.11.24`; shared delivery and gates in `../device-lifecycle/tasks.md` section 11. Finding 4380831182.


Management exerciser evidence, 2026-10-28, bead `open-quake-l86.25`: production
composition root with production renderer/preload, fixture-only fake HID, hidden
windows and scratch data. All 13 sidebar pages captured. The final sweep found
688 control records, activated 360, skipped 316 under the explicit policy, and
classified 12 as expected inert. Seven targeted scenarios passed profile delivery
and editable empty-cell movement, and failed icon-library opening, locked
move/swap, locked Luminance rename and editable covered-cell swapping. The full
report has 21 strict failure records, including repeated main diagnostic spans,
and zero renderer/uncaught-main exceptions. Validation and duplicate-name
rejections from synthetic inputs are investigation findings, not established
product defects. Follow-ups: `open-quake-3nd`, `open-quake-nf7`,
`open-quake-dbf`, `open-quake-ayj`, `open-quake-0z4`, `open-quake-fuu`; earlier
hidden-profile rejection: `open-quake-8ea`. Existing regressions remain
`open-quake-di9`, `open-quake-fb9`, `open-quake-efm`.

Desktop typecheck and tests pass, 3706 tests and one existing skip. Tests used
`TMPDIR=/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/oq-tmp` and two workers after one
initial timeout passed in isolation. Root lint passes with the existing
20 warnings and three infos. The production and fixture builds pass.
`openspec validate two-layer-sdk` passes; strict mode retains three pre-existing
requirement-length warnings. JSON and screenshots stay in
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-ui-exerciser/run-KJhnU4/`.
No product bugs were fixed, no native HID was opened, and no owner's userData
was used. PR integration belongs to the parent.

Management exerciser hardening, 2026-10-28, task 3.7: three consecutive hidden
fixture sweeps `run-LHs5dV`, `run-CL1EdU`, `run-WBdAZk` each visit 13/13 pages
and produce the same 599 records, 584 controls, 350 exercised controls, 356 passes,
9 strict failures, 217 skips, 17 expected inert records and zero renderer or
uncaught-main errors. The complete record/status multisets match with zero
intermittent records. All ten targeted scenarios pass; Emoji and Profiles have
zero failures. The nine preserved failure records belong to the existing stale
knob conflict `open-quake-3nd` and newly exposed synthetic speech configuration
rejections `open-quake-l86.31`, including their diagnostic groups. Sweeps exit 1
for these failures; validation was not weakened. Desktop typecheck, 3,756 tests
with one existing skip, root lint and OpenSpec validation pass. Missing-volume
handling and failure during report finalization were directly probed. All
artifacts remain outside git under the SSD scratch root. Main advanced from the
tested `1d967e4c` to disjoint `e62b57e1` during acceptance; source stayed fixed
across all three runs. Assigned beads retain delivery/merge notes for the lead.

## Carried PR156 findings, open-quake-l86.34

- [x] 3.8 Keep overlong emoji names intact, focus rename on opening only and associate validation feedback with the field.
- [x] 3.9 Count actual emoji command invocations, share operation parsing, log finalization exceptions and record selector restoration failures while continuing exploration.
- [x] 3.10 Validate changed consumers and one hidden native sweep; retain all strict failures and ship with one bot-review addressing round.

PR157 delivery: squash merge `ebc68640398932a49230ce1ec4f98f928af7367a`, exact-head completed Devin review with no findings and all package/download checks passed. Owner app includes the correction. Native management sweep passed all 12 targeted scenarios; five existing speech configuration failures remain tracked separately in `open-quake-l86.31`.

## Guided production-panel input capture, open-quake-l86.19

- [x] Prepare an opt-in single-owner capture entry around the production app with fresh scratch data, inert touch tiles and no physical-key instructions. Observe the existing renderer event bridge, record bounded timing/coordinates and guide touch, knob and cable reconnect.
- [x] Verify guide progression, privacy/bounds, safe fixture configuration and a hidden mock run of the real renderer. Commit/push and retain physical acceptance as a separate human session.

Guided fixture verification: four focused progression/privacy/profile/voice-route tests pass; desktop types and lint pass. The production renderer/preload plus opt-in entry built and completed all twelve synthetic steps in a hidden mock run, with native HID imports blocked. Captured fixture panel inspected; report status observed, selfTest true, physicalAccepted false. Evidence: SSD hardware scratch `guided-run-jsLiHV/`. No physical session, real HID handle, microphone, provider call, foreground input or lighting mutation occurred. Physical acceptance remains unverified.

## Typed probe evidence privacy, open-quake-l86.18

- [x] Reject serial bytes in Uint8Array and Buffer views, including nested evidence, without reading bytes outside a view. Verify with fake-only probe regressions and owning types/lint, then deliver.

- [x] Review current input/diagnostic seams and propose bounded agent testability improvements without implementing a new recorder or observer. Proposal: `design.md` section Agent testability proposal; bead `open-quake-l86.20`.

Typed-byte verification: the new regression fails against the prior guard and passes after the fix. All six fake-only probe tests, desktop typecheck and root lint pass. No native HID is loaded and no actual device serial is used. PR160 delivered by squash merge `4ce04913156667830df91911fb4222234dc492e8` after one completed review round and green build/package/download checks. Beads `open-quake-l86.18` and `open-quake-l86.20` closed.

Physical-route preparation: the fixture has no player tiles or knob assignments. Production pinKnobProfile rejects its empty center slot before microphone setup, including after device selection; the focused regression covers both states. Generic brief presses can interrupt idle voice, and a hold may show unavailable feedback. Prompts now request brief presses. This source check is not a physical gesture test. PR159/160 delivery was reconciled while resolving planning-only base conflicts; reviewed runtime source retained.

PR162 single review round: corrected signed direction checkpoints, retained queued observations before overflow termination, and preserved renderer arrival intervals with validated timestamps converted to session-relative time. Seven focused tests, desktop types and changed-file lint pass. Hidden production renderer rehearsal `guided-run-pQp4ey` completed twelve steps with36events and explicit selfTest true/physicalAccepted false; screenshot inspected. Tap targets still require human confirmation. Hosted CI and merge remain pending; no re-review requested.
