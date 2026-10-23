# Design

## Context

Key `0,1` is the recovered logical knob voice key. The source establishes routes and migration, but it does not prove physical hold thresholds or live press/release timing. `packages/device` owns raw events and gesture recognition; this domain consumes a logical hold-start/release/cancel event with device identity. Synthetic events can prove routing before hardware is available.

Approved (Ramiro, 2026-10-23): place action contracts, migration invariants, and KnobVoiceService in `packages/edge/src/voice/knob/`. The profile domain stores configuration; `packages/client/` and desktop renderers expose route settings/status. KnobVoiceService composes VoiceService, ChatService, and later AgentService through declared dependencies and Layers, using named Effect.fn methods and shared catalog errors. Do not make device/protocol packages import AI or Electron. Use Schema-first RPC/preload contracts for UI settings and status.

## Goals / Non-goals

Goal: Correlate one logical gesture generation with one capture and at most one answer turn.

Non-goal: Do not guess physical hold timing or decode HID inside the voice service.

## Decisions

Approved (Ramiro, 2026-10-23): the draft specifications encode the recommendations below. Supplied product direction is fixed; other design choices await acceptance before implementation. Evidence labels describe recovered observations, not approval of the proposed replacements.

### Route schema

Version 1 route configuration is a discriminated union:

- direct contains providerId and modelId, referencing a configured profile/model. It is the only enabled route in first release.
- dkclaw contains agentId and modelRef. Persist the legacy name for import compatibility; it targets the chosen open-quake agent backend and does not promise an OpenClaw wire protocol.
- legacyAssistant contains an opaque legacy assistant payload and migration status; preserve it for review, but do not execute it in first release.

Approved (Ramiro, 2026-10-23): public direct configuration resolves a provider profile ID, rather than a hardcoded provider name. For compatible imports, resolve a legacy provider name to an explicit local profile or mark needsConfiguration. No persisted route includes API keys. Save only fields allowed for the selected route; changing routes removes irrelevant fields from the runnable config while retaining an explicit import backup for user review.

Unknown route values are invalid. Missing route in imported data is classified as legacyAssistant/needsMigration, not silently treated as direct. Legacy aliases assistant/legacy normalize only within the importer. A legacy `model` is split at the first slash for direct provider/model, preserving further slashes in model IDs, or carried as dkclaw modelRef. Explicit route-specific values win over legacy fields. A direct import lacking an unambiguous provider profile remains needsConfiguration. Migration is deterministic, idempotent, and locally previewed before save.

### Press-to-answer lifecycle

At hold-start snapshot deviceId, keyCode, profileId/revision, route, provider/model or agent ID, and a fresh captureId. Validate availability/credentials before requesting the mic. Route edits/profile switches never reroute an in-flight capture. Show preparing until VoiceService enters listening; no audio is captured before ready. Emit one logical release to the owning capture, regardless of duplicate hardware reports.

Release in listening flushes nonempty audio and waits for one final transcript. Submit that transcript exactly once using the pinned route, then let the chat/agent session stream the answer and optionally TTS it. Provisional STT never dispatches a turn. Empty capture or empty final transcript ends locally without inference. Release before listening cancels and prevents late setup from starting the mic.

Approved (Ramiro, 2026-10-23): one global mic owner. Another device's hold-start while busy returns `VOICE.KNOB.BUSY`. A new hold-start from the same device cancels its prior capture/turn and any assistant speech, waits for cleanup acknowledgement up to two seconds, then creates a fresh capture. If cleanup fails, fail busy rather than run concurrent captures. A release includes its originating input generation; a late release from the prior capture must not stop the new one.

Disconnect/profile removal/app shutdown cancel owned capture, route request, and speech. A different device's disconnect has no effect. Profile edits retain the pinned snapshot; deleting the active profile cancels it. A disabled dkclaw route or legacyAssistant migration error happens before mic capture and never falls back to direct chat.

### Deadlines and state

Reuse VoiceService setup/listen/final-transcript deadlines. The recognition phase and response phase have separate clocks. Chat starts its 60s deadline only when the final transcript is accepted. No physical hold is indefinite; listening ends at 60s even without release and submits the nonempty capture once. After automatic stop, a late release is ignored. Route states are idle, preparing, listening, transcribing, responding, completed, failed, cancelled, and empty. These are UI states; ChatService retains its own four-state session model.

Catalog leaves include `VOICE.KNOB.ROUTE_INVALID`, `VOICE.KNOB.ROUTE_UNAVAILABLE`, `VOICE.KNOB.NEEDS_MIGRATION`, and `VOICE.KNOB.BUSY`; failures from speech/chat retain their original leaf identities. Trace the input generation, capture, transcription, and response under one correlation ID without logging serial numbers, transcript content, or credentials. Device identity exposed in diagnostics is an opaque local ID.

### Evidence and deliberate replacements

Read-only root `R` is `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion`; `RS` is `R/artifacts/recovered_sources`.

- S: `RS/webpack:__dk-suite_src_utils_knobVoiceActionSchema.js`, `0,1`, three routes, allowed fields, first-slash parsing, legacy model migration, and legacyAssistant default.
- S: `RS/webpack:__dk-suite_src_views_Components_config_KnobVoiceChatConfig.vue`, route picker and profile actions.
- S: `RS/webpack:__dk-suite_src_main_ai_AIManager.js`, `prepareOneTimeVoiceSession`, `finishOneTimeVoiceSession`, `startAssistantSession`, request-ID guards, and reset without stopping a new recording.
- S: `RS/webpack:__dk-suite_src_views_AIAssistant_AIAudioHandler.vue`, pendingStopRequestId, stop-before-ready handling, empty/cancelled recorder signals.
- P/product: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, section 5 and First-release cut.

Replace silent unknown-route fallback, default agent `main` when an imported ID is ambiguous, implicit account gates, and uncorrelated StopAudioRecord broadcasts with explicit migration states and capture identities. Do not invent raw HID hold thresholds; coordinate the device lane's event contract before implementation.

## Open decisions and verification

- Approved (Ramiro, 2026-10-23): approve strict route import behavior, profile snapshots, same-device re-press cancellation, and two-second cleanup bound.
- Approved (Ramiro, 2026-10-23): use device-domain gesture events with a generation ID. If the SDK cannot expose one, implement correlation in the device event adapter, not by guessing capture IDs in the renderer.
- Approved (Ramiro, 2026-10-23): keep legacyAssistant importable but non-executable; offer an explicit migration preview to direct/agent configuration.

Property-test migration idempotence and route field separation. Drive synthetic hold/release through the real device event adapter, voice service, chat consumer, and playback adapter with injected providers. Race-test early release, double reports, automatic stop, disconnect, profile edits, and stale STT callbacks. All physical knob gestures, audio routes, timing, device detach behavior, and Linux permissions remain unverified.

## Migration and rollback

Preview imported routes before saving version 1 and retain an explicit local backup of the original action data. Enable synthetic direct-route events before physical gesture bindings. Rollback disables the voice action and preserves the user's profile data; it must stop owned capture/response work and must not reactivate an unverified legacy assistant.

## Risks and alternatives

- Device reports without a generation ID permit stale releases to cancel a new capture. Require a correlated logical input adapter before shipping re-press behavior.
- Strict import validation can require manual repair where DK-Suite defaulted to legacyAssistant. The explicit repair state avoids invoking an unintended model or agent.
- A global mic owner limits concurrent devices. Queueing hidden captures was rejected because a delayed start could record after the user released.
