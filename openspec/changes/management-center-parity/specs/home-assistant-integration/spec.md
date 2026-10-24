## ADDED Requirements

### Requirement: Home Assistant page and masked connection
The Apps › Home Assistant page SHALL show the "Server address" (`http(s)://`) and "Long-lived access token" fields, the connection state (Disconnected, Connecting, Connected, Failed with an authentication, certificate or network reason) and Connect / Reconnect. The token field SHALL be a password field. Once stored, the token SHALL show only as `••••` plus its last four characters, SHALL never be returned to the renderer, and SHALL live in the system credential store. The address SHALL be validated as an HTTP(S) origin with a host; any path after the port SHALL be dropped, as DK does. Source: CENTER-098, CENTER-099; GAP-MAP "Don't copy" (unmasked Home Assistant token).

#### Scenario: Stored token
- **WHEN** the page loads with a saved token ending in `a9F2`
- **THEN** the field shows `••••a9F2` and no renderer response contains the token

### Requirement: Per-connection certificate consent
When Home Assistant presents an untrusted certificate, connection SHALL fail with a certificate reason. The page SHALL then offer "Trust this certificate for this server", showing the origin and the certificate's SHA-256 fingerprint. Trust SHALL be granted only after that explicit consent, SHALL apply only to that origin and fingerprint, SHALL stay visible as a warning in the connection status, and SHALL be revocable. A changed certificate SHALL fail again. No other request in the app SHALL be affected. This replaces DK's app-wide "Ignore SSL certificate errors" switch. Source: CENTER-099; home-assistant-integration "Scoped certificate policy".

#### Scenario: Certificate changes after consent
- **WHEN** the server presents a different self-signed certificate on the same origin
- **THEN** the connection fails with the certificate reason and asks for consent again

### Requirement: AI-exposed entity allowlist
The page SHALL list the entities exposed to AI ("AI-Perceivable Entity") as a checkbox tree grouped By Room (from Home Assistant area metadata, with ungrouped entities last under "Other") or By Entity (by domain). Labels SHALL be friendly names. With no saved list, the domains `climate`, `light`, `media_player`, `person`, `sensor`, `switch` and `weather` SHALL start checked. Save SHALL store the checked entity IDs, ignoring group nodes; an empty selection SHALL be refused. The allowlist SHALL be readable by the AI layer through one typed query. Source: CENTER-100.

#### Scenario: First open
- **WHEN** the page lists entities for the first time with no saved allowlist
- **THEN** every light, switch, sensor, climate, media player, person and weather entity is checked, and nothing else is

### Requirement: Key display modes
A Home Assistant key SHALL carry `{entity_id, service, service_data, custom_display_type, custom_display_settings: {fontSize}, custom_display_detail: [{displayItemKey, displayAlias}]}`. The page's key section SHALL configure it: pick a profile key, the entity (room or domain grouping), the service of the entity's domain, the service fields from their selectors, and the display. Required fields SHALL be prefilled: numbers at their minimum, booleans false, selects with their first option. Ranges SHALL be validated before saving. Display SHALL be one of:
- Icon: no text.
- Default: the entity state.
- Custom: chosen attribute fields in check order, each with an optional alias, at a font size of 10–70 px (default 40).

Source: CENTER-101; home-assistant-integration "Entity and service configuration".

#### Scenario: Service fields have collapsed sections
- **WHEN** the server describes nested sections of service fields
- **THEN** the editor renders their leaf controls with the original metadata, validates their values and saves and submits flat leaf names in service_data

#### Scenario: Display attribute disappears
- **WHEN** a saved custom display attribute disappears during live polling
- **THEN** direct key execution and allowlisted AI execution still validate and perform the configured action; save-time display validation and AI allowlist enforcement remain active

#### Scenario: Out-of-range brightness
- **WHEN** the user enters 300 for a light's `brightness` field whose selector maximum is 255
- **THEN** the save is rejected naming `brightness` and the key keeps its previous configuration

### Requirement: Live state on the strip
A Home Assistant key in Default or Custom mode SHALL render its state on the strip tile: centred white text at weight 800 and the configured font size, one line per item, either `alias: value` or `value`. It SHALL update while the strip shows that key. Main SHALL subscribe only to entities that the active profile's visible keys reference, release subscriptions when the profile or connection changes, and show "unavailable" while disconnected. Icon mode SHALL keep the key's icon. Source: CENTER-102.

#### Scenario: State changes
- **WHEN** a Default-mode key tracks `light.desk` and its state changes from `off` to `on`
- **THEN** the tile text changes from `off` to `on` without a profile reload

#### Scenario: Connection lost
- **WHEN** the Home Assistant connection drops
- **THEN** every tracked tile shows `unavailable` and no stale value remains
