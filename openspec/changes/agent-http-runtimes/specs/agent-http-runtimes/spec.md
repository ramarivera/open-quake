# Agent HTTP runtimes

## Purpose

Connect open-quake to existing user-managed OpenClaw and Hermes HTTP runtimes for capability-aware agent conversations on localhost, LAN and reachable tailnet addresses.

## ADDED Requirements

### Requirement: Existing runtime connections
The application SHALL accept named OpenClaw and Hermes HTTP or HTTPS base URLs, preserve configured gateway subpaths, and store secrets only through credential references. Public connection views MUST exclude secrets and credential references. Invalid schemes, embedded credentials, fragments and query strings in base URLs MUST be rejected.

#### Scenario: Tailnet gateway connection
- **WHEN** a user configures an HTTPS MagicDNS URL with a gateway subpath
- **THEN** runtime requests retain that subpath and public views expose only connection details and credential availability

#### Scenario: Unsafe endpoint
- **WHEN** a connection URL embeds a credential or uses a non-HTTP scheme
- **THEN** validation rejects the connection before network activity

### Requirement: Honest capabilities and status
The application SHALL represent runtimes as externally managed and expose only verified supported operations. Unsupported and unverified capabilities MUST remain distinguishable. Health or model discovery MUST NOT imply agent enumeration, resource editing, tool events, installation, or process lifecycle control.

#### Scenario: Health and chat only
- **WHEN** a runtime supports chat but has no agent listing endpoint
- **THEN** conversations remain available and agent listing returns a typed unsupported result without a fabricated agent catalog

### Requirement: Bounded authenticated transport
HTTP requests SHALL bound time, response size and streamed event size, reject redirects, and keep credentials out of diagnostics. Caller cancellation and interrupted consumers MUST abort active network work. Request paths MUST NOT override the configured origin or escape its base subpath.

#### Scenario: Redirect with credentials
- **WHEN** an authenticated endpoint responds with a redirect
- **THEN** the transport fails without forwarding credentials to the redirect target

#### Scenario: Cancel blocked read
- **WHEN** the user cancels a conversation while waiting for a response
- **THEN** the active network request terminates and no subsequent text is delivered to that conversation

### Requirement: Normalized runtime conversations
Conversations SHALL normalize actual backend text, status, tool progress, reported usage and completion events, preserve session continuity where the protocol supports it, and reject malformed streams through typed errors. Unsupported tool or resource events MUST NOT be invented. Completed successful streams MUST contain exactly one completion event.

#### Scenario: Hermes continuity
- **WHEN** a Hermes server returns a session identifier during a streamed conversation
- **THEN** subsequent turns can reuse that identifier and real status/tool progress events retain their backend meaning

### Requirement: Desktop and device integration
Desktop connection management SHALL provide add, update, remove, select and health-test flows, expose capability-aware controls, and route selected agent conversation and QUAKE interaction paths through the configured runtime. Existing local agent workspaces MUST remain usable without a configured HTTP runtime.

#### Scenario: Unsupported management control
- **WHEN** a selected connection lacks resource management capability
- **THEN** the desktop explains the unavailable operation without attempting a fabricated management endpoint

#### Scenario: Hermes model route selection
- **WHEN** Hermes advertises model aliases and the user selects one
- **THEN** conversations send that model identifier and changing aliases starts a separate conversation without reusing another model route's provider session

### Requirement: Evidence-based acceptance
Setup documentation SHALL distinguish Hermes agent HTTP API from its dashboard/control API and distinguish mocked protocol coverage from live endpoint acceptance. Live testing SHALL use existing user-managed instances, a task-owned temporary process of an installed runtime, or explicitly authorized disposable pinned Docker Compose instances. Temporary APIs MUST be exposed to the host only through loopback, isolate state in task scratch storage or container tmpfs, use an ephemeral bearer credential, disable tools for inference checks and stop after testing. Container processes may listen on their internal interface for loopback-only port publishing. Testing MUST NOT install services, restart user-managed instances or change saved configuration or authentication policy.

#### Scenario: Reusable container acceptance
- **WHEN** an operator explicitly runs the disposable Compose E2E runner
- **THEN** provider base URL, optional API key and model come from environment variables without a personal endpoint default, actual adapters verify streaming/session behavior, and success or failure removes the owned containers, network and runtime state

#### Scenario: Dashboard is not chat API
- **WHEN** a configured Hermes address serves only its dashboard
- **THEN** connection diagnostics explain the missing agent API without claiming chat or lifecycle support

#### Scenario: Isolated installed-runtime acceptance
- **WHEN** the runtime is installed but its user-managed API is not running
- **THEN** acceptance may start a task-owned temporary loopback API with isolated state and no enabled tools, and records that it verified a temporary instance rather than the user-managed service
