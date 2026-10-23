# Design

## Context

This change specifies mode behavior, not the implementations of profile storage, host automation, Home Assistant, asset storage, or selection hooks. Normal chat is first release. Every other capability below remains later-phase and disabled until its dependencies and acceptance scenarios pass.

Approved (Ramiro, 2026-10-23): place mode contracts, deterministic validation, and mode orchestration under `packages/edge/src/chat/modes/`, using the parent ChatService and separate small conductors for analysis/generation jobs if needed. `packages/client/` consumes browser-safe Schema contracts; desktop main owns file/screenshot input and host capabilities. Register every action once with input Schema, permission `read|write|sensitive`, autonomy `auto|confirm|never`, and availability gate. Default autonomy is never. The agent runtime dispatches registry entries, never model prose. All IO/errors/Layers follow effect-conductor and open-quake-errors; AI calls use the shared Vercel facade.

## Goals / Non-goals

Goal: Make each generated candidate and executable action distinguishable and phase-gated.

Non-goal: Do not implement the owning profile, host, HA, or artwork domains in a mode handler.

## Decisions

Approved (Ramiro, 2026-10-23): the draft specifications encode the recommendations below. Supplied product direction is fixed; other design choices await acceptance before implementation. Evidence labels describe recovered observations, not approval of the proposed replacements.

### Mode and release matrix

| Recovered ID | Mode | Phase | Contract |
| --- | --- | --- | --- |
| 0 | keyConfig | Later | Generate a schema-validated layout candidate against an active-profile revision; preview then explicit apply |
| 1 | normal | First | Text streaming under `ai-chat-core`; no action execution |
| 2 | operatePC | Later | Structured host action proposals through registry and confirmation |
| 3 | operateEquipment | Later | HA entity selection then service selection; validate both against current inventory |
| 4 | pictureGeneration | Later | Explicit image-capable profile; local generated asset job |
| 5 | dataAnalysis | Later | Explicit selected files/screenshot; typed progress and local report artifact |
| 6 | videoGeneration | Later | Explicit video-capable profile; bounded asynchronous job |

The public mode IDs are strings. Import may map the seven known numeric IDs. Unknown IDs are invalid. Disabled modes return `CHAT.MODE.UNAVAILABLE` before capture, upload, or inference. Normal chat never silently becomes an action mode, and a mode change affects only subsequent turns.

### Mode outputs and actions

Approved (Ramiro, 2026-10-23): keyConfig outputs a candidate containing device identity, profile ID/revision, supported key positions, and action configs. Validate positions, uniqueness, action schemas, and supported key types before preview. Apply invokes the profile domain only after confirmation, using a revision compare-and-set. A profile change invalidates the preview. There is no direct generated HID write.

PC actions preserve the intent names openApplication, closeApplication, writeToDocument, generateReport, and executeCommand, but use structured Schema arguments. Display app target, destination, content/command, and effects before confirmation. No default shell access; executeCommand remains `never` until separately enabled. OS adapters must expose actual macOS support first and a distinct Linux availability result later. Accessibility denial is a typed host-capability failure. Proposal generation is not permission to execute.

HA control consumes the integration domain's current entity/service catalogs. First select allowed entity IDs, then allowed service and arguments. Show resolved targets and service data before registry dispatch. Expired catalogs, removed entities, and unsupported services fail before action. No global ignore-SSL-errors setting is copied.

Analysis stages are ANALYSING, DEEP_THINK, GENERATING_REPORT, REPORT_GENERATED with failed/cancelled terminals. DEEP_THINK is a progress label, never a requirement to expose private model reasoning. A generated report becomes REPORT_GENERATED only after atomic local artifact save succeeds. Model outputs remain labeled generated analysis, not verified facts. The save destination belongs to the local app data/export adapter, replacing `/resources/AnalysisData/`.

Picture, video, and emoji results use asset IDs with mime type, local storage reference, provenance, and job outcome. Validate provider capabilities and image dimensions/size before requesting profile/icon application. Emoji text edits create another candidate revision. Model job completion never applies an icon or wallpaper automatically. Video download retries must not resubmit a chargeable generation job. Approved (Ramiro, 2026-10-23): later media jobs obey the same five-minute absolute deadline; a still-running provider job is marked timedOut locally, with remote cancellation attempted when supported and no claim of remote cancellation if unsupported.

### Input extensions and phase gates

- Attachments/screenshot: require explicit picker or capture action, local preview, mime/size limits, and compatible provider. Approved (Ramiro, 2026-10-23): at most 8 inputs and 20 MiB total per turn; refuse unsupported/oversized content before upload. Cancelling a picker creates no turn. No hidden screenshot polling or temporary public upload URL.
- Web search: later opt-in registry tool with configured search adapter and source URLs. Generated text alone is never evidence that a search happened. No Firecrawl SDK dependency is mandated by recovered imports.
- Text selection: later opt-in host hook honoring excluded applications; capture begins only on user action. Delegate global hook mechanics to the host-integration lane. First release offers explicit paste.
- Live audio translation: owned by `voice-stt-tts`; separate from GT UI localization and disabled in first release.
- Emoji: later image-generation extension owned here; persistence/application goes through artwork/profile domains. Meeting minutes is section 8 and remains outside this lane.

### Errors and transport

Contracts include `CHAT.MODE.UNAVAILABLE`, `CHAT.MODE.INVALID_OUTPUT`, `CHAT.MODE.STALE_TARGET`, `CHAT.INPUT.UNSUPPORTED`, `CHAT.INPUT.TOO_LARGE`, and `CHAT.ARTIFACT.SAVE_FAILED`. Action denials retain the integration domain's stable catalog identity. A failed mode turn ends through `ai-chat-core` with exactly one terminal chunk; analysis/media progress is a separate typed job subscription keyed by turn ID. Expected job cancellation is not a generic provider failure. Persist only safe stage/outcome metadata in diagnostics, never attachments, screenshots, or generated commands.

### Evidence and deliberate replacements

Read-only root `R` is `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion`; `RS` is `R/artifacts/recovered_sources`.

- S: `RS/webpack:__dk-suite_src_main_ai_ConstantData.js:151-158`, the seven modes; `AI_SUPPORT_FUNCTIONS` at 168-173, host action intent names.
- S: the same file's `getKeyConfigBotPrePrompt` at 847 and `getGenKeyConfigLibBotPrePrompt` at 1313, active device matrix/profile inputs.
- S: `getPCOperationBotPrePrompt` at 1586, PC planning; `getHAControlPromptPhase1` at 1993 and `getHAControlPromptPhase2` at 2101, two-phase equipment flow; `getPictureDataExtractPrompt` and image_url parts at 1855 onward, vision inputs.
- S: `RS/webpack:__dk-suite_src_main_ai_AIManager.js`, ANALYSIS_STAGE at 107-112, screenshot/imports, report handling, and image/video paths. Stage names are source evidence; output correctness is not.
- S: `RS/webpack:__dk-suite_src_main_ai_Connector_QwenEmojiGenerator.js`, generation/edit client.
- N: `R/artifacts/store_keys.txt`, aiConfig.webSearch and textSelection keys; an imported search adapter proves a dependency, not full search semantics.
- S/N: `RS/webpack:__dk-suite_src_plugins_KeyConfiguration.js`, disabled live-audio-translate entries; release status remains uncertain.
- Product scope: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, section 4, First-release cut, and Later phases.

Replace prose-parsed shell commands, nut-js-specific assumptions, automatic docx generation, silent modality stripping, automatic screenshot upload, and forced Qwen sidecars with structured actions and explicit adapters. The recommended first report export is local Markdown; docx export is later and optional. These are intentional behavior changes.

## Open decisions and verification

- Approved (Ramiro, 2026-10-23): approve the phase gates, key-config revision protocol, attachment limits, Markdown report default, and five-minute media-job policy.
- Approved (Ramiro, 2026-10-23): approve registry permission/autonomy policies per action with each owning integration lane. A mode spec does not authorize a default automation library or shell tool.
- Approved (Ramiro, 2026-10-23): select later image/video/search models from capability-verified profiles, without baking current model names into this contract.

Use mock providers with actual mode dispatch and fake profile/HA/filesystem/action Layers. Prove disabled mode paths invoke none of them. Inject invalid generated structures, stale profiles/entities, denied permissions, failed atomic saves, job timeout, and cancellation. HA test-instance behavior, global selection hooks, live media models, and hardware layout application remain unverified.

## Migration and rollback

Import only known mode IDs as versioned local configuration. Keep later modes disabled and preserve an unavailable reason. Enable one mode at a time after its owning domain and acceptance evidence exist. Rollback disables new dispatch while preserving completed local reports/assets and audit outcomes; it must not replay an already applied profile/host action.

## Risks and alternatives

- Generated layouts/actions can target stale state. Schema validation and revision checks are required alternatives to parsing and immediately executing prompt text.
- A five-minute local media timeout cannot guarantee remote cancellation or billing reversal. Preserve the provider job ID locally and show unknown remote completion.
- Automatic docx export adds a conversion dependency. Start with local Markdown and add another export only when requested and independently tested.
