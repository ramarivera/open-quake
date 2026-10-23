# Design

## Context

Inputs are inventory section 3, First-release cut, Later phases, and open question 10 at `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`. `RS` below means `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion/artifacts/recovered_sources/`. S is recovered source, P is partial evidence, N is naming only. Tier S does not mean a host action or device behavior was tested.

## Goals / Non-Goals

Make editor options, action validation, artwork, and runtime dispatch agree. Use the common key schema in `profiles-key-grid`. AI, audio playback, monitor sampling, Home Assistant, camera, printer, and plugin runtimes belong to their respective later domains; this library records their availability rather than implementing them.

## Evidence ledger and catalog coverage

Every row below is S for catalog structure in `RS/webpack:__dk-suite_src_plugins_KeyConfiguration.js`, `ALL_MENU_SIDEBAR`, `MULTIACTIONS_SIDEBAR`, or `KNOB_MENU_SIDEBAR`. Runtime semantics remain P unless the cited consumer establishes them. These rows account for the entire section 3 submenu inventory.

| Submenu / entries | Source details | Release and owner |
|---|---|---|
| shortcut: website, hotkey, text, open | Lines 507-663 define url, key, text plus optional enter, and path actions | First release, action conductor and desktop OS adapters |
| multiMedia: playPause, stopPlay, skipBackward, skipForward, fastBackward, fastForward, repeatPlay, randomPlay | Lines 1101-1295 define audio key values; skipForward incorrectly declares config.type skipBackward while value is audio_next | First release when host adapter supports each command; canonical identity follows function name and validated audio value |
| decoKeeAI: luminance | Lines 73-98 contain two ordered level actions and supportKnob true | First-release knob panel brightness candidate; target semantics remain P and are resolved in `knob-configuration` |
| deviceControl: brightness, vol, mute | Lines 891-982; brightness uses level actions, vol uses audio_vol_down/up, mute has alternate state | Knob panel brightness first; host screen brightness/volume/mute later unless explicitly supported |
| navigation: goToPage, previousPage, nextPage; switchProfile, pageNo | Grid sidebar entries are commented at lines 985-1097; knob submenu is active at lines 3432-3550 with pageUp/pageDown aliases | Page actions first release under profile conductor; cross-profile switching and pageNo later |
| shortcut: close, playAudio, playAudioLegacy, stopAudio, multiActions; delayed in MULTIACTIONS_SIDEBAR | close has path and force; audio has sound/audioAction/audioFade/volume; composite stores subActions; delayed maps to config.type delay with time 1000 | Later, host app adapter, audio lane, and composite action conductor |
| decoKeeAI: timer, buzzer, mic, createFolder, homeAssistant | timer has time/sound/callback; toggles have ordered toggle actions and alternate visuals; createFolder maps to folder; HA uses configData | Later, timer/device preference/profile/HA domains |
| decoKeeAI: clawbot, aiChat, aiChatView, ClawBotView, ClawBotInput, VoiceBot | Config types include clawbot, aiChat, aiChatView, quakeBot, quakeBotInput, audioBot | Later AI and DKClaw domains; basic first-release direct knob voice config belongs to voice lane |
| deviceControl: cameraView, cameraControlView, printerStatusView | Camera actions include MJPEG/RTSP/proxy and printer association fields | Later integration domains; no first-release network activity |
| system: cmd, cpuInfo, gpuInfo, memInfo, diskInfo, processInfo, networkInfo, bluetoothInfo, powerInfo | cmd carries text; monitor tiles carry no initial actions | Later shell/monitor domains, not inferred from icon names |
| shortcut: hotkeySwitch | Commented catalog entries at lines 530-565 and 1674-1709; two key actions and alternate artwork | Unresolved, retained inactive; see question 10 below |

Additional source evidence:

| Item | Tier | Source | Consequence |
|---|---|---|---|
| Operation editing | S | `RS/webpack:__dk-suite_src_views_Components_config_OperationConfig.vue`, hotKeyChange, handleSupportKnobChange, handleCheckbox: hotkey uses one key action or two when knob enabled; text checkbox adds enter or an empty object | Normalize the empty object to absence |
| Hotkey representation | S | `RS/webpack:__dk-suite_src_plugins_hotKeyFun.js`, transferKeyName and handleKeyUserInput: lowercase key names, plus-separated modifiers, localized placeholder rejection | Persist machine names, never translated capture prompts |
| Shared title and timing editor | P | `RS/webpack:__dk-suite_src_views_Components_OperationConfiguration.vue`, pressTimeChange and gap controls | Fields exist, but timing units and execution rules are not established here; preserve imported values, defer execution |
| Function-specific rendering | P | `RS/webpack:__dk-suite_src_views_Components_UnitControl.vue` dispatches config types; `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion/artifacts/ipc_channels.txt` lists runtime events | Render only implemented families; component names do not prove OS/device effects |
| Library and grid | S | `RS/webpack:__dk-suite_src_views_Components_ShortCutLib.vue` and `RS/webpack:__dk-suite_src_views_Components_ShortcutGrid.vue` | Assignment is a deep copy; editing a tile cannot mutate a catalog template |

## Decisions

### Approved (Ramiro, 2026-10-23): one registry and platform adapters

`packages/device` owns action-contracts, action-invariants, and an action-service `Effect.Service`. Each registry entry declares stable ID, legacy names/config-type aliases, submenu, action Schema, supportKnob/supportTouchEffect, alternate-state support, default editable fields, release availability, permission, autonomy, and required adapter capability. Default autonomy is never; explicit configured user input can invoke an available action through the conductor. Agent-facing permission policy is a future consumer, not a dialog added to every key press.

`apps/desktop` supplies OS keyboard, text insertion, URL opening, and application launch adapters behind interfaces and a single main-process composition root. Renderers select functions and show results through decoded IPC; they cannot directly import host automation SDKs. `packages/protocol` is only L1's pure input codec. A hotkey is a host action, not an invented HID output command. A separate registry in each UI was rejected because imported aliases and supported functions would drift.

Methods use named `Effect.fn`, explicit success/error types, and catalog-derived errors. Proposed error identities include InvalidKeyAction, KeyFunctionUnavailable, HostActionFailed, and ArtworkLoadFailed, each with a distinct stable code and handling policy. Scrub text, URLs, app paths, and imported action values from diagnostics; retain original causes privately. Register contracts before future RPC handlers and derive client methods from them.

### Approved (Ramiro, 2026-10-23): first-release payloads and dispatch

The spec fixes exact leaf action records. New hotkeys use plus-separated lowercase key names with a finite platform-supported token set; the adapter exposes its supported keys. Preserve left/right modifier distinctions where supported. Reject empty chords and capture placeholders. Text defaults to no implicit enter in new open-quake keys, even though recovered defaults include enter. This avoids accidental submission and remains explicitly editable. It is a product recommendation, not a recovered default.

Normalize the recovered skipForward type defect only when childrenName skipForward and action key audio_next agree. Do not globally rename every skipBackward to skipForward. Store canonical type skipForward for new records and keep the original in import metadata. Media support is per command; unsupported repeat/random actions stay unavailable rather than reporting false success.

Only a committed profile snapshot and explicit normalized activation can execute a host action. Catalog browsing, preview rendering, drag/drop, import, and save do not execute. A normal tile press executes once, release performs cleanup only, and hardware repeats need their own event contract. Do not guess repeat or long-press semantics from gap/pressTime names.

### Approved (Ramiro, 2026-10-23): open question 10, hotkeySwitch scope

Keep hotkeySwitch out of the first-release picker and runtime. Retain two key values and alternate visuals on import as unsupported compatibility data. OperationConfig proves two editable chords; it does not prove alternation, held-key latching, persistent toggle state, reset behavior, or release semantics. A plain two-chord hotkey with knob support is a different function and must not be migrated into hotkeySwitch.

Before enabling it later, inspect the host execution path and test consecutive presses, press/release, profile change, reconnect, app restart, and each alternate visual. Recommend per-profile, in-memory alternation reset on activation only if those checks support it; that behavior remains pending Ramiro and evidence. Implementing a guessed toggle now was rejected.

### Approved (Ramiro, 2026-10-23): later functions and artwork

Keep unavailable catalog entries visible with a phase/dependency reason or in a later-functions filter. They cannot be assigned as executable until schemas and adapters exist. Implement multiActions later as an ordered, non-recursive list of validated leaf actions and delays, stop on the first failure, and never replay after reconnect. Delay values are nonnegative integer milliseconds. Deeper macro recursion and repeat timing require a separate decision.

Artwork belongs to local asset references or user imports, with shared rendering in management and panel. Do not bundle recovered DK-Suite icon packs. Live monitor/AI/camera renderers subscribe only when their owning runtime exists. Missing artwork shows a labeled fallback and cannot change action payloads. Theme and motion requirements remain owned by `theming-animation-contract`.

## Risks / Trade-offs

- Host automation may need OS permissions. Report unavailable/denied through the real adapter and retain configuration; mocks cannot establish macOS permission behavior.
- Duplicate type names and empty action objects complicate imports. Use narrow, diagnostic migrations with fixture tests and retain originals.
- Catalog-only parity can look like implemented parity. Availability and release/dependency labels are mandatory and runtime rejects unavailable IDs.

## Migration plan

Validate selected imports without running them, normalize only documented aliases/empty sentinels, preserve unknown records, and save into the new local envelope with a backup. No automatic import of account tokens, API keys, or proprietary asset packages. Gate new functions by registry capability so rollback disables execution without losing saved payloads.

## Pending decisions and verification

Ramiro must approve first-release action policies, text's default enter behavior, hotkey token/platform support, and question 10's deferral. Host effects, unsupported media commands, and imported proprietary runtime behavior remain unverified. Later backend registration requires its own scenario evidence before an entry is marked available.
