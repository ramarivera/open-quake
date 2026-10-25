# Design

## Context

Bridges available to the renderer, unchanged:

- `window.quakeChat` (direct): submit/subscribe/snapshot/cancel/clear/rename/list. History
  carries title, manualTitle, updatedAt, turns with status, snapshot text, suggestions,
  terminal outcome, errorCode and usage.
- `window.quakeAgentConnections`: list/save/select/test/discover/remove. The view has
  connections (name, kind, baseURL, credentialAvailable) and `selected` (connectionId,
  agentId). Selection routes QUAKE typed and voice requests (main `voice-adapter`). With
  no selection, requests use the direct chat service.
- `window.quakeAgentConversations`: start/history/clear/cancel plus an event stream with
  text, status, tool, usage and end events. There's no rename and no remote session
  deletion.
- `window.quakeAgents`: local library, model rows (provider, model, role,
  credentialAvailable), skills, panel slots and runtime state.

Visual tokens and shared controls come from the design lead brief
(`DESIGN-BRIEF.md` / `design-system.json` in the redesign scratch, nyd.2): `--oq-*`
tokens, `.mc-button` variants, `.mc-field`, `.mc-tabs`, `.mc-badge[data-tone]`,
`.mc-card` as the single bordered container, and `.content-inner[data-layout=full]` for
the agents page.

## Goals / Non-Goals

Goals: one coherent conversation workspace that works at a 390px viewport and in every
theme, with truthful identity/status, capability-gated controls, safe markup, and
existing controller race guarantees.

Non-goals: new IPC, remote session listing, runtime rename, agent catalogs where
discovery doesn't report them, tool execution, or lifecycle control of external runtimes.

## Decisions

- **Source rail.** A labelled list of sources: "Direct model" (subtitle: the default
  model row's `provider / model`, or "Not set up") and each saved connection (name,
  Hermes/OpenClaw, health dot + text). A badge marks the source QUAKE uses. Opening a
  runtime source issues the existing `select` command, which is the current dropdown
  behavior. Opening the direct source doesn't change the runtime selection. A separate,
  explicit "Use direct model for QUAKE" action issues `select` with no id, replacing the
  misleading "Use local library" option.
- **Conversation list.** Rendered under the active source. Direct: titles with relative
  update time. Runtime: first message preview and turn count, because runtime history has
  no titles or timestamps. "New chat" sits above the list. `.direct-chat-history` holds
  only session buttons so parent smoke counts stay valid.
- **Conversation header.** Direct: an inline title input, with Rename/Cancel shown while
  the title is dirty, and "Delete conversation". Runtime: the connection name badge,
  kind, address (`.agent-http-address`), a status pill (`role=status`) with "Test
  connection", the model route select for Hermes models, an agent select or ID field
  for OpenClaw, "Clear local history" and "Connection" (sheet).
- **Transcript.** User turns are right-aligned compact bubbles. Assistant turns are
  full-width prose rendered by the inert `RichText`. The turn footer shows outcome,
  error code and usage. Runtime tool progress and status appear inline in the active
  turn. Direct follow-up suggestions from the snapshot appear as chips that fill the
  composer and never auto-send.
- **Composer.** A sticky bottom textarea with autosize. Enter sends and Shift+Enter
  inserts a newline. The primary action is Send, which becomes Stop while streaming.
  When the capability is unsupported or unverified, the composer is disabled with the
  reason shown.
- **Connection sheet.** A `<dialog>` that contains the existing ConnectionForm
  semantics, the capability list, the credential state and Remove. Add connection
  opens the same sheet in create mode. When a save succeeds, the workspace switches to
  that source (`saveAndSelect`, unchanged).
- **Strings.** Each folder keeps its JSON. Direct chat strings move to
  `chat/strings.json` with `en`/`de` so the parent's localisation wiring can adopt them.
- **Library, AI config and settings tabs.** Each uses one container level and list/detail
  layouts. The model table becomes a row list with an expandable editor. Controls,
  validation and requests stay the same.

## Risks / Trade-offs

- Parent smoke selectors: keep `.direct-chat`, `.direct-chat-transcript`,
  `.direct-chat-exchange`, `.direct-chat-history button`, the first `.direct-chat
  input` as the title, button texts "Send", "Stop response", "Rename", "Delete
  conversation", and runtime `.agent-http*`, "Add connection", "Save connection", "Test
  connection", "Send message", "Clear local history" and `section[aria-label=Conversation]`.
  Report any deviation.
- Runtime selection side effects are unchanged, but the destination is now shown
  explicitly.
- The shared token commit from nyd.2 may land after this lane. Lane CSS references the
  token names with `--quake-*` fallbacks.

## Migration Plan

No data migration is needed. This change is renderer-only, and rollback restores the
previous components.
