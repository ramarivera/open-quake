# Proposal

## Why

Open-quake currently manages local agent workspaces but can't connect conversations to an existing OpenClaw or Hermes HTTP runtime. Users need to use running instances on this device, a LAN, or a reachable tailnet address without an installer or messaging integration.

## What Changes

- Add persisted runtime connections with secure credential references and secret-free public views.
- Add bounded HTTP adapters for existing OpenClaw and Hermes instances, with protocol-specific capability reporting.
- Add cancellable conversations, supported agent/session discovery and connection management in the desktop application.
- Route configured QUAKE agent interactions through the selected HTTP connection while preserving the existing local workspace behavior.
- Document setup and record acceptance against existing user-managed endpoints, distinguishing live evidence from mock fixture coverage.

## Capabilities

### New Capabilities

- `agent-http-runtimes`: Existing-runtime HTTP connections, capabilities, conversations and desktop integration.

### Modified Capabilities

None. Existing agent-runtime planning remains separate; no main specs have been archived yet.

## Impact

Shared contracts and provider adapters live in `packages/edge/src/agent-http`. Desktop main, preload, management UI and production composition consume them. Existing agent and AI contracts remain compatible. The implementation adds no runtime installer, messaging channels, lifecycle control, or required service configuration changes. Protocol discovery determines which optional operations each backend actually supports.
