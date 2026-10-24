# Tasks

## 1. Contracts and planning

- [x] 1.1 Reconcile knob-configuration and push-to-talk inputs, cite audit/source evidence, and validate all changes strictly.

## 2. Domain behavior

- [x] 2.1 Implement firmware arbitration, ring/picker deadlines, focus and volume state with TestClock and property tests proving real port calls and stale-session cleanup; document integration ports.

## 3. Desktop and strip

- [x] 3.1 Compose the main controller and decoded preload, render selector/dial/volume overlays within the panel, and test desktop consumer permissions and geometry.

## 4. Native verification and delivery

- [x] 4.1 Run native mock smoke for ring, picker, paging and gestures; inspect and save screenshots, run every lane gate, close beads with evidence, and create a PR with limitations.

## 5. Owning-lane composition

- [ ] 5.1 Compose the profile-manager serialized selection/thumbnail producer, active device/page/revision refresh, focused brightness/hotkey actions, knob-push-to-talk runtime and normalized physical touch when their transports are available; verify actual consumers. Tracked by open-quake-lih.4.2. This baseline exposes the ports and fails unavailable runtimes closed.

## Evidence

- 1.1: reconciled knob-configuration and knob-push-to-talk; strict OpenSpec validation passes all 28 changes.
- 2.1: packages/device/src/knob/model/ with 13 port-driven tests in packages/device/test/knob/knob-model.test.ts, including TestClock deadlines, slow cache/writer concurrency, firmware arbitration, failure identity and wrapping properties.
- 3.1: apps/desktop/src/main/knob/, shared/knob-contracts.ts and strip/overlays/knob/. Desktop consumer tests prove committed storage selection and panel identity permissions; geometry tests retain recovered rounding. Native smoke drives the production bus consumer, IPC, preload and renderer.
- Runtime composition limits and exact interfaces: apps/desktop/src/main/knob/README.md and design.md. Real hardware and live voice/brightness/hotkey drivers are not verified. The epic and cluster remain open for task 5.1.

- 4.1: all six lane gates and both native mock Electron smokes passed. PR: https://github.com/ramarivera/open-quake/pull/24. Captures and gate logs: /Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/knob-model/. Open task 5.1 tracks owning-lane integration; it does not claim hardware verification.
