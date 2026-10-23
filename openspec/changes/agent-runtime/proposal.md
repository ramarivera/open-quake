# Proposal

## Why

DK-Suite bundles an OpenClaw installer, templates, gateway settings, and device tool cards, but the gateway protocol is only partially recovered. Open-quake needs a deliberate runtime choice and an account-free tool execution contract after normal chat works.

## What Changes

- Keep agents disabled in the first release while defining later agent catalog, model selection, isolated conversations, switching, reset, and connection checks.
- Propose an in-process tool loop over the shared Vercel AI SDK facade, with optional OpenClaw compatibility only after protocol verification.
- Define capability-registry tool dispatch, confirmation state, finite budgets, cancellation, and structured tool cards on desktop/panel.
- Drop mandatory bundled installers, DecoKee gateway credentials, and agent-market sharing.

## Capabilities

### New Capabilities

- `agent-runtime`: local agent lifecycle, tool loop, gateway compatibility gate, agent catalog, and device presentation.

### Modified Capabilities

None.

## Impact

Depends on `ai-provider-facade`, `ai-chat-core`, and action-domain capability registrations. Proposed future owners are `packages/edge/src/agents/`, `packages/client/`, and desktop adapters. `knob-push-to-talk` consumes this contract later. No runtime binary, dependency, or implementation is added. Agents are later-phase work, with macOS before Linux.
