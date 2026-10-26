# Agent runtime

## Purpose

Define optional local agents, bounded tool execution, isolated sessions, and truthful desktop/panel status after normal chat ships.

## ADDED Requirements

### Requirement: Optional runtime and first-release independence

First release SHALL leave agents disabled and SHALL run normal chat/direct voice without installing or contacting an agent runtime. Later enablement SHALL select one local backend explicitly, expose disabled/starting/ready/stopping/failed states, bound start/health checks to 10s and stop to 5s, and affect only processes owned by open-quake.

#### Scenario: Agent runtime absent
- **WHEN** no backend is installed or enabled
- **THEN** normal chat/direct voice remain available and an agent-route request returns `AGENT.RUNTIME.UNAVAILABLE` without launching an installer

### Requirement: Local catalog and model capabilities

Enabled agents SHALL use local stable IDs, revisions, instructions, explicit provider/model references, and capability allowlists. Bundled templates SHALL be newly authored with provenance and SHALL work without a DecoKee account, marketplace, or remote catalog. Model lists SHALL reflect locally configured verified capabilities; incompatible models SHALL fail before dispatch.

#### Scenario: Agent selects text-only model for tools
- **WHEN** an agent requiring tools selects a profile without tool capability
- **THEN** send fails as unsupported before inference and no fallback model is selected

### Requirement: Agent switch and reset isolation

Each send SHALL pin agent ID, instruction revision, model, allowlist, and session generation. Switching the selected agent SHALL affect future sends only. Reset SHALL cancel that agent's active run and clear only its context under a new generation. Stale events SHALL not mutate the reset or another agent's state.

#### Scenario: Switch while previous agent streams
- **WHEN** agent A is running and the user selects B
- **THEN** A's output remains attached to A and B's next message uses B's own context

### Requirement: Structured registry-bound tool execution

Tool argument deltas SHALL be accumulated into a complete Schema-validated call before execution. Every invocation SHALL resolve a registered capability ID, permission/autonomy policy, availability gate, and agent allowlist. Unknown, disabled, disallowed, malformed, or never-policy calls SHALL not execute. Tool output and generated prose SHALL not grant additional authority.

#### Scenario: Partial or malformed tool arguments
- **WHEN** a model emits incomplete JSON or input that fails the capability Schema
- **THEN** the runtime executes nothing and returns a typed invalid-tool result

### Requirement: Confirmation identity and exactly-once dispatch

Write/sensitive tools SHALL require confirmation by default. Confirmation SHALL bind the run, toolCallId, capability, normalized arguments, resolved targets, and nonce. Changed or expired confirmations SHALL be rejected. The runtime SHALL persist dispatch identity before execution and SHALL return each tool result to the model at most once. Duplicate notifications or clicks SHALL not execute again.

#### Scenario: Arguments change after preview
- **WHEN** a confirmation preview names file X but the invocation changes to file Y
- **THEN** the old approval is rejected and no write occurs until a new matching confirmation

#### Scenario: Repeated tool ID
- **WHEN** a model or transport repeats a dispatched toolCallId in the same run
- **THEN** the runtime uses its existing invocation record and does not repeat the side effect

### Requirement: Bounded tool loop and cancellation

A run SHALL permit at most 8 model steps and 16 tool calls, one simultaneous host-mutating tool, 30s per tool, 120s per confirmation, and 300s absolute duration including confirmation waits. Each provider step SHALL have a 60s deadline capped by remaining run time. Intermediate steps SHALL NOT emit outward chat end chunks. Budget/deadline/cancellation SHALL stop further provider/tool dispatch, revoke pending confirmations, and emit one terminal outcome. Non-cancellable dispatched operations SHALL retain truthful eventual execution records without reentering the finished model turn or claiming rollback.

#### Scenario: Tool loop exceeds budget
- **WHEN** an eighth model step requests another model step
- **THEN** the run ends with `AGENT.RUN.BUDGET_EXCEEDED` and dispatches no ninth step

#### Scenario: Cancellation during non-cancellable write
- **WHEN** the user cancels after a non-cancellable host write was dispatched
- **THEN** the run terminates once, reports that operation as still pending until its real result is known, and does not repeat or claim to reverse the write

### Requirement: Restart does not replay side effects

After restart the runtime SHALL mark unfinished model runs interrupted and dispatched tools with unknown completion as unresolved. It SHALL not replay them automatically or report success without execution evidence.

#### Scenario: Crash after dispatch before result persistence
- **WHEN** a tool has a persisted dispatch ID but no recorded terminal result on restart
- **THEN** its status is unknown completion and it requires resolution instead of automatic re-execution

### Requirement: Chat-compatible streams and inert tool cards

Agent text SHALL use the ai-chat-core v1 answer/followUp/end protocol. Structured run/tool status SHALL use a separate ID-correlated ordered subscription with snapshot recovery. Desktop and panel SHALL show actual invocation status and inert escaped summaries. Initial approvals SHALL occur on desktop; panel text/touch rendering SHALL not execute commands or silently approve actions.

#### Scenario: Exec-like output rendered on panel
- **WHEN** a tool card or answer contains a shell command preview
- **THEN** the panel shows inert text/status and no command runs from parsing or rendering it

### Requirement: Gateway compatibility requires protocol evidence

An optional OpenClaw gateway adapter SHALL remain unavailable until handshake, authentication, capabilities, event mapping, and cancellation are verified for an explicit protocol version. Initial endpoints SHALL be loopback; later remote endpoints SHALL require explicit authenticated TLS configuration. Auth failure SHALL not trigger protocol downgrade or use DecoKee tokens.

#### Scenario: Only gateway store keys are known
- **WHEN** server URL/token names exist but no validated protocol fixtures are available
- **THEN** the adapter remains unavailable and the UI does not claim gateway compatibility

### Requirement: Bounded local administration capabilities
Local administration SHALL use typed revision-checked commands for rename, confirmed template reset, portable pack export/import and diagnostics. Packs SHALL contain only validated agent Markdown and skills, without models, credentials, executable paths or process settings; import SHALL validate the entire bounded pack before a single atomic workspace commit. Diagnostics SHALL expose only bounded allowlisted counts/status/codes and explicit backup export capability. A user-exported workspace backup SHALL include all authored agents, skills and panel slot assignments in a validated versioned JSON format, at most 128 agents, 1024 skills and 2 MiB. It SHALL exclude model/provider settings, runtime configuration and credential-store values. It SHALL NOT claim automatic backup retention. Environment updates SHALL accept only declared managed settings and SHALL never change host environment or user-managed HTTP runtime configuration. Local service settings SHALL validate port 1 through 65535, log level, auto-start intent and an owned data directory; save SHALL require explicit restart intent before applying active process settings, and clear SHALL require confirmation and a stopped owned backend. External HTTP runtimes SHALL report unsupported process settings, clear, environment, logs and remote-runtime backup operations rather than invent endpoints. Sources: CENTER-047, CENTER-048, CENTER-104, MAIN-144. Vendor installer/account/catalog/market/edition operations are OUT-OF-SCOPE under GAP-MAP decision 9, audit/GAP-MAP.md:146.

#### Scenario: Malformed portable pack
- **WHEN** an import contains an escaping Markdown filename, duplicate skill, oversized content or an existing protected agent ID
- **THEN** the operation is rejected before storage changes and no partial workspace appears

#### Scenario: Unsupported external administration
- **WHEN** a selected user-managed HTTP runtime receives a local process-settings request
- **THEN** the request returns an explicit unsupported capability and sends no remote request

#### Scenario: Invalid environment update
- **WHEN** an update includes an undeclared variable or invalid setting
- **THEN** persisted settings and runtime environment remain unchanged

### Requirement: Local agent key editing and isolated context reset
The key editor SHALL expose local Agent, Model with Default Agent and Default (Agent) fallbacks, Voice Input, Task Prompt when voice is disabled, and Reset Context for clawbot keys (MGMT-302). Gateway settings SHALL reuse the saved HTTP connection facade and native credential storage, with masked transient input and no credential-bearing URLs. Reset SHALL forget only the selected device/key's conversation contexts in the selected backend, cancelling that key's active turn, and SHALL report unsupported owners truthfully. Local workspace identities SHALL NOT become external runtime identities implicitly.

#### Scenario: Save a typed-only key and reset its context
- **WHEN** a user selects an agent and model, disables Voice Input, edits Task Prompt, and saves
- **THEN** the saved profile retains the typed payload
- **AND** Reset Context cancels and clears that key's runtime sessions without clearing another key's sessions

#### Scenario: Reset a direct conversation without an external selection
- **WHEN** no HTTP connection is selected and the user resets a key's context
- **THEN** the HTTP decorator forwards to the direct-chat owner, which cancels that key's turn and forgets its sessions
- **AND** the next message starts fresh, another key retains its context, and an owner without reset support returns unavailable

### Requirement: Owned service state administration
The owned runtime SHALL allow a port, log level, opt-in autostart and a private data directory selected as its root or a named child of its data folder (CENTER-047, CENTER-048, MAIN-144). Directory switches SHALL retain the prior state, reject escapes and symlinks, and require restart consent while running. Confirmed clear SHALL remove the selected runtime's config, channels, credentials and sessions only while stopped, preserving service preferences and local agent/model workspaces. Runtime and channel updates SHALL share one atomic config owner and preserve unrelated fields. Diagnostics SHALL include at most 64 allowlisted lifecycle records without raw process output or secrets (CENTER-104).

#### Scenario: Concurrent channel configuration retains the selected port
- **WHEN** runtime start and channel configuration write concurrently
- **THEN** the private config retains the custom port and channel fields with loopback binding and file permissions 0600

#### Scenario: Select and clear private runtime data
- **WHEN** a stopped runtime selects a private child directory and the user confirms clear
- **THEN** only that directory's runtime data is removed, preferences and other workspaces remain, and escaping or symbolic-link directories are rejected

#### Scenario: Select a private child directory on Windows
- **WHEN** the user selects a named child of the private data folder using Windows path separators
- **THEN** validation accepts it and rejects parent escapes, sibling prefixes, nested paths and other drives using the same containment rules as POSIX

#### Scenario: Export authored workspaces without provider credentials
- **WHEN** the user exports a workspace backup from Settings
- **THEN** the result includes every local agent, skill and panel slot, validates against the bounded backup contract, and contains no provider model configuration or credential reference
- **AND** no external runtime endpoint is contacted

#### Scenario: Invalid persisted runtime settings do not disable agent management
- **WHEN** persisted settings cannot be decoded or select an invalid data directory
- **THEN** runtime construction succeeds in the stopped state with the typed settings error code and a scrubbed diagnostic
- **AND** agent management remains available and no automatic start is attempted

#### Scenario: Autostart does not delay service construction
- **WHEN** valid settings opt into autostart and the backend is slow to start
- **THEN** management becomes available while start runs in the service scope with the existing deadline
- **AND** closing the service scope cancels the pending start

#### Scenario: Owned runtime uses a Windows command shim
- **WHEN** the explicitly selected executable is a Windows `.cmd` or `.bat` shim
- **THEN** gateway and channel invocations use the same quoted `cmd.exe /d /s /v:off /c` adapter with verbatim arguments
- **AND** command expansion, embedded quotes and line breaks are rejected before spawning, while native executables keep direct argument dispatch

### Requirement: Owned Windows runtime tree termination
The owned runtime SHALL stop the entire Windows process tree, including the gateway launched by an npm command shim. It SHALL await a bounded tree-termination command and process exit, retry forced termination once on failure, and report failure if cleanup cannot be confirmed. POSIX SHALL retain SIGTERM followed by bounded SIGKILL escalation. Sources: CENTER-047, MAIN-144; open-quake-lih.17.24, PR108 finding 4380901915.

#### Scenario: Command processor exits before its gateway
- **WHEN** a Windows shim gateway is stopped and cmd.exe closes before tree termination completes
- **THEN** Stop waits for the tree command to finish and never kills only cmd.exe
- **AND** failed termination remains an error, with an owned handle available for retry

#### Scenario: Retain cleanup after the Windows shim exits before Stop
- **WHEN** the owned Windows command processor exits before its gateway and the user selects Stop
- **THEN** the adapter retains the cleanup target independently of readiness and invokes bounded tree termination against its retained PID
- **AND** only successful cleanup releases ownership; repeated Stop does not kill the same target again
- **AND** this covers CENTER-047, MAIN-144, PR122 finding 4381279137, bead open-quake-lih.17.24.1

#### Scenario: Stop retries after tree-command failure followed by shim exit
- **WHEN** both bounded taskkill attempts fail and the command processor exits afterward
- **THEN** the cleanup target remains owned and a later Stop retries taskkill against the same PID
- **AND** this covers CENTER-047, MAIN-144, PR122 finding 4381279385, bead open-quake-lih.17.24.1

#### Scenario: Retry cleanup after startup timeout
- **WHEN** startup times out and both bounded tree-termination attempts fail
- **THEN** the adapter retains the target for an explicit Stop or dispose retry
- **AND** failure to start never discards ownership of the possibly live gateway
- **AND** this covers CENTER-047, MAIN-144, PR122 finding 4381279552, bead open-quake-lih.17.24.1

#### Scenario: Start cannot mistake retained cleanup for readiness
- **WHEN** a Stop fails after the command processor has already exited and the user selects Start
- **THEN** Start retries retained cleanup before spawning a new owned process and checking its health
- **AND** if cleanup still fails Start reports failure without spawning or publishing ready
- **AND** clear and unconsented settings changes remain unavailable while cleanup is owed
- **AND** this covers CENTER-047, MAIN-144, PR122 finding 4381290893, bead open-quake-lih.17.24.1

#### Scenario: Failed process creation has no tree to retain
- **WHEN** the Windows spawner reports an error without ever assigning a PID
- **THEN** startup reports failure but cleanup succeeds without taskkill, and Stop, Clear and a repaired Start can recover
- **AND** the adapter retains cleanup normally for a process that was created
- **AND** this covers CENTER-047, MAIN-144, PR122 finding 4381510116, bead open-quake-lih.17.24.1

#### Scenario: Tree termination reports that an exited PID is absent
- **WHEN** the processor has closed and taskkill fails for the retained PID
- **THEN** a bounded Windows process-tree probe checks the root and all descendants, including descendants of an absent root
- **AND** only a successful confirmation that the entire tree is absent releases cleanup ownership
- **AND** surviving descendants, failed probes and unexpected probe output keep cleanup retryable
- **AND** this covers CENTER-047, MAIN-144, PR122 finding 4381535855, bead open-quake-lih.17.24.1

#### Scenario: A retained Windows PID is reused
- **WHEN** the owned command processor exits and another process reuses its PID before cleanup
- **THEN** the driver compares the current creation identity with the identity sampled while the spawned process handle was alive
- **AND** a mismatch, unavailable identity or failed identity query returns the typed scrubbed runtime failure without dispatching termination
- **AND** matching identity permits tree termination only while the native Windows termination helper holds and rechecks that process object
- **AND** identity results arriving after the bounded stop attempt cannot dispatch a late termination
- **AND** this covers CENTER-047, MAIN-144, PR122 safety finding 4381625938, bead open-quake-lih.17.24.1

### Requirement: Imported agent key voice default
The clawbot key editor SHALL derive Voice Input and Task Prompt visibility from the runtime hold-to-talk predicate. An absent voiceInput action SHALL display voice disabled and Task Prompt editable. Sources: MGMT-302; open-quake-lih.17.24, PR108 finding 4380901936; DK-Suite v0.4.95 recovered_sources/src/plugins/KeyConfiguration.js:239-240 defaults voiceInput to false, and src/views/Components/QuakeShortCutView.vue:1758-1767 requires a truthy voiceInput action.

#### Scenario: Imported key omits voiceInput
- **WHEN** a clawbot key without voiceInput opens in the mounted editor and its task is saved
- **THEN** Voice Input is unchecked, Task Prompt is visible, and saving preserves typed-only behavior without adding voiceInput
- **AND** explicitly enabling Voice Input hides Task Prompt and saves true
