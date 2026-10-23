# Proposal

## Why

DK-Suite's seven chat modes mix text generation with profile writes, host automation, media generation, and Home Assistant actions. Explicit mode contracts let normal chat ship first and make later actions testable before they affect a device or host.

## What Changes

- Define all seven recovered mode IDs and a first-release gate that enables normal chat only.
- Specify later key-config preview/apply, PC action proposals, two-phase equipment control, analysis stages, and image/video jobs.
- Define attachment, screenshot, search, selection, and emoji extensions with explicit phase gates and provider capability checks.
- Route executable actions through the conductor capability registry and later `agent-runtime`; generated text alone never invokes an action.

## Capabilities

### New Capabilities

- `ai-chat-modes`: mode availability, mode-specific outputs, action confirmation, and later chat extensions.

### Modified Capabilities

None.

## Impact

Builds on `ai-chat-core` and `ai-provider-facade`. Proposed future ownership is `packages/edge/src/chat/modes/` plus desktop input adapters. Profile mutation, host automation, Home Assistant, artwork storage, and system-selection hooks remain owned by their integration domains. No new dependencies or code are added here. Later mode releases target macOS before Linux.
