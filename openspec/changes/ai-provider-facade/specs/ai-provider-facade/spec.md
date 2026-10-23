# AI provider facade

## Purpose

Provide explicit local provider configuration, isolated credentials, and a verified inference/authentication boundary for all AI callers.

## ADDED Requirements

### Requirement: Conductor facade over Vercel AI SDK

The system SHALL route inference through an Effect.Service facade using the Vercel AI SDK, Config-selected adapters, named spans, declared Layers, Schema contracts, and catalog-tagged errors. Tests and CI SHALL default to a mock provider. Provider SDK types SHALL remain inside adapters and generated outputs SHALL be labeled as generations or estimates.

#### Scenario: Desktop chat consumes the selected provider
- **WHEN** a mock-configured desktop chat submits a text request
- **THEN** the facade invokes only the selected Vercel adapter, returns normalized events, records one correlated span, and performs no live network request

### Requirement: Explicit local provider profiles

The system SHALL store redacted provider metadata locally and resolve credentials through opaque references in the host process. A first-release OpenAI-compatible profile SHALL require an explicit model, base URL, and user-supplied key. It SHALL operate without a DecoKee or open-quake account, credit check, geo lookup, cloud model list, or model proxy.

#### Scenario: Missing key
- **WHEN** a compatible profile has no usable credential reference
- **THEN** inference fails with `AI.PROVIDER.AUTH_REQUIRED` before network I/O and the UI offers credential configuration

#### Scenario: Independent speech profile
- **WHEN** chat uses a compatible provider and STT selects DashScope
- **THEN** each request uses only its selected profile's credentials and changing chat configuration does not change STT selection

### Requirement: Credential destination and isolation

Remote credential-bearing requests SHALL require HTTPS and SHALL NOT forward credentials across origin-changing redirects. Explicit loopback HTTP profiles MAY be supported. Renderers, history, exports, and diagnostics SHALL receive no raw keys or OAuth tokens. Logout or credential removal SHALL invalidate the corresponding auth generation and terminate its active requests without switching providers.

#### Scenario: Endpoint redirect
- **WHEN** a provider responds with a redirect to another origin
- **THEN** the adapter rejects the redirect before forwarding the Authorization header

#### Scenario: Credential store unavailable
- **WHEN** persistent secure storage fails
- **THEN** the system reports the storage failure and stores no plaintext secret; an explicitly chosen in-memory session remains possible

### Requirement: Capability validation before transmission

The facade SHALL validate modalities, tool support, and sampling options against the selected profile before transmission. Unsupported or unverified requested capabilities SHALL return `AI.PROVIDER.CAPABILITY_UNSUPPORTED`; the system SHALL NOT silently discard attachments, select a sidecar provider, or alter the requested model.

#### Scenario: Text-only profile receives an image
- **WHEN** a turn requests vision through a text-only profile
- **THEN** the request fails before upload with the unsupported capability identified and no text-only replacement is sent

### Requirement: Codex OAuth device flow

The system SHALL expose Codex device login as a distinct auth route through a version-checked, documented integration. It SHALL correlate attempt IDs across starting, awaitingUser, ready, expired, cancelled, and failed states, show only the verification URL and short user code to the requesting settings view, and keep grants out of application content and diagnostics. An attempt SHALL expire at the integration deadline or a ten-minute local watchdog, whichever is earlier.

#### Scenario: Successful managed device login
- **WHEN** `account/login/start` for `chatgptDeviceCode` yields a login ID, URL, and code, then the matching completion succeeds
- **THEN** the auth state becomes ready for that generation and no raw grant crosses the preload bridge

#### Scenario: Cancelled attempt completes late
- **WHEN** a user cancels attempt A and its success notification arrives after attempt B starts
- **THEN** A remains cancelled, its grant is unusable by open-quake, and B's state does not change

### Requirement: Verified OAuth inference bridge

The Codex route SHALL become available for inference only after its supported integration, grant isolation, model capabilities, cancellation, and text-only behavior through a Vercel AI SDK bridge are verified. Login success SHALL NOT imply generic OpenAI API access. An unverified bridge SHALL remain unavailable with a reason and SHALL NOT reuse OAuth credentials for an arbitrary compatible base URL.

#### Scenario: Login exists but bridge is unsupported
- **WHEN** managed login succeeds but no verified AI SDK bridge supports that helper version
- **THEN** inference availability remains unavailable and BYO-key profiles remain independently selectable

### Requirement: Provider failures and cancellation

The facade SHALL normalize authentication, rate-limit, unavailable, malformed-stream, and unsupported-capability failures into stable catalog leaves with private original causes and scrubbed diagnostics. Cancellation SHALL abort the selected request and suppress subsequent adapter output. Generation requests SHALL NOT be retried automatically after dispatch.

#### Scenario: Provider fails after partial output
- **WHEN** the SDK emits text and then a rate-limit failure
- **THEN** the consumer receives one rate-limit failure, keeps the partial generation marked incomplete, and sends no automatic duplicate request

#### Scenario: Cancelled SDK keeps emitting
- **WHEN** cancellation is acknowledged and the SDK produces another delta
- **THEN** the facade drops the delta and does not expose credentials or provider error bodies in the cancellation result
