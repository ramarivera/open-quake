## ADDED Requirements

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
