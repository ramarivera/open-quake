# Design

## Context

Inventory sections 3 and First-release cut at `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md` require knob brightness, navigation, and direct push-to-talk. `RS` means `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion/artifacts/recovered_sources/`. S = recovered source, P = partial behavior, N = names only. All hardware input and brightness targeting remain unverified.

## Goals / Non-Goals

Define persistence and routing across profile changes, then expose a small voice configuration contract to the voice lane. Do not implement recording, STT/TTS, provider clients, DKClaw, or L1 wire decoding. Shared title/artwork rules come from `profiles-key-grid`; available host actions come from `key-function-library`.

## Evidence ledger

| Item | Tier | Source and observed behavior | Consequence |
|---|---|---|---|
| Knob identity and slot order | S | `RS/webpack:__dk-suite_src_utils_knobProfileSync.js`, KNOB_SUB_SLOT and createDefaultKnobResource: key 0,1, type knob, center index 0, left 1, right 2 | Preserve identity and stable slot positions |
| Three-slot editor | S | `RS/webpack:__dk-suite_src_views_Components_config_KnobFunction.vue`, props and currentKnob events | Present independent left/center/right editing, no shared mutable drafts |
| Save compaction hazard | S | `RS/webpack:__dk-suite_src_utils_knobProfileSync.js`, mergeKnobIntoConfigSaveArray uses baseSub.filter(Boolean) after index writes | New canonical saves must preserve empty positions; ambiguous compact imports need diagnostics |
| Profile synchronization | S | Same source, parseKnobEditorStateFromResource, loadKnobVoiceActionsFromConfigDetail, upsertKnobVoiceActionsInConfigDetail | Deep-copy profile-owned state, replace only reserved knob entry |
| Built-in route locks | S | Same source, BUILTIN_WHEEL_PROFILE_RESOURCE_IDS, fixedKnobVoiceRouteForProfile: 1-0..1-7 legacyAssistant, 1-8/DKClaw dkclaw; custom profiles unlocked | Compatibility metadata only; new local profiles should not inherit unavailable cloud/runtime routes |
| Voice route schema | S | `RS/webpack:__dk-suite_src_utils_knobVoiceActionSchema.js`, KNOB_ACTION_TYPES_BY_ROUTE, normalizeRoute, applyLegacyModelMigration, resolveKnobVoiceRouteConfigFromActions | direct, dkclaw, legacyAssistant have distinct allowed fields and model migration rules |
| Knob palette | P | `RS/webpack:__dk-suite_src_plugins_KeyConfiguration.js:3298`, KNOB_MENU_SIDEBAR: center brightness/assistant/HA/hotkey/media/goToPage; previous/next aliases pageUp/pageDown | Config shape is recovered; rotation direction, brightness target, and timing are not proven by those labels |
| Focused knob | P | `RS/webpack:__dk-suite_src_views_DKQuake_QuakeScreenView.vue`, checkFocusKeyValid requires supportKnob; `RS/webpack:__dk-suite_src_views_Components_config_OperationConfig.vue`, handleSupportKnobChange maintains two ordered key actions | Separate focused-key control from profile knob slots; precedence follows the approved policy |
| Direct-route UI | S | `RS/webpack:__dk-suite_src_views_Components_config_KnobVoiceChatConfig.vue` and `RS/webpack:__dk-suite_src_utils_Constants.js`, KNOB_VOICE_KEY_CODE | Voice config belongs to reserved knob; source does not fix a hold threshold for this design |

## Decisions

### Approved (Ramiro, 2026-10-23): conductor and adapter boundaries

`packages/device` owns knob-contracts, knob-invariants, knob-service, and a repository dependency shared with profiles. Declare dependencies and named `Effect.fn` methods with explicit error types. `apps/desktop` supplies the editor, decoded IPC, brightness adapter, and voice capability adapter at the app root. Use shared error-catalog leaves for InvalidKnobConfig, KnobCapabilityUnavailable, KnobRouteIncomplete, and KnobDispatchFailed with scrubbed diagnostics and private original causes. Rendering never performs raw HID or OS I/O.

`packages/protocol` remains L1's pure codec. Consume normalized `rotate(direction,detents)`, `press`, `holdStart`, `release`, and disconnect events with device/session identity. The exact event schema and hold classifier are integration contracts to agree with L1 and the voice lane, not a new wire requirement here. One normalized detent maps to one selected action; the host adapter reports capability ranges. No guessed opcodes or hold-time constant is specified.

### Approved (Ramiro, 2026-10-23): stable canonical slots and profile snapshots

Keep `config.type:'knob'`, reserved `keyCode:'0,1'`, and exactly three subActions positions. Empty positions have an explicit empty-entry object; never compact. Slots are `{childrenName,config:{type,title?,icon?,actions,...validated function fields}}`; nonempty slot validators come from the registry. Keep a profile-level knob instead of duplicating it across pages. A legacy flat import extracts its knob entry, preserving original metadata.

Save expected revisions through the profile conductor. On selection change, read the new committed knob snapshot and cancel active work from the old profile. Do not carry UI slot objects or last-profile actions into the new profile. The alternative, a global shared knob object, contradicts recovered per-profile resources and can route speech to the wrong agent.

### Approved (Ramiro, 2026-10-23): rotation, brightness, and navigation

Priority is an explicitly focused visible key with supportKnob and two validated directional actions; otherwise the matching left/right profile slot; otherwise a center function that declares rotation support. Empty or unsupported slots do nothing and report unavailable where appropriate. Left means normalized counterclockwise and right means clockwise; L1 proves the physical direction mapping. Press is center only. When short press and hold share the center, delay short-press dispatch until release is classified short; raw press cannot preempt a later voice hold. Selecting a center brightness mode does not cause brightness changes on press.

Use canonical `panelBrightness` with one `stepPercent` action, initially 5. Counterclockwise subtracts and clockwise adds, clamped to a verified adapter's 0..100 logical range. This approved normalized API does not establish a firmware scale. Recovered luminance and brightness labels are ambiguous, so do not automatically map either to panel, host screen, or RGB brightness. Before first-release activation, L1/desktop must identify the actual panel brightness mechanism and document conversion/readback. If unavailable, keep the setting editable but report capability unavailable. `device-lighting-config` owns RGB separately.

Navigation slots reference canonical previousPage, nextPage, and goToPage from the profile contract. Legacy pageUp/pageDown aliases normalize only in navigation context. There is no wrapping; page boundaries follow `profiles-key-grid`.

### Approved (Ramiro, 2026-10-23): voice configuration and lane handoff

New voice assignments use explicit direct route with required provider/model references. Credentials remain in the provider configuration owned by the AI lane, never in profile actions. A normalized holdStart invokes voice capture once with `{deviceId,profileId,revision,route,providerId,modelId}`. Release ends that same capture. The voice lane owns hold classification, mic permissions, recorder outcomes, transcription, streaming, and speech output. Disconnect/profile change cancels capture and prevents a late release from starting anything in a new profile.

The recovered route field sets are preserved below. Legacy migration splits `provider/model` at the first slash, fills only missing route-specific fields, removes the old model action, then strips actions not allowed for the explicit route. Route absent or legacy/assistant aliases normalize to legacyAssistant for imported data only. Unknown route values are diagnosed rather than silently enabling a legacy service. Built-in route locks are preserved as compatibility metadata, not enforced against new custom profiles. dkclaw and legacyAssistant remain unavailable without their later runtimes; do not redirect them to direct automatically.

### Approved (Ramiro, 2026-10-23): import ambiguity

Known center-only recovered presets occupy slot 0. Three-position exports with explicit holes preserve their positions. A compact two-entry array without reliable slot metadata cannot prove whether its second item was left or right; retain it as unsupported compatibility data and ask for explicit slot assignment in the editor. Do not reproduce the recovered filter(Boolean) save defect.

## Risks / Trade-offs

- Brightness labels can select the wrong target. Keep panel/host/RGB capabilities distinct and block application until the adapter is verified.
- Profile switches race with capture and detents. Snapshot per normalized event, cancel old capture by session identity, and test the real desktop consumer.
- Import cleanup can lose user values. Retain the source backup and migration diagnostics, and prove normalization is idempotent.

## Migration plan

Extract a legacy reserved entry into profile.knob, decode known aliases, normalize explicit routes, and preserve unsupported slots/routes without dispatch. Publish one profile revision. Roll back to the untouched import on failure. No existing application persistence is modified by these planning artifacts.

## Approval and remaining verification

Approved (Ramiro, 2026-10-23): all recommendations previously marked Proposed (pending Ramiro), including slot sentinels, routing precedence, normalized panel brightness and its 5-point step, direct-route defaults, and ambiguous-import handling. Approval settles product policy; the normalized percentage API does not establish a firmware scale.

The module's normalized event contract is documented in `packages/device/src/knob/README.md`. L1 and voice integration remains to be verified. Actual physical direction, press/hold/release, device account independence, panel target, brightness scale, and hardware readback are unverified.
