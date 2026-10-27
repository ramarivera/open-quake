## ADDED Requirements

### Requirement: Verified Apple release signing

Tagged macOS releases SHALL use team TRGDCMBX3J's Developer ID Application identity, hardened runtime and Apple notarization. Signing secrets SHALL be confined to trusted macOS tag packaging, and absent requirements SHALL block publication. PR and ordinary local builds SHALL remain usable without signing credentials. Windows/Linux signing SHALL remain unchanged.

#### Scenario: Missing release credentials
- **WHEN** macOS packaging runs for a version tag without complete signing/notarization credentials
- **THEN** it SHALL fail clearly before creating unsigned release assets and the complete-release publication SHALL remain blocked

#### Scenario: Inspect both Apple downloads
- **WHEN** a signed build smoke-tests its DMG and ZIP
- **THEN** it SHALL verify the app in each format for expected Developer ID authority/team, strict recursive signatures, hardened runtime, secure timestamp, a valid staple and Gatekeeper acceptance before collecting downloads

#### Scenario: Local opt-in and PR isolation
- **WHEN** a developer explicitly enables Apple signing locally with an existing signing identity and a complete notarization API credential, profile or Apple ID credential pair
- **THEN** packaging SHALL sign/notarize without publishing, and pull-request builds SHALL reject signing opt-in without receiving release secrets

#### Scenario: Reuse existing notarization API credentials

- **WHEN** a trusted macOS tag build receives its existing notarization API key, identifier and issuer
- **THEN** the private key SHALL be staged only in the signing temporary directory with private permissions and removed by the always-run cleanup
- **AND** missing fields or mixed credential modes SHALL block packaging

### Requirement: Five-target desktop downloads
The system SHALL produce macOS arm64 DMG/ZIP, Windows arm64 and x64 EXE, and Linux arm64 and x64 AppImage/DEB packages with correct version metadata and packaged native bindings.

#### Scenario: Build a pull request
- **WHEN** desktop release automation runs for a pull request
- **THEN** all five targets SHALL build and smoke-test without publishing a public release or requiring signing secrets

### Requirement: Complete tag releases
The system SHALL publish a GitHub release only for a valid v-prefixed SemVer tag and after quality checks and all five targets succeed. It SHALL attach the complete expected assets and SHA256 checksums, preserve prerelease status and reject replacement of a published release.

#### Scenario: One target fails
- **WHEN** a platform build or smoke fails
- **THEN** no public release SHALL be published

#### Scenario: Publish a prerelease
- **WHEN** a valid prerelease tag is pushed and all checks succeed
- **THEN** a prerelease with all expected downloads and checksums SHALL be published without replacing the latest stable release

### Requirement: Honest installation support
The system SHALL document unsigned installation and Linux HID access. It SHALL distinguish downloadable desktop builds from npm packages and from unverified full hardware/platform acceptance.

#### Scenario: Choose an installation method
- **WHEN** a user reads the installation instructions
- **THEN** they SHALL find the downloads and unsigned limitations without being instructed to install the private workspace packages from npm

#### Scenario: Smoke the distributed downloads
- **WHEN** a native package job tests its output
- **THEN** the smoke SHALL execute the app from each shipped download format, using a mounted DMG, extracted ZIP, installed EXE/DEB or AppImage, without opening hardware

#### Scenario: Record without an audio converter
- **WHEN** recording is requested without an executable FFmpeg with the libmp3lame encoder
- **THEN** the app SHALL reject the request before capture begins and explain how to install or configure the required converter

### Requirement: Disabled-by-default trusted owned updater

The updater SHALL remain disabled without an explicit owned feed, artifact origin, trusted signing key and installer policy. It SHALL NOT use vendor endpoints or assume a real feed. An explicitly configured adapter SHALL verify signed release metadata, app/version/platform/architecture, HTTPS origins, bounded artifact length and SHA-256 before marking ready, revalidate cached bytes immediately before installation, and require native consent to install. Evidence: MAIN-114, SETTINGS-006, SETTINGS-049, SETTINGS-050. Production delivery remains blocked pending the owned feed/signing/installer decision.

#### Scenario: Synthetic owned release

- **WHEN** fake HTTP returns signed synthetic metadata and synthetic artifact bytes
- **THEN** the production adapter checks identity and origin, reports progress, rejects mutation or invalid signatures and only invokes the fake installer for the verified selected release

#### Scenario: Later, Now and failure

- **WHEN** the user defers, downloads, approves installation or encounters a download/install failure
- **THEN** the renderer sends the matching typed action, shows bounded progress and readable failure guidance, keeps install single-flight and never installs from background checks

#### Scenario: Unconfigured production build

- **WHEN** no owned update policy has been supplied
- **THEN** manual checks remain disabled and no network request, artifact download or installer invocation occurs

### Requirement: Nonpublishing hosted signing rehearsal

A manual workflow SHALL rehearse the existing signed macOS package path only from reviewed main, using a distinct prerelease build version. Signing secrets SHALL remain confined to the macOS packaging step. Manual runs SHALL have read-only repository contents permissions and SHALL never enter release publication or create a tag.

#### Scenario: Dispatch a trusted rehearsal

- **WHEN** an authorized operator manually dispatches the desktop workflow on main
- **THEN** native builds and the existing packaged DMG/ZIP verifier run, macOS uses required Developer ID signing/notarization, Windows/Linux stay unsigned, and downloads remain workflow artifacts

#### Scenario: Dispatch from an untrusted ref

- **WHEN** a manual dispatch targets a branch other than main
- **THEN** validation and dependent packaging do not execute and signing secrets are not consumed
