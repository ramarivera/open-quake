# Tasks

## 1. Decide

- [ ] 1.1 Grill the five open decisions in `design.md`; record answers there and on `open-quake-2qs.6`
- [ ] 1.2 Extend `specs/device-sdk/spec.md` with the decided requirements

## 2. Build

- [ ] 2.1 Protocol: Effect Schema for 33-byte reports and `0xA1`/`0xA2`/`0xA3` frames, with fast-check round-trip tests
- [ ] 2.2 Device: node-hid transport (usagePage `0xFF60`, usage `0x61`, VID `0x4158`, PID `0x514B`)
- [ ] 2.3 Device: event subscription + keep-alive lifecycle per decision
- [ ] 2.4 Plain-JS entry point
- [ ] 2.5 Replace the mock source in `apps/desktop/src/main/deviceBus.ts`
