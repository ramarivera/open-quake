# Tasks

L1 owns `packages/protocol/**` and this change's planning artifacts. L2 owns
`packages/device/**`. Beads updates are deferred to the parent per lane COMMON.md.

## 1. Decide

- [x] 1.1 Document five recommendations in `design.md`, each explicitly "Proposed (pending Ramiro)", grounded in effect-conductor and open-quake-errors
- [ ] 1.2 Obtain Ramiro's answers and record the approved decisions on `open-quake-2qs.6` through the parent
- [x] 1.3 Extend `specs/device-sdk/spec.md` with inventory section 1 protocol requirements and explicit P-tier unknowns; validate with `openspec validate two-layer-sdk`

## 2. Build

- [x] 2.1 Protocol: schemas and pure functions for discovery identity, 33-byte reports, A1 JSON, A2 opaque resources, A3 short commands, modulo-FF checksum, matrix press decode, QMK commands 01/07/08/09, and DFU; preserve existing exports
- [x] 2.2 Protocol: catalog-backed Schema.TaggedError leaves, private parser causes and scrubbed serialization
- [x] 2.3 Protocol: vitest/fast-check round-trips, checksum invariants, corrupt/truncated-frame rejection, length/padding boundaries, known vectors and error identity tests in `packages/protocol/test/`
- [ ] 2.4 Device: node-hid transport, using usagePage `0xFF60`, usage `0x61`, VID `0x4158`, PID `0x514B` (L2)
- [ ] 2.5 Device: event subscription and keep-alive lifecycle per approved decision (L2)
- [ ] 2.6 Device: plain-JS entry point (L2)
- [ ] 2.7 Replace the mock source in `apps/desktop/src/main/deviceBus.ts` (parent integration)

## 3. Verify and resolve partial evidence

- [x] 3.1 L1: run `pnpm install`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`; all exit 0, lint checks 38 files, typecheck reports 6 successful tasks, protocol has 25 passing tests. `pnpm --filter @open-quake/device test` independently passes the real consumer wiring test; record results in the lane PR
- [ ] 3.2 Hardware: verify USB identity variants, live HID timing, physical matrix layout and release semantics
- [ ] 3.3 P-tier: establish A2 image encoding, key/icon mapping, sequence rollover, fragmentation, acknowledgments and retry behavior before claiming image-transfer parity
- [ ] 3.4 P-tier: validate meanings of other short-command opcode/cmdID pairs through hardware evidence
