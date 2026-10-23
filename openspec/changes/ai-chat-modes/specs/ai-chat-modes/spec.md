# AI chat modes

## Purpose

Define explicit availability, inputs, generated results, and action boundaries for the seven chat modes and their later extensions.

## ADDED Requirements

### Requirement: Explicit mode and capability gates

The system SHALL recognize keyConfig, normal, operatePC, operateEquipment, pictureGeneration, dataAnalysis, and videoGeneration, mapping known imported numeric IDs 0-6 to those names. First release SHALL enable only normal. Disabled/unknown modes SHALL fail before capture, upload, inference, or action dispatch. Accepted turns SHALL retain their mode throughout execution.

#### Scenario: Imported PC mode in first release
- **WHEN** an imported action requests operatePC while that mode is disabled
- **THEN** it returns `CHAT.MODE.UNAVAILABLE` and does not invoke the provider or host executor

### Requirement: Key configuration candidate and explicit apply

KeyConfig SHALL generate a candidate against an explicit device matrix, supported key-action catalog, and profile revision. It SHALL validate supported unique key positions and action schemas, preview changes, and require user apply before invoking the profile domain. Apply SHALL reject a changed profile revision with `CHAT.MODE.STALE_TARGET` and SHALL NOT send generated HID commands directly.

#### Scenario: Invalid generated key
- **WHEN** a candidate includes a position absent from the active device matrix
- **THEN** validation reports the invalid position and no profile write occurs

#### Scenario: Profile changed during preview
- **WHEN** the user approves a candidate after the profile revision changed
- **THEN** apply fails as stale and requires a fresh preview

### Requirement: PC operation uses registered actions

OperatePC SHALL represent openApplication, closeApplication, writeToDocument, generateReport, and executeCommand as Schema-validated registry actions with current platform gates. A host action SHALL execute only under the registry's permission and autonomy policy after any required confirmation. ExecuteCommand SHALL default to never. Model prose SHALL NOT be evaluated as a command.

#### Scenario: Model prints a shell command
- **WHEN** a reply includes `executeCommand` text without a valid enabled registry invocation
- **THEN** the UI renders inert generated text and the host executes nothing

#### Scenario: Accessibility unavailable
- **WHEN** an enabled PC action requires a permission the macOS adapter lacks
- **THEN** it reports the typed permission failure and does not partially perform another action

### Requirement: Two-phase equipment control

OperateEquipment SHALL select entities from the integration's current allowed inventory, then select a service and arguments allowed for those entities. Before mutation it SHALL present resolved targets/service data and pass through registry confirmation. Missing/stale entities, services, or credentials SHALL fail before external action.

#### Scenario: Entity removed between phases
- **WHEN** an entity selected in phase one disappears before service dispatch
- **THEN** phase two fails as stale and no Home Assistant request is sent

### Requirement: Analysis progress and atomic report result

DataAnalysis SHALL use explicit user-selected files or a one-shot user-requested screenshot and emit ordered ANALYSING, optional DEEP_THINK, GENERATING_REPORT, and REPORT_GENERATED stages. REPORT_GENERATED SHALL occur only after an atomic local report save. DEEP_THINK SHALL NOT expose hidden model reasoning. Failure/cancellation SHALL preserve a truthful terminal outcome and SHALL NOT expose an unfinished report as complete.

#### Scenario: Save fails after generation
- **WHEN** generated report text exists but the local save fails
- **THEN** the job ends failed with `CHAT.ARTIFACT.SAVE_FAILED` and never emits REPORT_GENERATED

### Requirement: Explicit multimodal input

Attachment and screenshot requests SHALL show user-selected input and validate mime type, selected-provider capability, at most 8 items, and at most 20 MiB total before transmission. Picker cancellation SHALL create no turn. Unsupported input SHALL NOT be stripped or sent to another provider silently.

#### Scenario: Vision unsupported
- **WHEN** a user chooses a screenshot with a text-only profile
- **THEN** submission returns `CHAT.INPUT.UNSUPPORTED` without uploading image bytes

### Requirement: Generated media jobs

PictureGeneration, videoGeneration, and the later emoji extension SHALL require an explicitly selected compatible profile and return a generated asset candidate with provenance and job outcome. Jobs SHALL have a 300,000ms absolute deadline. Cancellation/timeout SHALL stop local delivery, attempt supported remote cancellation, and never resubmit generation automatically. Applying generated wallpaper/icons or edited emoji text SHALL require a separate validated asset/profile action.

#### Scenario: Video provider cannot cancel
- **WHEN** a local video job times out and the provider has no cancellation method
- **THEN** the UI marks local timeout and uncertain remote completion, emits one terminal outcome, and starts no replacement job

#### Scenario: Emoji generated
- **WHEN** an emoji candidate succeeds
- **THEN** it remains a local candidate until the user applies it through the icon/profile workflow

### Requirement: Search and selection extensions remain explicit

Web search and global text selection SHALL remain disabled in first release. Later search SHALL be an opt-in registry tool with an explicit adapter and source links. Later selection capture SHALL require opt-in, a user action, and excluded-application enforcement. GT UI translation SHALL NOT imply live translation or selection capture.

#### Scenario: Search-looking text without search
- **WHEN** a model produces URLs while no search tool ran
- **THEN** the view labels the reply as generated and does not label it web-grounded

#### Scenario: Selection in excluded application
- **WHEN** a selection hook is enabled but the active app is excluded
- **THEN** it captures and transmits no selected text
