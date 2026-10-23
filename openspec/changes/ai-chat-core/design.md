# Design

## Context

The first release enables normal text chat, local history, streaming management/panel views, and optional speech as a separate caller. `ai-provider-facade` owns inference; this domain owns sessions and turns. It does not own HID encoders, host automation, or runtime tool execution.

Approved (Ramiro, 2026-10-23): `packages/edge/src/chat/` holds contracts, pure reducer/context invariants, repository, and ChatService. A Schema-only browser export supplies `packages/client/` with typed RPC clients and stream reducers. `apps/desktop/src/main/` provides local storage and window adapters; the renderer owns presentation and GT strings. All public service methods use Effect.fn names, explicit Effect results, declared dependencies, and app-root Layers. `@effect/rpc` is the contract source; preload validates caller, method, input, and subscription identity.

## Goals / Non-goals

Goal: Keep authoritative turn assembly and local history independent of renderer lifetime.

Non-goal: Do not couple session state to floating-window visibility or design a HID resource encoder.

## Decisions

Approved (Ramiro, 2026-10-23): all recommendations in this design are approved. Evidence labels still distinguish recovered observations from deliberate replacements. Approval does not establish live integration or hardware verification.

### Chunk protocol v1

Every accepted turn has `sessionId`, `turnId`, and immutable provider/model/mode selection. Every event has `version: 1`, `sessionId`, `turnId`, `seq`, and `type`. Sequence numbers start at zero per turn and increase by one. `answer` carries `textDelta`; concatenate it verbatim. `followUp` carries `suggestionId` and complete suggestion text; it never appends to the answer. `end` carries `outcome: completed|cancelled|failed|timedOut`, an optional stable error code, and optional reported/estimated token usage with provenance. It carries no answer delta. Each accepted turn has exactly one end, including cancellation before the first answer. Invalid requests fail before turn acceptance and produce no chunk stream.

SDK events are mapped once by ChatService, then fanned out to views. Duplicate sequence numbers are ignored. A gap pauses the local reducer and requests a snapshot containing assembled text, suggestions, outcome, and `lastSeq`; resume strictly after that position. This is synchronization, not provider replay. A subscriber queue holds at most 256 events. Overflow disconnects only that subscriber with `CHAT.STREAM.RESYNC_REQUIRED`. The authoritative turn continues and a snapshot restores the view. No durable event replay log is promised.

### Session and turn states

EMPTY means no active conversation context. ONGOING means a session has accepted input/capture preparation and has not dispatched inference. PROCESSING means inference or turn finalization owns the turn. IDLE means a finished turn retains context for another input. Text acceptance briefly enters ONGOING before PROCESSING. Voice can remain ONGOING until a nonempty final transcript arrives. Cancellation/failure before any exchange returns EMPTY; otherwise it returns IDLE. Explicit close releases active context and enters EMPTY while retaining local history. Clearing history is a separate action. App restart turns unfinished persisted requests into interrupted records and never resumes network requests automatically.

Approved (Ramiro, 2026-10-23): serialize one active turn per conversation. A second submit returns `CHAT.SESSION.BUSY`, rather than queueing an invisible request. Independent conversations may run concurrently within a configured provider limit. A route/session identifier prevents one device or assistant window from cancelling another conversation.

### Deadlines and context

Recovered constants provide 60 seconds ordinary and five minutes long. Approved (Ramiro, 2026-10-23): treat these as absolute end-to-end turn deadlines measured with a monotonic clock from acceptance. Only explicitly enabled long modes or agent runs may select 300 seconds. Direct normal chat uses 60 seconds, including provider setup. AgentService owns its outward run deadline and reuses the conversation/event contracts without nesting a direct-chat timeout around the whole tool loop. Each deadline aborts upstream work, emits one timedOut end, and excludes partial output from future model context. A timeout is never reset by a delta. Do not adopt the recovered `SESSION_EXPIRE_TIMEOUT: 100` accompanied by a contradictory five-second comment.

Approved (Ramiro, 2026-10-23): retain context until explicit close, clear, or configured idle expiry, default 30 minutes. Idle expiry releases in-memory context, not saved history. The repository atomically records the user turn, partial assistant text/outcome, and final status. Only completed user/assistant pairs enter subsequent context; failed/cancelled partial output stays visible in history with its outcome. Reset or deletion invalidates in-flight title writes and stream updates.

Budget prompt tokens before dispatch. Preserve system instructions and the new user input, reserve model output, and remove oldest complete pairs until within the configured model window. If the fixed inputs do not fit, return `CHAT.CONTEXT.TOO_LARGE` before I/O. Label approximate counts as estimates; provider usage remains reported usage. A model-specific tokenizer is optional, so `tiktoken` is not a blanket dependency.

### Desktop, panel, assistant, and locale

One assembled turn feeds the management window and the panel from `panel-window-prototype`. Simple markdown supports paragraphs, headings, lists, emphasis, and fenced code as text. Escape raw HTML. Do not execute generated commands, open files, or fetch remote images while rendering. User-activated HTTP(S) links cross a host URL validator. Streaming never steals panel scroll position when the user has scrolled away from the bottom.

Approved (Ramiro, 2026-10-23): ship management chat and the existing panel first; add an opt-in draggable/resizable assistant window later. Store window geometry locally and clamp restored bounds to connected displays. Voice capture must not require the floating window to be visible.

General Translation supplies bundled local en/de strings and source-English fallback. Settings, errors, states, controls, and tool-card chrome are localized without a runtime translation service. Locale changes update both windows; user content and generations remain verbatim. Read `app.getLocale()` only to seed a local preference, never to change provider geography. Coordinate shared GT infrastructure with its owning lane; this change specifies chat consumption only.

Approved (Ramiro, 2026-10-23): create an immediate local title from the first user message and offer optional model-generated titles later. The cited recovered title helper translates preset labels; it does not establish first-exchange summarization. Generated title failure must not fail or overwrite a renamed conversation.

### Inventory sections 4-6 ownership index

All paths below refer to sibling new change directories under `openspec/changes/`.

| Inventory item | Contract owner | Disposition |
| --- | --- | --- |
| 4: twelve engines and provider adapters | `ai-provider-facade` | Custom compatible profile first; explicit later adapters; account proxy dropped |
| 4: seven modes | `ai-chat-modes` | Normal first, six gated later modes |
| 4: streaming, states, deadlines | `ai-chat-core` | First release |
| 4: PC bot, key-config bot, HA two-phase control | `ai-chat-modes`, `agent-runtime` | Later, schema and action-registry dispatch |
| 4: analysis, screenshots, image/file input | `ai-chat-modes` | Later with explicit input and modality checks |
| 4: search and text selection | `ai-chat-modes` | Later opt-in; selection hook owned by host-integration lane |
| 4: live translate | `voice-stt-tts` | Later experiment; menu-disabled evidence does not establish a released default |
| 4: emoji generation | `ai-chat-modes` | Later generated-image asset workflow |
| 4: floating assistant | `ai-chat-core` | Optional later window; core chat does not depend on it |
| 4: title and token count | `ai-chat-core` | Local title/context budget first; auto-summary evidence qualified |
| 5: STT, TTS, recorder | `voice-stt-tts` | DashScope first; other transports later |
| 5: knob route | `knob-push-to-talk` | Direct first; agent route later; legacy migration explicit |
| 5: soundboard | `soundboard-playback` | Separate later capability; section 8 DK-Player UI remains another lane |
| 6: installer and init wizard | `agent-runtime` | Replace mandatory installation with optional local runtime enablement |
| 6: templates/catalog, switching/messages | `agent-runtime` | Later local catalog and isolated sessions |
| 6: gateway | `agent-runtime` | Compatibility gate; exact protocol unverified |
| 6: Quake bot screen, tool/link cards | `ai-chat-core`, `agent-runtime` | Simple chat first; structured tool cards later |

### Evidence and deliberate replacements

Research root `R` is `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion`; `RS` means `R/artifacts/recovered_sources`.

- S: `RS/webpack:__dk-suite_src_main_ai_ConstantData.js:145-166`, chunk kinds, mode IDs, and timeout constants.
- S: `RS/webpack:__dk-suite_src_main_ai_AIManager.js:102-112`, `startAssistantSession`, `setAssistantProcessDone`, `_handleChatResponse`, session ownership, partial responses, and saved context.
- S: `RS/webpack:__dk-suite_src_utils_quakeChatMarkdown.js`, `webpack:__dk-suite_src_utils_quakeChatMessageSegments.js`, and `webpack:__dk-suite_src_views_Components_QuakeBotIconView.vue`, rich text and scroll behavior. Hardware rendering is not proven by these files.
- S: `RS/webpack:__dk-suite_src_utils_aiChatTitleResolve.js`, preset title localization only. Inventory's automatic-title claim remains N/unverified until a summarizing call site is found.
- S/N: `RS/webpack:__dk-suite_src_views_AIAssistant_AIAssistantView.vue`, floating view structure; persisted geometry behavior is not hardware evidence.
- P/product research: `/Users/ramarivera/dev/open-quake/.context/research/general-translation-integration.md`, offline GT recipe, and `dk-suite-feature-inventory.md`, section 4 and release cuts.

Replace numeric state/IPC leakage, global assistant coupling, the contradictory 100ms expiry, raw file-link activation, and account-credit gating. Extend the recovered chunk names with explicit identity, terminal outcomes, and recovery. These extensions are proposed contracts, not recovered wire parity.

## Approved decisions and verification

- Approved (Ramiro, 2026-10-23): approve the event envelope, subscriber limit, one-turn concurrency, local history retention, and 30-minute idle expiry.
- Approved (Ramiro, 2026-10-23): approve the initial panel markdown subset and staged floating assistant/title generation.
- Approved (Ramiro, 2026-10-23): select local repository format during implementation; require atomic finalization and schema-versioned migration regardless of format.

Use fake provider/clock/repository Layers plus real preload/client reducers. Test interleaved conversations, cancellation at every state, slow subscribers, timeout boundaries, restart recovery, and locale changes. Hardware display/touch and Linux window behavior remain unverified. Source inspection and OpenSpec validation establish the plan, not functioning chat.

## Migration and rollback

Introduce versioned history alongside the current mock device event path. No recovered DK-Suite database import is promised. Enable management chat with a mock provider, then panel subscriptions, then the chosen real provider. A schema migration must back up user history and fail without partial rewrites. Disabling chat cancels active turns and preserves readable local records; it does not roll back user deletions.

## Risks and alternatives

- Durable event replay would add storage and retention complexity. Snapshot recovery is the proposed first-release alternative, with bounded subscriber queues.
- Device image transfer and physical touch remain external dependencies. Validate a synthetic panel consumer first and track actual hardware acceptance separately.
- Unlimited history can grow local storage. Make retention visible and deletion explicit; do not silently send all saved history to a model.

## W7 contract implementation

Task 1.2 is implemented in `packages/edge/src/chat/`. Protocol and reducer
usage are documented in that directory's README. ChatService dispatch,
deadlines, fan-out, persistence, RPC/preload, and presentation remain separate
tasks. The reducer enforces at most one terminal; ChatService must produce
the terminal for each accepted turn.
