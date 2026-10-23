# Tasks

Create parent-owned Beads epic and one issue per checkbox, each linking this directory. First-release profile contracts and registry descriptors are dependencies; voice runtime implementation belongs to the voice lane.

## 1. First-release contracts and persistence

- [x] 1.1 Record Ramiro's decisions on stable slot sentinels, focus precedence, panel brightness target/step, and direct-route defaults; verify design.md still identifies unverified physical direction and target details.
- [x] 1.2 Add knob and route Schemas plus pure slot/route migrations in packages/device; verify right-only slot round-trip, duplicate rejection, model-reference migration, route field stripping, and normalization idempotence.
- [ ] 1.3 Connect profile-scoped knob saves and the three-slot desktop editor to the profile conductor; verify edits preserve unrelated keys, page changes preserve the knob, and switching profiles discards old editor state.
- [x] 1.4 Add compatibility handling for known center presets and ambiguous compact arrays; verify explicit holes survive and ambiguous left/right data stays preserved but inactive, and document supported import shapes.

## 2. First-release rotation and navigation

- [ ] 2.1 Agree normalized rotate/detent/press/holdStart/release/session events with L1 and voice lanes; verify a written integration contract defines who classifies holds without changing L1 codecs here.
- [x] 2.2 Implement the knob conductor and single-route event precedence with catalog errors; verify focused-key priority, one route per detent, empty-slot no-op, and old-session rejection through the actual dispatch consumer.
- [ ] 2.3 Register canonical previousPage/nextPage/goToPage assignments and narrow pageUp/pageDown imports; verify page boundaries, invalid targets, and no cross-profile side effects using the profile selection consumer.
- [ ] 2.4 Qualify a panel-only brightness adapter and native-to-percent conversion with L1/desktop evidence, then implement clamped steps; verify 98 plus 5 yields 100, unknown current value writes nothing, and unrelated monitor/RGB values do not change; document target limitations.

## 3. First-release direct voice configuration handoff

- [ ] 3.1 Add the direct provider/model editor and completeness checks without embedding credentials; verify missing model disables capture and route changes retain only allowed fields.
- [ ] 3.2 Compose the voice lane's capture capability and session cleanup into knob dispatch; verify one hold starts once, release ends once, profile change/disconnect cancels, and a consumed hold cannot also fire a short press; document the handoff.
- [ ] 3.3 Exercise real QUAKE rotation, brightness, page changes, and hold/release with the qualified voice runtime when hardware is available; verify firmware/session traces and visible/voice outcomes are attached, keeping hardware tasks open when unavailable.

## 4. Later route compatibility

- [ ] 4.1 Integrate dkclaw and legacyAssistant only after their runtime owners register capabilities; verify absent runtimes remain unavailable, imported route locks cannot override new custom profiles, and credentials stay outside profiles.

## 5. Integration close-out

- [ ] 5.1 Run knob/profile/action/voice integration scenarios and repository gates; verify saved configuration, runtime traces, diagnostic scrubbing, OpenSpec validation, and explicitly unresolved hardware/route evidence before closing issues.

## W4 implementation evidence

- 1.1: approval record reconciled in proposal/design/spec; `openspec validate knob-configuration` passes. Hardware direction, panel target/native range/readback, and hold timing remain unverified.
- 1.2 and 1.4: `packages/device/src/knob/knob-contracts.ts`, `knob-invariants.ts`, and `knob-voice-migration.ts`; property/fixture evidence in `packages/device/test/knob/knob-contracts.test.ts`. Supported import shapes and compatibility retention are documented in `packages/device/src/knob/README.md`.
- 2.1 contract side: `KnobSession`, `KnobEvent`, `KnobSnapshot`, and `KnobDispatchCommand` plus the written normalized integration contract in the module README. The checkbox remains open pending L1/voice adapter agreement and verification. No protocol files changed.
- 2.2: `packages/device/src/knob/knob-service.ts`, routing invariants, module-local catalog leaves, and registry validation. `packages/device/test/knob/knob-service.test.ts` drives the dispatch callback and proves focused precedence, one route per detent, empty no-op, short-release classification, stale ownership, and scrubbed dependency failures. Ports fail closed until the composition root supplies adapters.

Profile/editor saves (1.3), navigation/profile integration (2.3), panel qualification (2.4), voice runtime work, hardware checks, and cross-lane integration remain open. Beads are parent-owned; this lane does not run bd.

W4 gates: `pnpm install` passed with unchanged lockfile; `pnpm run lint` passed, 79 files; `pnpm run typecheck` passed, 6 tasks with 5 cache hits; `pnpm run test` passed, device 76 tests including 40 knob tests, protocol 25 and desktop 87 from unchanged-package cache hits. `openspec validate knob-configuration` passed; `openspec validate --all` passed, 28 changes; `git diff --check` passed. Desktop was untouched, so the conditional desktop build gate was not required.
