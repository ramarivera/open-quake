# Proposal

## Why

On 2026-10-25 Ramiro rejected the management UI as an ugly DK-Suite imitation and asked
for a substantial redesign led by Opus 5.5 agents. He was explicitly angry that a previous
pass changed only three legibility details. This change records that complaint durably
for the agent and chat area (bead `open-quake-nyd.3`, epic `open-quake-nyd`).

The "Agent sessions" view currently stacks two disconnected panels: a direct chat with
oversized history buttons and a transcript well, and a runtime column that lists every
control (selects, eight buttons, a capability table and the transcript) in one long
column. The composer sits below the fold. Runtime answers show raw Markdown. The page
doesn't say which model or runtime answers, or which source QUAKE device requests use.

## What Changes

- Replace the stacked panels with one conversation-first workspace: a rail that lists
  the conversation sources (the direct model and each saved Hermes/OpenClaw
  connection) and that source's conversations. The main column has a conversation
  header with model/runtime identity and status, the transcript, and a sticky composer.
- Show the real model/runtime identity, connection health, capability-gated controls,
  stream progress (status, tool progress, usage), cancel, error recovery and history
  actions: rename/delete for direct chats, clear local history for runtime chats.
- Move connection add/edit/test/capabilities/remove into a connection sheet and header
  actions. Keep runtime selection semantics, which also choose where QUAKE requests go,
  and state that destination truthfully.
- Render generated runtime answers through the same inert rich-text renderer as direct
  chat. No raw HTML, scripts or remote images.
- Provide a settings entry from the unconfigured direct state to AI configuration.
- Restructure local agent library, AI configuration and panel settings tabs into
  list/detail layouts with one container level, following the design lead's
  "quiet workbench" brief. Don't remove features.
- The user explicitly supersedes earlier specs that required DK-Suite colours,
  glass or skeuomorphism for this area.

## Capabilities

### New Capabilities

- `conversation-workspace`: Conversation-first agent/chat workspace presentation and interaction.

### Modified Capabilities

None. Bridge contracts, IPC, main services and stored data are unchanged.

## Impact

Renderer-only: `apps/desktop/src/renderer/src/management/{chat,agent-http,agents}/**` and
their tests. This change consumes the shared tokens and controls from
`independent-management-design` (nyd.2), and doesn't edit main, preload, shared, edge or
root files. Parent-owned smoke tests keep their selectors (`.direct-chat`,
`.direct-chat-exchange`, `.agent-http-*` and accessible button labels). Any selector
change is reported to the parent. No new dependencies.
