# Tasks

Depends on voice-stt-tts, ai-chat-core, provider profiles, and the device/profile lane's gesture contract. All implementation boxes remain open; the parent owns Beads synchronization.

## 1. First-release route contract

- [ ] 1.1 Record decisions on route migration, profile snapshots, re-press behavior, and device input generations; verify `openspec validate knob-push-to-talk --strict` and document the agreed logical gesture API without inventing HID thresholds.
- [ ] 1.2 Implement route Schemas and deterministic legacy migration/preview; verify idempotence, first-slash model parsing, explicit-field precedence, route field separation, ambiguous imports, and no credential persistence with property tests, and document migration outcomes.

## 2. First-release direct route, macOS

- [ ] 2.1 Wire the real device logical-event adapter to KnobVoiceService and direct chat; verify pinned profile/provider/model, preparing/listening feedback, final-only single submission, duplicate reports, and distinct empty/cancelled/failed outcomes with synthetic device/provider Layers, and document the flow.
- [ ] 2.2 Implement capture ownership, release-before-ready latches, same-device re-press, and cleanup bounds; verify other-device busy, stale releases/STT callbacks, profile edits/removal, disconnect, 60s automatic stop, and no late request through the actual chat consumer, and document race handling.
- [ ] 2.3 Exercise the physical macOS knob hold/release/direct-answer/audio loop when hardware and credentials are available; record press/release generation and timing evidence, and leave hardware acceptance open until actual observations exist.

## 3. Day 2 and later routes

- [ ] 3.1 Exercise Linux direct-route capture/disconnect and speech output with the same fixture suite and physical device when available; document permission/gesture gaps explicitly.
- [ ] 3.2 After agent-runtime is enabled, connect dkclaw to its pinned agent/model session; verify agent switching, reset/cancel, unsupported model, and no silent direct fallback through the real runtime consumer, and document that the name does not promise OpenClaw protocol parity.
- [ ] 3.3 Add an explicit legacyAssistant-to-direct/agent migration UI after approval; verify review/save, preserved import backup, repeat import, and no legacy execution, and document the chosen replacement.
