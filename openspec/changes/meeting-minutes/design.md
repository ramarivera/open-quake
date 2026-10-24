# Design

## Context

See proposal.md for the capability boundary. This implementation follows the recovered 0.4.95 behavior; every product choice below marked "Approved (Ramiro, 2026-10-23)" was accepted by Ramiro on that date. The delta spec records the recommended acceptance contract, not existing implementation or verified hardware parity.

Inventory: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, sections 7–9, Later phases and the cited open questions.

## Evidence and source paths

Path roots are local-only, read-only research inputs. S means recovered source for the stated behavior, P means partial analysis/dependency evidence, and N means name-only evidence. Source availability does not prove runtime or hardware success. Replacement limits and new failure behavior are proposed, not recovered facts.

- ATLAS = `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion`
- ART = `ATLAS/artifacts`
- RS = `ART/recovered_sources`

- **S** `RS/webpack:__dk-suite_src_views_AIAssistant_MeetingMinutesRecorder.vue`: meeting-minutes-start, mic/system audio streams, Opus MediaRecorder chunks, stop/finalization and device-change cleanup.
- **S** `RS/webpack:__dk-suite_src_views_Setting_MeetingMinutesHistory.vue`: history, transcription/minutes display, retry/delete and copy behavior.
- **S** `AI-136`, `AI-292`, `AI-327`: `v0.4.95/recovered_sources/src/utils/DefaultProfileData.js:2036-2200` ships liveAudioTranslate and liveAudioTranslateDisplay in Meet AI. `MeetingMinutesRecorder.vue:661-805` captures system PCM for translation. The commented library entries in `KeyConfiguration.js:437-462` do not disable those shipped profile keys.
- **S** `AI-315`: `v0.4.95/recovered_sources/src/views/Setting/MeetingMinutesHistory.vue:1590-1612`, exportSummary selects `.md` for raw Markdown summaries and `.txt` for plain transcripts, sanitizes filenames, and downloads UTF-8 text. Generic document generation in AIManager is a separate feature.
- **N** `ART/ipc_channels.txt`: generate-meeting-minutes and meeting-minutes-start entry names.

## Goals / Non-Goals

Goals: give implementers one owned contract, observable failure states and a verification path for this capability.

Non-goals: profile catalog ownership, new dependencies, changes to other lanes' artifacts, guessed device opcodes, or claiming unresolved integrations work.

## Package ownership

`packages/edge` meeting contracts, repository, lifecycle invariants and conductor; the Schema-first desktop meeting bridge (no HTTP transport); `apps/desktop` capture/permission, local files, export adapters and history/capture UI. AI/speech lanes own provider facades; panel animation consumes meeting state through existing display delivery.

Approved (Ramiro, 2026-10-23): keep domain modules in the existing packages rather than adding feature packages now. In `packages/edge`, each domain separates contracts, pure invariants, repository interfaces and an Effect.Service conductor. Electron-specific APIs live in `apps/desktop/src/main` adapters supplied at the composition root; renderers consume a narrow Schema-validated preload bridge. `packages/protocol` stays pure; `packages/device` owns hardware I/O. `packages/cli` is an optional client, not another domain owner.

Native control contracts are Schema-first `@effect/rpc`; external third-party protocols stay boundary adapters. Services declare dependencies, use named `Effect.fn` methods with explicit success/error types and scoped cleanup. User/automation actions have one capability-registry declaration. UI never calls raw SDKs. AI calls, where needed, use the existing Vercel AI SDK Effect facade and mocked providers in CI.

## Decisions

1. Approved (Ramiro, 2026-10-23): one user-visible capture session at a time. Microphone is required; system audio is optional and requires an explicit choice of available source.

2. Approved (Ramiro, 2026-10-23): preserve transcript when summarization fails, and retry only the failed stage. Provider output is labeled generated and is editable/exportable without being represented as a verbatim transcript.

3. Approved (Ramiro, 2026-10-23): live translation ships in 0.4.95 through Meet AI (`AI-136`, `AI-292`, `AI-327`). Include the explicit toggle and system-audio route; `voice-stt-tts` owns provider/language selection and cancellation. Commented library entries do not justify deferring the shipped route.

4. Approved (Ramiro, 2026-10-23): keep finalized recordings locally until the user deletes the meeting; partial buffers are removed after cancel. Export raw summary Markdown as `<safe-title>-summary.md` and plain transcript as `<safe-title>-transcript.txt` (`AI-315`), with UTF-8 encoding and illegal filename characters replaced by `-`.

### Data model

Approved (Ramiro, 2026-10-23): MeetingRecord carries stable ID, title, timestamps/duration, capture source metadata, stage state, local audio/transcript/minutes resource references and failure stage. Meeting UUIDs correlate capture callbacks; hourly segment numbers and serialized writes order finalized chunks. Monotonic snapshot revisions reject stale IPC replies. Generated minutes carry provider/model provenance distinct from transcript text.

### Data flow and lifecycle

Approved (Ramiro, 2026-10-23): Explicit start acquires selected capture sources in desktop adapters; the meeting conductor owns the lifecycle. Stop closes tracks and finalizes chunks once, then speech and AI facades process stages. The repository commits transcript before generation. Retry restarts only a failed stage. History and panel status use the same meeting state, while export reads a selected saved artifact and writes a user-selected file.

### Failure contract

Approved (Ramiro, 2026-10-23): use operation-specific catalog leaves, initially QUAKE.MEETING.CAPTURE_DENIED, QUAKE.MEETING.SOURCE_LOST, QUAKE.MEETING.TRANSCRIPTION_FAILED, QUAKE.MEETING.GENERATION_FAILED and QUAKE.MEETING.EXPORT_FAILED. Final code names must be reconciled with the shared catalog before implementation; never introduce a second catalog. Each leaf is a catalog-derived Schema.TaggedError with private original cause and bounded, scrubbed diagnostic projection. Consumers branch on tag/code, never text. Verify exact identity, cause retention, safe serialization and broken-dependency paths through real consumers.

## Recommended phase and dependencies

Later phases item 3, soundboard/DK-Player and meeting minutes, after speech and chat provider interfaces. Physical trigger parity still requires device verification.

Dependencies are contracts supplied by their owning changes. An unavailable dependency yields an explicit unavailable state; this change does not duplicate its implementation or modify its specs.

## Risks / Trade-offs

Audio acquisition differs per OS and recording is sensitive. Require explicit source selection, release tracks on every terminal path, and keep content out of logs. The 0.4.95 history source proves Markdown/plain-text export (`AI-315`). Live translation has an unbounded-text bug (`AI-338`); retain bounded display history rather than copying that bug.

The proposed package placement keeps current workspace boundaries but grows `packages/edge`; retain cohesive domain files and split a new package only when ownership or dependency constraints justify it. No npm dependency is selected here; future dependency proposals must name exact versions and approval needs.

## Migration plan

Create versioned local settings/repository records behind a capability gate. Validate imported shapes before writing and preserve the last valid snapshot on failure. Enable only the verified capability subset after its acceptance scenarios pass. Roll back by disabling the capability and retaining readable user records; destructive native side effects need their own recovery flow.

## Verification and outstanding evidence

With fake capture/provider/file adapters, drive the real recorder and history consumers through duplicate stop, source removal, summary failure, retry, restart and delete. Read exported `.md` and `.txt` fixtures independently as UTF-8 and compare them with the selected saved artifact; cover filename sanitation and write failure. Native system-audio capture, paid providers and physical start triggers remain unverified.

Implementation closure requires scenario evidence and parent-managed Beads updates. Tasks close only with implementation and verification evidence. Do not launch DK-Suite; use independent fixtures and the open-quake application for future verification.


## 0.4.95 implementation decisions and source evidence

Research root: `/Users/ramarivera/dev/dark-encyclopedia/dk-suite-introspeccion/v0.4.95/`.
Read `recovered_sources/src/views/Components/MeetingIconView.vue:1-127,699-976`,
`MeetingOneCellIconView.vue:631-704`, `LiveTranIconView.vue:6725-6980,8731-9380`,
the four animation components, `views/Setting/MeetingMinutesHistory.vue:300-323,1590-1612`,
`main/ai/Connector/QWenAdapter.js:452-647`, and `main/ai/AIManager.js:1946-2146`.
The minified main bundle anchors `regenerate-meeting-summary`, `project-weekly`,
`merge-audios`, and `meetingRecordMark` supply the missing main-process contracts.
English copy comes from `locales/locale-en.json`.

- AI-263/264/290: side records share owned streams, have parent IDs including zero,
  and never stop the main tracks. Stop closes side records and open marks.
- AI-269/270/272/274/275: the AI facade owns injected async ASR/translation ports.
  DashScope file ASR model is `qwen-audio-3.0-asr-flash-filetrans`, mono channel `[0]`
  with diarization, 10 s polling and cancellation, 48 h upload expiry.
  OpenAI file realtime model is `gpt-realtime-mini`; timeout is
  clamp(180 s, duration/2 + 180 s, 1800 s). DashScope timeout is
  max(180 s, 1.5 * duration + 120 s). Minutes use selected explicit profile/model,
  with recovered Qwen default `qwen3.6-flash`, output language independent of UI locale.
  No vendor gateway, OSS credentials or implicit sidecar is introduced.
- AI-275/277/296/312: exactly project-weekly, standard, executive, interview.
  Regenerate commits new summary, provenance and applied template together after success.
  Failed regeneration retains the prior summary. This fixes DK's unsaved output bug AI-277.
- AI-280-294: mic permission precedes capture. Optional system audio requires an explicit
  choice and screen permission; no silent fallback or BlackHole installer.
  Browser MediaRecorder supplies Opus webm every 10000 ms, hourly segment rotation.
  Main's ffmpeg adapter mixes to 48000 Hz signed-16 mono MP3 using an existing configured
  executable. Missing ffmpeg is an explicit unavailable dependency, never installed.
  Live translation takes system PCM 24000 Hz mono s16 every 300 ms.
- AI-318-341, WIDGETS-097-100: registry tiles keep 236/4/2 px meeting geometry,
  radius 24, Start 1x2, viewer 5x2. Keys enforce 5000 ms cooldown on the main clock.
  The viewer has three tabs, separate font offsets -10..20 step 2, 300 px scroll,
  1200 ms long press, 344/44 px toolbar, dock, clear, copy and summary/transcript swipe.
  Timer uses persisted start time and a 100 ms display tick. Four source-inspired
  animations honor reduced motion; success lasts 5000 ms with 35 fireworks.
  Existing hardware snapshots supply authoritative mic state through the meeting bridge, because panel windows cannot access management-only hardware IPC. AI-341 tone call sites are commented out in 0.4.95; no speculative tone codes are added. The current main ToneName union has start/end/error/busy/preview, without the advertised MM_FIREWORK/MM_SUCCESS patterns.
- AI-338: translation is capped at 200 paragraphs and 64000 characters, 4000 characters
  per update, replacing interim results by segment ID. Timeline holds at most eight slots,
  spaced at least 3000 ms; update speed becomes idle after 5000 ms.
- AI-299-317, SETTINGS-105-107: history uses the recovered three-pane responsive layout,
  literal search, per-task health, editable title, confirmed cascading deletion,
  summary/transcript tabs and .md/.txt export. Model text is escaped, never HTML-injected.

## UI contract

Use the existing management theme tokens and form/button vocabulary. History prioritizes
meeting list, selected document, then task health/templates. At 980 px the inspector moves
below the document so every action remains reachable. The strip uses the recovered dark
meeting palette and cyan active states. Empty, permission, unavailable-provider, processing,
failed, generated, copying/export errors, and reduced-motion states remain visible.
Native mock smoke renders the real preload, renderer and meeting registry, exercises actions,
and captures idle/recording/processing/failure/success/translation/history states.


## Implemented boundary and acceptance limits

`AiMeetingAdapter` is the smallest provider-owned port added to the existing AI facade:
submit/poll/cancel file ASR, translate PCM, and stop translation. `audioRef` is a meeting UUID;
the composition root resolves it under `<userData>/meetings-v1/<uuid>/final_recording.mp3`.
The desktop registration accepts an adapter; production has no live adapter until the provider
lane supplies one. Missing translation dependencies fail before acquiring system audio.
Microphone recording/history remain usable offline. Non-mock configuration rejects fake ASR
and deterministic summary models; an explicit profile whose model matches is required.
Native mocks never capture hardware or call a paid provider.

Configuration applies to new sessions in the running app; each saved record retains its own
configuration and summary provenance. Current-session configuration is not a persistent
provider catalog. The existing provider lane owns credential/profile persistence.
The adapter uses an already-installed `ffmpeg` executable (`OPEN_QUAKE_FFMPEG` overrides it);
it installs no dependency. Raw source chunks remain available after failed finalization, and
retry attempts finalization before ASR. Only explicit deletion removes finalized audio.
Translation frames and queued audio writes are bounded; translation capture owns its stream
independently when started before microphone recording.

Verification commands, native screenshots and exact acceptance limits are recorded in
`apps/desktop/src/main/meetings/README.md`. Physical QUAKE/touch triggers, OS audio permissions,
system loopback and paid provider behavior require lead-owned verification.


## Review round 1 recovery decisions

Capture has separate drain and finalize operations. The conductor drains all main/side
recorders before any conversion and records individual failures while continuing cleanup.
Shutdown drains with chunk IPC still registered. Normal shutdown saves end times; legacy
unclean exits derive duration from finalized MP3 frames before ASR. Deletion stages UUID
folders under .deleting before history commit and recovers them by history membership at
startup. Committed deletion garbage is collected independently of the history transition.
Private output files are created before ffmpeg opens them; exports use same-directory
private staging and rename. Trusted capture URL/frame checks apply to permissions, replies,
chunks and PCM; navigation/crash revokes authority and clears owned sources.
