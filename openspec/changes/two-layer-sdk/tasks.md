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
- [ ] 2.7 Replace the mock source in `apps/desktop/src/main/deviceBus.ts` (parent integration)
- [x] 2.8 Integrate protocol codecs and errors in the device adapter, declare the default transport dependency, verify custom layers, and regress unknown opcode/command handling

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
