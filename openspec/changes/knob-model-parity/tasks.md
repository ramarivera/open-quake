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

- [ ] 5.1 Compose active hardware identity, thumbnail production, external-volume observations, focused monitor-brightness/hotkey actions, knob-push-to-talk runtime and physical focus/volume acquisition when their transports are available; verify actual consumers. Tracked by open-quake-lih.4.2. Screen luminance and picker physical touch are composed in task 6.1. Other unavailable runtimes report catalog warnings and request the error tone.

- [x] 5.2 Bind directional focused hotkeys to the committed visible knob-enabled key through HotkeyConfig and the existing hardware keyboard adapter; reject stale device, profile, page, revision/content and replaced sessions before IO. Verify KnobModel to fake HID transport, both directions, invalid/missing actions, unavailable input mode and correlated scrubbed failure diagnostics. Tracked by open-quake-lih.4.2.1. Monitor brightness and physical acceptance remain in task 5.1.

## 6. Review round 1

- [x] 6.1 Merge touch/hardware main, fix rotated picker input and exclusive selectors, compose luminance/volume and publish physical failures with the error buzzer; verify all gates and native mock smokes. Bead open-quake-lih.4.1.5. Delivery is PR #24; reply to both verified review threads with the fix commit after push.

## Evidence

- 1.1: reconciled knob-configuration and knob-push-to-talk; strict OpenSpec validation passes all 30 changes.
- 2.1: packages/device/src/knob/model/ with 13 port-driven tests in packages/device/test/knob/knob-model.test.ts, including TestClock deadlines, slow cache/writer concurrency, firmware arbitration, failure identity and wrapping properties.
- 3.1: apps/desktop/src/main/knob/, shared/knob-contracts.ts and strip/overlays/knob/. Desktop consumer tests prove committed storage selection and panel identity permissions; geometry tests retain recovered rounding. Native smoke drives the production bus consumer, IPC, preload and renderer.
- Runtime composition limits and exact interfaces: apps/desktop/src/main/knob/README.md and design.md. Real hardware and live voice/brightness/hotkey drivers are not verified. The epic and cluster remain open for task 5.1.

- 4.1: all six lane gates and both native mock Electron smokes passed. PR: https://github.com/ramarivera/open-quake/pull/24. Captures and gate logs: /Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/knob-model/. Open task 5.1 tracks owning-lane integration; it does not claim hardware verification.

- Main integration: merged strip-grid/management changes; shared ProfileService selection and committed notifications now drive knob, panel and preview. Native smoke asserts both windows update after a knob commit and unsupported grid taps clear focus.

- 6.1: merged origin/main 4f736cf, preserving strip grid, geometry.tileAt/sub-touch routing and hardware controls. Rotation=90 pointer and physical picker inputs, exclusive selectors, sanitized physical-failure warnings and hardware error tones are verified. All six gates and three native mock smokes pass. Detailed evidence: verification-round-1.md. Screen luminance is composed; monitor brightness/hotkey/voice and the other task 5.1 integrations remain open.

- Backend continuation on required base bf03bcd: dynamic device-specific profile/page context and stale-device rejection; shared manager-owned selection; one canonical content/locale thumbnail writer/reader with atomic publication, bounded native decoding, hidden abortable capture, late-result rejection and registration invalidation; registration-owned bounded read-only volume observations. Source and tests are under apps/desktop/src/main/knob/ and the narrow profiles thumbnail modules. Task 5.1 remains unchecked for parent root bindings, focused monitor/hotkey qualification, live voice, physical focus/volume and actual device acceptance. No OS volume read/write, hardware, provider or foreground input ran. Verification evidence and final commit are recorded in open-quake-lih.4.2.

- Parent production composition, 2026-10-25: root now supplies active HID serial to voice/knob, shared canonical profile thumbnails, shared profile selection and canonical settings locale with revision protection and disposable notification. Foreground helper acquisition is scoped in Profiles and disposal is awaited in Emoji. Combined source passed 1,380 desktop tests, typecheck, production build and scoped Biome. Actual-root real-device run `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-finish/device-acceptance/run-FuAreF` passed nine profile selections with matching knob device/profile context, five clock themes, canonical native PNG thumbnail generation, German locale context invalidation and read-only native volume acquisition. Fourteen actual-display/framebuffer pairs matched at least 95.88%; 1,260 correlated spans persisted, zero drops/storage failures, no device owner remained after exit. No OS volume writes, microphone recording or physical gestures ran. Task 5.1 stays open for focused monitor/hotkey bindings, live voice and physical focus/volume acceptance.

- 5.2, 2026-10-25: production desktop fallback now resolves directional hotkeys from the committed profile and reuses the validated hardware keyboard adapter. Sixteen focused regressions prove both HID press/release pairs, unchanged synchronize refresh, stale serial/profile/page/revision/content/hidden-key/session replacement rejection, complete-action validation, absent hardware, input mode and original native cause retention. The real makeKnobRuntime diagnostics consumer persists one correlated knob/keyboard/HID failure trace without chord or error-message text. Full desktop suite 1,466 tests, desktop typecheck, scoped Biome, production build and strict change validation pass. Actual hidden Electron root run `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-finish/knob-hotkeys/native-pRinSF` drives panel IPC focus plus both synthetic device detents to four exact fake-HID keyboard commands, then a write refusal to `QUAKE.KNOB.DISPATCH_FAILED` without moving the dial. Its 372 diagnostics records include two successful focused spans and one failed span retaining KnobDispatchFailed → HostActionFailed → HardwareUnavailable → QuakeHidWriteFailed → EACCES. Screenshot inspected. The scratch bus disables timed demo input and uses a consistent desktop-preview fake serial; root composition, profile/knob code, preload and renderer are production. No real HID, foreground input, OS volume, microphone or provider calls. First scratch attempt deadlocked by awaiting app readiness at module top level; corrected to an async entry callback before the passing run. PR delivery/review pending. Task 5.1 and aggregate bead remain open.
