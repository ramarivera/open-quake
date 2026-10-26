## ADDED Requirements

### Requirement: Recovered OBS command catalog
The system SHALL register all 21 recovered ids and configuration parameters enumerated in design.md through the existing action registry, preserving configData imports and enforcing executable validation. It SHALL expose target editing and explicit Save. Stats SHALL occupy 2x1 cells and screenshot 2x2. Audit rows MGMT-173 through MGMT-193, MGMT-282 and WIDGETS-123.

#### Scenario: Configure and execute saved OBS keys
- **WHEN** a valid committed OBS key activates through the existing key runtime
- **THEN** the owning OBS service sends its corresponding v5 requests with the saved target parameters exactly once
- **AND** invalid or incomplete keys cannot perform OBS requests

#### Scenario: Audio and media target choices
- **WHEN** editing mute, volume or audio monitoring
- **THEN** every input accepted by the OBS audio-volume request and every special audio input is selectable, including media and platform capture sources
- **AND** media controls include FFmpeg and VLC inputs
- **AND** a saved input outside the selectable list stays visible for repair

#### Scenario: Display-only functions
- **WHEN** a stats or screenshot key activates
- **THEN** it performs no write action and its display retains the fixed footprint

### Requirement: Protected connection and local detection
The system SHALL use obs-websocket v5 at loopback by default, host 127.0.0.1 and port 4455, or an explicitly configured host. It SHALL protect the password using the existing OS credential vault and never serialize it into profiles, public state, errors or logs. Auto-connect SHALL default on. Local detection SHALL read OBS configuration without starting OBS and SHALL respect manual overrides. Authentication and RPC version failures SHALL have distinct catalog errors and suppress automatic retry until explicit reconnection. Audit row WIDGETS-122.

#### Scenario: Detect local configuration
- **WHEN** local OBS websocket settings are enabled and no manual override exists
- **THEN** detection supplies its loopback port and securely stores its password, reporting the source and result without disclosing the password

#### Scenario: Explicit Auto-fetch
- **WHEN** Auto-fetch finds enabled local settings without a manual override or manual disconnect
- **THEN** it connects to those settings before returning, even when auto-connect is disabled
- **AND** startup detection still honors the auto-connect setting and authentication failures suppress retries

#### Scenario: Authenticate and reconnect
- **WHEN** OBS sends a v5 challenge
- **THEN** the client sends the specified SHA256/base64 authentication response
- **AND** a lost connection retries without replaying the last command
- **AND** auth failure remains visible until an explicit connect or configuration change

#### Scenario: Dropping an OBS function while disconnected
- **WHEN** the user selects an OBS function in the existing editor
- **THEN** the app attempts a connection and shows the connection dialog/help after 2000 ms if disconnected

#### Scenario: Reconnect to another OBS instance
- **WHEN** a connected user changes the endpoint and successfully clicks Connect or Auto-fetch
- **THEN** the editor invalidates its previous catalog and reloads scenes, inputs, transitions and scene items from the new connection
- **AND** a reconnect that completes between status polls still refreshes the catalog
- **AND** catalog responses from the previous connection cannot restore its targets
- **AND** a failed catalog reload leaves the previous instance's targets unavailable

#### Scenario: Change a source key's scene
- **WHEN** the user changes the selected scene for an OBS source key
- **THEN** the old scene's item choices clear immediately
- **AND** only items loaded for the newly selected scene become selectable

### Requirement: OBS knob volume binding
The system SHALL route focused obsVolume rotation through the existing knob action path. It SHALL adjust current inputVolumeMul by the configured step, default 0.05, clamp between zero and one when allowGain is false and toggle mute on press. Audit rows MGMT-181, MGMT-219 and WIDGETS-123.

#### Scenario: Volume turn and press
- **WHEN** the knob turns clockwise or counterclockwise on a committed focused OBS volume key
- **THEN** it increases or decreases only that OBS input volume
- **AND** pressing the key toggles that input mute
- **AND** a stale profile/session cannot change OBS volume

### Requirement: Visible live tiles and teardown
The system SHALL refresh visible OBS status, stats and screenshot tiles every 2000 ms and unregister their ownership when hidden, profile/page changes or renderer closes. Status SHALL use recovered text/color states, 28px weight 800; stats SHALL show CPU, output skipped frames and render skipped/total at 14px weight 700; screenshots SHALL request jpeg at 128x128. Text SHALL be localized with missing values shown as unavailable. Audit rows WIDGETS-124 through WIDGETS-127.

#### Scenario: Two-second refresh
- **WHEN** a visible profile contains OBS status, stats and screenshot keys
- **THEN** after 2000 ms the service fetches current status, GetStats and GetSourceScreenshot and publishes only matching visible tiles

#### Scenario: Visibility and release
- **WHEN** the profile changes, page hides or renderer is destroyed
- **THEN** its old tiles receive no further updates and no polls remain when there are no visible OBS tiles

#### Scenario: Panel screenshot authorization
- **WHEN** a panel requests live OBS tiles
- **THEN** every key id and decoded command matches a displayed committed key on its active device page
- **AND** uncommitted sources are rejected before OBS IO
- **AND** profile changes revoke polling and prevent publication of in-flight screenshots
- **AND** management can preview unsaved targets and a panel retries after Save

#### Scenario: Read-only editor preview
- **WHEN** the key editor displays an OBS tile with input actions disabled
- **THEN** its visible status, stats and screenshot still subscribe to live data
- **AND** previewing never sends control actions and hiding the preview releases its subscription

#### Scenario: Repair a missing saved scene
- **WHEN** a saved scene target is absent from the current collection
- **THEN** the catalog still returns available scenes and empty scene items
- **AND** the saved scene remains visible as unavailable alongside replacement scenes
- **AND** scene commands validate the current scene list and reject missing scenes before target requests or writes
- **AND** deletion between scene listing and item lookup retains replacement choices

#### Scenario: OBS operator invalidates the session
- **WHEN** OBS closes an identified connection with SessionInvalidated code 4011
- **THEN** background retries, tile polls and key execution do not reconnect
- **AND** pending requests fail with a scrubbed terminal session error
- **AND** an explicit connection request can establish a new session
