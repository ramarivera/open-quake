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
- [ ] 2.9 Compose all production desktop main-process services into one Layer graph and one ManagedRuntime. Separate service preparation from IPC activation, retain operation-specific diagnostics, cancel registration-owned work before the single awaited runtime disposal, and verify the actual root plus bundle and media consumers. Bead: open-quake-l86.10.
- [x] 2.10 Separate domain layer preparation from registration activation and use execution-only views with explicit standalone ownership. Verify shared settings IPC/state, cancellation, diagnostic labels and delayed finalizer ownership. This is preparation for 2.9, not root integration. Bead: open-quake-l86.10.1.

## 3. Verify and resolve partial evidence

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
