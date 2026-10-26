## ADDED Requirements

### Requirement: Channel catalog presentation
The Agents › Settings tab SHALL show a Channel Configuration section. A "Connected ({count})" block SHALL list configured channels, each with a 10 px status dot (green when enabled and connected, amber when configured but disabled, grey otherwise), its name, Manage, an enable toggle, and Delete with a confirmation. Below it, a two-column catalog grid (one column under 720 px) SHALL show the six recovered descriptors grouped China and International. Groups SHALL NOT be filtered by inferred user geography. Each card SHALL show the icon, English label, source label ("Official bundled", "Tencent official", "Official plugin"), English blurb, ETA, a status badge (Connected, Disabled, Not configured, plus Unavailable with the runtime reason), a primary Connect or Manage button, and "Open developer portal" when the descriptor has a platform URL. Portal links SHALL open only HTTPS URLs from the catalog, in the system browser. Source: CENTER-072, CENTER-073, CENTER-074, CENTER-075.

#### Scenario: Runtime absent
- **WHEN** the agent runtime is not running
- **THEN** all six cards render with an Unavailable badge naming the runtime, and QR channels cannot start setup

#### Scenario: Disable a channel
- **WHEN** the user turns off the toggle of a connected Discord channel
- **THEN** the dot turns amber, the stored configuration keeps its credential reference, and the channel stays disabled after a restart

### Requirement: Setup drawer by setup type
Connect and Manage SHALL open a right-hand drawer titled "Connect {name}" with the steps Prepare, Credentials / Login, Confirm and Done. Prepare SHALL show the blurb, the portal link and the disclaimers (`weixinDisclaimer`, `wecomBotHint`). It SHALL require "I created the app/bot on the platform" before continuing, except for QR setup. The Credentials step SHALL render only the descriptor's fields:
- `credentials_or_qr` (Feishu): domain (Feishu (China) or Lark (International)), App ID and App Secret.
- `app_id_secret` (QQ Bot): App ID and App Secret. Pasting `appId:secret` into App ID splits it into both fields.
- `bot_token` (Discord): Bot Token.
- `wecom_bot_credentials` (WeCom): Bot ID and Secret.
- `qr_login` (WeChat, WhatsApp): the QR panel.

Confirm SHALL list the values with secrets masked as `••••` plus the last four characters. Finish SHALL validate the required fields, store the secrets in the system credential store by reference, and save the configuration. Saving SHALL show "configured" and never "connected" until the runtime adapter reports a verified connection. A configuration saved while the runtime is absent SHALL stay configured and waiting for the runtime. Done SHALL show the success or error text. An overlay click SHALL close the drawer only on Done. Source: CENTER-076, CENTER-077.

#### Scenario: Paste a combined QQ credential
- **WHEN** the user pastes `102030:abcSecret` into the QQ Bot App ID field
- **THEN** App ID becomes `102030` and App Secret becomes `abcSecret`

#### Scenario: Secret stays out of status
- **WHEN** a Discord token is saved and the catalog is listed again
- **THEN** no listing, status or log contains the token, only its masked form on the Confirm step

Audit regression coverage: CENTER-076.

#### Scenario: Credential and backdrop interactions
- **WHEN** the user prepares QQ, Feishu or WeCom and advances through credentials and confirmation
- **THEN** QQ combined paste splits credentials, Feishu retains its domain, required fields block advancement, secrets are masked, and the backdrop dismisses only on Done

### Requirement: QR login panel
For `qr_login` setup the drawer SHALL start a QR session with its own ID through the runtime adapter. It SHALL show the platform hint ("Scan with WeChat on your phone", "Scan with WhatsApp on your phone", or the default), a 220×220 QR image, the open-link fallback, "Waiting for QR code…" while pending, "Start / refresh login" to replace the session, and the last six log lines with block-character QR art filtered out. Unlike DK, Next SHALL NOT mark success until the adapter confirms the session. Closing the drawer SHALL cancel the session. Source: CENTER-078; integration-channels "QR session lifecycle".

#### Scenario: Close during QR login
- **WHEN** the drawer closes while the QR is showing
- **THEN** the session is cancelled, the QR disappears, and a late confirmation for that session ID is ignored

### Requirement: DM pairing approval
Channels configured with DM pairing (Feishu's `dmPolicy: 'pairing'` and QR channels) SHALL show a Pairing step on Manage. It SHALL list pending pairing requests from the runtime adapter with their code, sender label and age. Approving a request SHALL send exactly one approval for that channel and code. A code SHALL be approved only through this explicit action, never automatically. The list SHALL refresh after each approval. An approval that fails or arrives for an unknown code SHALL report that and change nothing. Source: CENTER-079.

#### Scenario: Approve a pairing code
- **WHEN** the user approves code `X7K2` on the WeChat channel
- **THEN** the adapter receives one approval for `openclaw-weixin` and `X7K2`, and the request leaves the pending list

#### Scenario: Double click
- **WHEN** the user clicks Approve twice quickly
- **THEN** only one approval is sent

### Requirement: WhatsApp terminal QR display
WhatsApp setup SHALL consume the compact terminal output emitted by pinned OpenClaw 3cd1240aa7750a40a23028abbaf582b94d641868, extensions/whatsapp/src/login.ts and src/media/qr-terminal.ts. It SHALL decode ANSI-wrapped half-block modules into a PNG with a four-module quiet zone, render it in the setup drawer, replace refreshed codes, and ignore incomplete or malformed blocks. It SHALL NOT require a real account or expose the QR as a log. Sources: CENTER-078; open-quake-lih.17.24, PR108 finding 4380901925.

#### Scenario: Recorded compact login output
- **WHEN** the selected runtime prints the recorded compact WhatsApp QR output
- **THEN** the session becomes ready with a PNG preserving every QR module and the drawer displays it
- **AND** readiness alone never confirms authentication, while cancellation rejects later output

### Requirement: Pinned WhatsApp terminal QR variants
The channel adapter SHALL decode every compact QR size emitted by OpenClaw 3cd1240aa7750a40a23028abbaf582b94d641868 src/media/qr-terminal.ts with small:true, preserving the exact modules and a four-module PNG quiet zone. That renderer uses qrcode@1.5.4 directly, not qrcode-terminal, with no platform-dependent rendering branch. Sources: CENTER-078, PR122 finding 4381279720, bead open-quake-lih.17.24.1; extensions/whatsapp/src/login.ts onQr, src/media/qr-runtime.ts, src/cli/channels-cli.ts login, src/runtime.ts console logging. Raw QR exists in the socket callback and gateway login API but is not exposed by the selected channels login CLI, which has no JSON option. Piped Node stdout carries UTF-8 independently of Windows console code pages.

#### Scenario: Every compact version and supported stream framing
- **WHEN** the CLI emits any QR version 1 through 40, with ANSI or plain lines, LF or CRLF, or the refresh clear-screen prefix
- **THEN** the PNG contains exactly the recorded QR modules and a white four-module quiet zone
- **AND** tests use outputs recorded from the unmodified pinned renderer with inert payloads and no live account
