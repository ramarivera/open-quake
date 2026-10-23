# Proposal

## Why

Normal streaming chat is the first-release AI loop. A shared turn contract must keep desktop and panel content consistent while cancellation, timeouts, and local history remain predictable.

## What Changes

- Define versioned `answer`, `followUp`, and `end` chunks, turn identity and ordering, and EMPTY/ONGOING/PROCESSING/IDLE session semantics.
- Define ordinary and long deadlines, cancellation, bounded subscriptions, context budgeting, and local history recovery.
- Specify the management chat, simple panel markdown, optional floating assistant, and offline General Translation strings.
- Record the complete inventory sections 4-6 ownership index in the design so deferred parity remains visible.

## Capabilities

### New Capabilities

- `ai-chat-core`: normal chat sessions, event delivery, persistence, desktop/panel presentation, and localization.

### Modified Capabilities

None.

## Impact

Depends on `ai-provider-facade`. Approved ownership is `packages/edge/src/chat/`, `packages/client/`, and `apps/desktop/`. Panel rendering integrates with `panel-window-prototype` without changing that change. Future GT dependencies are `gt-react` and the `gt` development CLI, subject to exact-version approval and coordination with the localization lane. W7 implements the foundation documented in design.md; integration tasks remain open. macOS first, Linux second; physical device rendering remains unverified.
