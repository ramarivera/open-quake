# Spec Delta

## Purpose

The recovered channels hub renders a dynamic catalog and setup drawer backed by six known entries in background.js, already present in 0.4.52 (`CENTER-072`, `CENTER-073`). The replacement must represent available adapters without claiming unverified channel support.

## ADDED Requirements

### Requirement: Verified dynamic catalog

The hub SHALL list only registered channel descriptors with stable ID, label, setup type, required runtime and availability. It SHALL support an empty adapter registry. The recovered catalog SHALL contain the six descriptors below with stable IDs, setup types, install specifications, bundled flags and observed region groups. Catalog membership SHALL NOT mark an adapter connected or authorize implicit installation. Evidence: `CENTER-072`, `CENTER-073`; `v0.4.95/app-resources/background.js`, `OPENCLAW_CN_CHANNEL_CATALOG` / `OPENCLAW_INTL_CHANNEL_CATALOG`, and the 0.4.52 `strings/background_strings_4.txt` catalog.

| ID | English label | Observed group | Setup type | installSpec | Bundled |
| --- | --- | --- | --- | --- | --- |
| `feishu` | Feishu | China | `credentials_or_qr` | `@openclaw/feishu` | Yes |
| `qqbot` | QQ Bot | China | `app_id_secret` | `@openclaw/qqbot` | Yes |
| `openclaw-weixin` | WeChat | China | `qr_login` | `@tencent-weixin/openclaw-weixin` | No |
| `wecom` | WeCom | China | `wecom_bot_credentials` | `@wecom/wecom-openclaw-plugin` | No |
| `whatsapp` | WhatsApp | International | `qr_login` | `clawhub:@openclaw/whatsapp`, fallback `@openclaw/whatsapp` | No |
| `discord` | Discord | International | `bot_token` | `@openclaw/discord` | Yes |

#### Scenario: No adapters

- **WHEN** no channel adapter is registered
- **THEN** the hub shows an empty state and offers no unsupported setup action

#### Scenario: Unavailable runtime

- **WHEN** an adapter requires a runtime that is not ready
- **THEN** its card reports unavailable with a runtime reason and setup does not start the runtime installation

### Requirement: Descriptor-driven setup

The system SHALL render only setup fields and modes declared by the selected adapter, validate required fields before submission, and keep credentials out of catalog and status responses.

#### Scenario: Missing required token

- **WHEN** a bot-token descriptor is selected and the token is blank
- **THEN** continue/save identifies the missing token and no setup request is sent

#### Scenario: Unsupported setup type

- **WHEN** a descriptor advertises an unsupported setup type
- **THEN** the card reports unsupported setup and no generic credential form is substituted

### Requirement: QR session lifecycle

QR setup SHALL use a distinct session ID with pending, ready, confirmed, expired, cancelled and failed states. Sessions SHALL expire within five minutes or an earlier adapter deadline and SHALL NOT expose QR data after expiry or cancellation.

#### Scenario: Cancel a QR session

- **WHEN** the drawer closes before confirmation
- **THEN** the session is cancelled, its QR disappears and subscriptions are released

#### Scenario: Late progress

- **WHEN** a confirmed event arrives for a replaced or expired session ID
- **THEN** the event is ignored and the current channel is not marked connected

### Requirement: Connection status and configuration

The hub SHALL distinguish configured, connecting, connected, disabled and failed channels. Saving credentials or obtaining a QR image SHALL NOT by itself mark a channel connected.

#### Scenario: Credentials saved without connection

- **WHEN** setup saves valid configuration but the adapter has not verified a connection
- **THEN** the card shows configured or connecting, then connected only after verified adapter status

#### Scenario: Disable then restart

- **WHEN** a channel is disabled and the application restarts
- **THEN** it remains disabled and does not reconnect automatically

### Requirement: Channel removal

The system SHALL require explicit channel removal, release its connection and setup sessions, delete its stored credential reference, and retain unrelated channel state.

#### Scenario: Remove one channel

- **WHEN** a user confirms removal of channel A while channel B is connected
- **THEN** A's local configuration and credentials are removed, A stops, and B remains connected

#### Scenario: Removal fails

- **WHEN** the credential store refuses deletion
- **THEN** the hub reports incomplete removal and permits retry without claiming all credentials were removed

### Requirement: Localized recovered channel descriptors
The six descriptor IDs, setup types, minimum host versions, install specs and China/International grouping SHALL remain stable. Blurb, source and ETA SHALL resolve the recovered zh/en/ja/ko/de/fr/es/it metadata with English fallback. Both groups SHALL remain visible. Catalog cards SHALL retain accessible Connect/Manage actions and report portal errors. Sources: CENTER-072, CENTER-073, CENTER-075.

#### Scenario: Unknown catalog locale
- **WHEN** the requested locale has no metadata
- **THEN** the six descriptors use their English labels and preserve setup contracts

### Requirement: Owned channel transport boundary
Production registration SHALL supply a capability-gated channel adapter for an explicitly configured local OpenClaw command owner. It SHALL map validated fields and isolated secrets to channel configuration, verify readiness separately from configuration, and execute only fixed argv without a shell. It SHALL never install plugins or change a user-managed HTTP runtime. QR login SHALL have bounded output, cancellation and expiry and SHALL confirm only after successful verified login. Pairing SHALL list pending codes and approve a known code once, retaining service dispatch guards. Missing command ownership SHALL remain explicitly unavailable. All acceptance in lane agents SHALL use fake transports; real channel pairing requires separate live acceptance. Sources: CENTER-074, CENTER-077, CENTER-078, CENTER-079, MAIN-144.

#### Scenario: Saved configuration with offline gateway
- **WHEN** channel configuration persists but the runtime does not report connected
- **THEN** the hub shows Configured or Unavailable rather than Connected

#### Scenario: Cancel QR then receive completion
- **WHEN** a QR session is cancelled before the transport reports successful login
- **THEN** the owned process is cancelled and late completion cannot connect the channel

#### Scenario: Duplicate approval
- **WHEN** approval is requested twice for the same pending code
- **THEN** only one transport approval occurs and an unknown or consumed code is rejected
