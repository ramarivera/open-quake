# AI chat core

## Purpose

Keep normal chat sessions, streamed text, local history, and desktop/panel presentation consistent under cancellation and failure.

## ADDED Requirements

### Requirement: Local first-release normal chat

The first release SHALL accept normal text chat through the configured provider facade without a DecoKee/open-quake account. An accepted turn SHALL pin session ID, turn ID, mode, provider, model, and auth generation. A session SHALL have at most one active turn; concurrent submission to that session SHALL fail with `CHAT.SESSION.BUSY` before provider dispatch.

#### Scenario: Configuration changes during a turn
- **WHEN** a user changes the default provider after turn A is accepted
- **THEN** A completes against its pinned provider and only a subsequent turn uses the new default

#### Scenario: Another conversation runs
- **WHEN** sessions A and B have active turns and A is cancelled
- **THEN** only A's turn is cancelled and B's event stream continues

### Requirement: Versioned ordered chunk protocol

The chat stream SHALL use version 1 envelopes containing sessionId, turnId, zero-based contiguous seq, and type `answer`, `followUp`, or `end`. Answer events SHALL carry append-only textDelta. FollowUp events SHALL carry a complete suggestion with suggestionId and SHALL NOT alter answer text. End SHALL carry completed, cancelled, failed, or timedOut outcome, optional stable error code, and optional usage with reported/estimated provenance. Every accepted turn SHALL emit exactly one end and SHALL emit nothing afterward.

#### Scenario: Successful streaming turn
- **WHEN** the provider emits deltas `Hel` and `lo` followed by a suggestion and completion
- **THEN** the stream contains seq 0 answer `Hel`, seq 1 answer `lo`, seq 2 followUp, and seq 3 end completed, and the assembled answer is `Hello`

#### Scenario: Cancel before the first token
- **WHEN** an accepted turn is cancelled before any answer arrives
- **THEN** seq 0 is end cancelled and late provider output produces no further chunks

### Requirement: Subscription recovery and bounded delivery

Each subscriber SHALL buffer at most 256 events. Overflow SHALL detach that subscriber with `CHAT.STREAM.RESYNC_REQUIRED` without restarting inference. Clients SHALL ignore duplicate seq values and resolve a gap through an authoritative snapshot with lastSeq before applying subsequent events.

#### Scenario: Slow panel subscriber
- **WHEN** the panel subscriber overflows while the management subscriber stays current
- **THEN** management continues, panel restores assembled text/outcome from a snapshot, and the provider receives no second request

### Requirement: Session lifecycle

The service SHALL expose EMPTY, ONGOING, PROCESSING, and IDLE states with the meanings defined in design.md. Accepted input SHALL enter ONGOING; provider dispatch SHALL enter PROCESSING; successful completion SHALL create retained context and enter IDLE. A cancelled/failed/timedOut turn SHALL return IDLE if an earlier completed exchange exists and EMPTY otherwise. Explicit close SHALL cancel active work and release context without deleting saved history. Unknown or stale turn events SHALL NOT mutate the active session.

#### Scenario: Voice preparation cancelled
- **WHEN** a new EMPTY session enters ONGOING for voice preparation and capture is cancelled before text submission
- **THEN** it returns EMPTY without dispatching inference or adding an empty user message

#### Scenario: Follow-up exchange
- **WHEN** an IDLE session accepts another message and completes inference
- **THEN** it moves through ONGOING and PROCESSING to IDLE with both completed exchanges retained

### Requirement: Absolute response deadlines

Direct normal chat SHALL have a 60,000ms absolute deadline from turn acceptance. An explicitly enabled long mode, DashScope media profile or agent run MAY use 300,000ms. Deltas SHALL NOT extend deadlines. On a direct-chat deadline the service SHALL abort upstream work, emit one end timedOut with `CHAT.RESPONSE.TIMEOUT`, and ignore late completion. Agent runtime SHALL own its run deadline and emit its one corresponding end. Idle context expiry SHALL default to 30 minutes and SHALL NOT delete saved history.

#### Scenario: Stream never finishes
- **WHEN** a normal turn keeps emitting tokens past 59,999ms without completion
- **THEN** it terminates at 60,000ms and no subsequent token is applied

#### Scenario: Long analysis mode
- **WHEN** an enabled data-analysis turn explicitly selects the long deadline
- **THEN** it remains eligible to complete at 60,001ms but times out at 300,000ms

### Requirement: Local history and interruption recovery

The repository SHALL atomically persist user input and assistant text with completed/incomplete outcomes under the local application data directory. Only completed user/assistant pairs SHALL enter later model context. On restart, unfinished persisted turns SHALL become interrupted and SHALL NOT resume provider calls. Delete/reset SHALL prevent late callbacks from recreating removed data.

#### Scenario: Crash after partial text
- **WHEN** the app restarts after persisting partial assistant text without an end
- **THEN** history shows that text as interrupted and a later turn excludes that incomplete exchange from provider context

### Requirement: Context budget and usage provenance

Before dispatch the service SHALL preserve system instructions and new input, reserve output capacity, and remove oldest complete exchanges until within the selected model budget. If fixed inputs exceed the budget it SHALL fail with `CHAT.CONTEXT.TOO_LARGE` before I/O. Estimated token counts SHALL be labeled estimates and kept distinct from provider-reported usage.

#### Scenario: Budget cannot fit new input
- **WHEN** the system instructions, new input, and output reserve exceed the configured window after history removal
- **THEN** the UI reports the context error and sends no truncated or hidden replacement request

### Requirement: Shared safe desktop and panel content

The management and panel views SHALL consume the same authoritative turn and render generated content as a generation. They SHALL support paragraphs, headings, lists, emphasis, and fenced code, escape raw HTML, and avoid fetching images or executing embedded commands/files. Link activation SHALL require a user gesture and host-validated HTTP(S) target. Streaming SHALL preserve a user's non-bottom scroll position.

#### Scenario: Generated executable markup
- **WHEN** an answer contains a script element, a file URI, and a fenced shell command
- **THEN** both views render inert text and no host action runs

### Requirement: Offline localized chat controls

Chat controls, state names, errors, and assistant chrome SHALL use General Translation with bundled en/de messages, source-English fallback, and no runtime translation request. Locale changes SHALL update both views without rewriting stored user content or generated answers. UI locale SHALL NOT change provider selection.

#### Scenario: Missing German message offline
- **WHEN** the locale switches to de with no network and one message is absent
- **THEN** that message falls back to source English while translated controls update and the chat stream continues

### Requirement: Titles and optional assistant window

The first release SHALL derive a local fallback title from the first user message, keep messages of at most 10 characters intact, and use the first 10 characters followed by `...` for longer messages. It SHALL permit renaming and retain a manual title on later sends. Evidence: `AI-236`, `AIAssistantContent.vue:885-897`; keeping manual titles deliberately fixes DK-Suite overwriting them on every send. Later automatic title generation SHALL be optional and SHALL NOT overwrite a user title or fail a chat. An optional floating assistant SHALL persist geometry locally and restore within connected displays; core chat and capture SHALL work with that window closed.

#### Scenario: Local title truncation

- **WHEN** the first user message is `abcdefghijk` and no manual title exists
- **THEN** the local title is `abcdefghij...` without a model request

#### Scenario: Short title

- **WHEN** the first user message is `abcdefghij`
- **THEN** the local title is `abcdefghij` without an ellipsis

#### Scenario: Late generated title
- **WHEN** a title generation finishes after the user renamed or deleted the conversation
- **THEN** it does not overwrite the title or recreate the conversation
