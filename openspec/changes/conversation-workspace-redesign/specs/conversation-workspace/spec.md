# Conversation workspace

## Purpose

Present direct-model and connected-runtime conversations as one conversation-first workspace with truthful identity, capability-gated controls and safe output, without DK-Suite visual imitation.

## ADDED Requirements

### Requirement: Unified conversation workspace
The agents "Agent sessions" view SHALL present one workspace with a source rail and a conversation column. The rail SHALL list the direct model and every saved runtime connection, and SHALL list the conversations of the active source with an explicit new-conversation action. The conversation column SHALL contain a header, the transcript and a composer that stays reachable without scrolling past the transcript. The workspace MUST NOT render the direct and runtime conversations as stacked independent panels.

#### Scenario: Switch between sources
- **WHEN** a user with a configured direct model and a saved Hermes connection opens Agent sessions and chooses the Hermes source
- **THEN** the conversation column shows that connection's conversations and composer, and choosing the direct source shows the direct conversations again

#### Scenario: Narrow window
- **WHEN** the workspace renders in a 390px-wide viewport
- **THEN** the rail and conversation stack in one column with no horizontal overflow, and the composer stays usable

### Requirement: Truthful identity and routing
The conversation header SHALL identify the model or runtime that answers. For the direct source, it SHALL show the effective main-agent model row, or state that no model is set up. For a runtime source, it SHALL show the runtime kind, the connection name and address, and the health state as dot plus text. The workspace SHALL indicate which source receives QUAKE device requests. Opening the direct source MUST NOT change the runtime selection. The user SHALL be able to route QUAKE requests back to the direct model explicitly.

#### Scenario: Runtime selected for QUAKE
- **WHEN** a runtime connection is the selected connection
- **THEN** that source is marked as the QUAKE destination, and viewing direct chat leaves the selection unchanged

### Requirement: Capability-gated conversation controls
The workspace SHALL show a control only when the host bridge supports it. Direct conversations SHALL offer rename and delete. Runtime conversations SHALL offer clearing the local history and MUST NOT offer rename or remote deletion. The model route, agent selection and conversation input SHALL be enabled only when discovery reports support. When conversation support is unsupported or unverified, the input SHALL be disabled and the reason shown.

#### Scenario: Unsupported runtime chat
- **WHEN** discovery reports conversation support as unsupported
- **THEN** the composer is disabled and shows that the endpoint doesn't support conversations

### Requirement: Stream progress, cancellation and recovery
While a response streams, the workspace SHALL show progress, including runtime status and tool progress when the runtime reports them. It SHALL show reported or estimated token usage when present, and offer Stop. Input SHALL stay locked until the turn's terminal outcome. Failures SHALL show the catalog error code with a recovery action, without discarding the user's message.

#### Scenario: Stop during acceptance
- **WHEN** the user presses Stop before the host has accepted the turn
- **THEN** cancellation is sent immediately after acceptance, and input stays locked until the turn ends

### Requirement: Inert generated markup
Generated answers from both direct and runtime sources SHALL render through the inert rich-text renderer. Scripts, raw HTML elements and remote images MUST NOT be created in the transcript.

#### Scenario: Runtime Markdown answer
- **WHEN** a runtime answer contains Markdown emphasis and an HTML script tag
- **THEN** the emphasis renders as formatting, and no script or image element exists in the transcript

### Requirement: Connection management and settings entry
Adding, editing, testing, refreshing capabilities and removing runtime connections SHALL be available from the workspace without permanent side panels. Credentials MUST NOT be displayed. When the direct model isn't ready, the workspace SHALL offer navigation to AI configuration.

#### Scenario: Unconfigured direct model
- **WHEN** no effective model with a credential exists
- **THEN** the direct source explains that setup is required and offers an action that opens AI configuration

### Requirement: Restrained visual system
The agents area SHALL use the shared management tokens and controls, with one bordered container level. It SHALL support Graphite, Midnight and Paper themes and every font scale. It MUST NOT use DK-Suite glass, gradients, skeuomorphic controls or icon-only navigation.

#### Scenario: Paper theme
- **WHEN** the user selects the Paper theme
- **THEN** the workspace text, borders and focus indicators use the theme tokens with readable contrast

### Requirement: Fresh direct conversations and settings navigation

Direct chat SHALL clear its draft and current session on New Chat, create one session only on send, and prevent conversation switching during a stream. Model settings navigation SHALL target the model configuration tab without losing the current conversation. Covers AI-223, AI-227.

#### Scenario: New Chat while streaming AI-223

- **WHEN** a user starts a new conversation and sends once
- **THEN** the previous draft and session clear, one session is created, and New Chat and history switching stay disabled until the turn ends

#### Scenario: Configuration round trip AI-227

- **WHEN** Model settings is activated from the conversation workspace
- **THEN** the Models tab opens and returning preserves the current conversation
