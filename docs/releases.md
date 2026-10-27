# Install and release open-quake

Download installers from [GitHub Releases](https://github.com/ramarivera/open-quake/releases). A workflow on a branch or a green review check isn't a published release. Until the first version tag is published, PR builds are available only as zipped GitHub Actions artifacts, usually requiring a GitHub login.

| System | Architecture | Downloads |
| --- | --- | --- |
| macOS | Apple Silicon, arm64 | DMG and ZIP |
| Windows | Intel/AMD, x64 | EXE installer |
| Windows | ARM64 | EXE installer |
| Linux | Intel/AMD, x64 | AppImage and DEB |
| Linux | ARM64 | AppImage and DEB |

Linux x64 downloads use the native architecture labels `amd64` for DEB and `x86_64` for AppImage. Intel Mac packages aren't built. Choose the package matching your system architecture. The desktop app includes its JavaScript runtime, so Node.js and npm aren't needed to install it. Workspace packages are private, and the CLI is a placeholder. `npm install open-quake` isn't an installation method.

## Recording prerequisite

Meeting recording requires a separately installed FFmpeg executable with the `libmp3lame` encoder. The installers don't bundle FFmpeg. Install it through your system package manager, then restart open-quake with FFmpeg available on the app's PATH. Apps launched from Finder or the Start menu can have a different PATH from a terminal. Set `OPEN_QUAKE_FFMPEG` to an absolute executable path in the app's launch environment when needed. The app checks the converter before opening the capture window or requesting microphone permission. Missing or incompatible converters prevent recording with an installation message rather than leaving an unfinalizable recording.

## Signing status

PR and ordinary local macOS packages have an ad-hoc signature for Apple Silicon execution. Tagged macOS releases now require Developer ID Application signing and notarization; absent credentials fail packaging and block publication. This configuration alone doesn't establish that a signed release has been produced. Drag the app from the DMG into Applications. For an unsigned development build, macOS may block the first launch. After verifying the download, use System Settings > Privacy & Security > Open Anyway if macOS offers it. Organization-managed Macs may forbid this. Grant Accessibility, Microphone or Screen Recording permissions only for the features you use.

Windows installers aren't Authenticode signed. SmartScreen may show an unknown-publisher warning. Verify the download before choosing More info > Run anyway, if your policy permits it. The installer supports a per-user installation and a chosen destination.

On Linux, make the AppImage executable with `chmod +x <download>.AppImage`, then launch it. Some distributions need FUSE 2, such as Ubuntu's `libfuse2`; `--appimage-extract-and-run` is an alternative when FUSE isn't available. Install a DEB through your distribution's package installer. Don't run the app as root or disable the Chromium sandbox to work around a launch failure.

### Linux device access

HID access needs a narrowly scoped udev rule for the QUAKE. Save the following as `/etc/udev/rules.d/70-open-quake.rules` using administrator privileges:

```udev
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="4158", ATTRS{idProduct}=="514b", TAG+="uaccess"
```

Run `sudo udevadm control --reload-rules`, unplug and reconnect the device, and use an active local desktop session. This grants the active desktop user access to this device rather than making all HID devices writable.

Linux builds don't establish feature parity. Display arrangement, global keyboard output, foreground application detection and media controls depend on OS adapters and the desktop/compositor. Hardware acceptance remains separate from package startup checks. Windows hardware acceptance also remains outstanding.

## Verify a download

Every tag release includes `SHA256SUMS.txt` and GitHub build provenance attestations. From the download directory, use `shasum -a 256 <file>` on macOS or `sha256sum <file>` on Linux and compare the result to the manifest. In PowerShell use `Get-FileHash <file> -Algorithm SHA256`. With the GitHub CLI, verify provenance using `gh attestation verify <file> --repo ramarivera/open-quake`.

## Publish a version

Merge the reviewed release pipeline and intended application changes before tagging. A tag releases the exact tagged commit, so don't tag an older main checkout. Choose a new version and push a `v`-prefixed SemVer tag, for example `v0.1.0` or `v0.1.0-beta.1`.

```nu
git tag -a v0.1.0-beta.1 -m 'open-quake 0.1.0-beta.1'
git push origin v0.1.0-beta.1
```

The Desktop release workflow validates the version, runs lint/typecheck/tests, builds all five platform/architecture targets on native GitHub-hosted runners and smoke-tests their packaged native modules and UI. It uploads all eight downloads with checksums and build attestations, then publishes a GitHub Release. Prerelease tags publish prereleases and don't replace the latest stable release. Packaging doesn't imply that every planned application feature or hardware acceptance check is complete.

The publish job alone has write permission and uses GitHub's short-lived token. The macOS tag packaging step needs the Apple credentials below. PR builds and Windows/Linux packaging don't receive them. No npm token or Windows signing certificate is needed.

A failed target prevents publication. Failed uploads can leave a draft; fix the cause and rerun the workflow for the same immutable tag. The workflow can retry a draft, but refuses to replace a published release. Don't move tags to repair releases. Publish a new version instead.

There's no automatic updater in this change. Download and install a newer release manually.

## Local packaging

Use Node 24 and the repository's pinned pnpm version. On the target operating system, run `pnpm install --frozen-lockfile`, `pnpm --filter @open-quake/desktop build`, then `pnpm --filter @open-quake/desktop package --mac --arm64` on Apple Silicon, `--win --x64` or `--win --arm64` on Windows, or `--linux --x64` or `--linux --arm64` on Linux. Build the matching architecture natively. Output goes to the ignored `apps/desktop/dist/` directory.

For a packaged smoke check, set `RELEASE_VERSION` to the package version, then run `pnpm --filter @open-quake/desktop test:package`. The default local version is `0.0.0`; CI uses the tag version or an explicit PR prerelease version. On Linux run the check under `xvfb-run -a` if no display is available. The smoke mounts the DMG and extracts the ZIP on macOS, silently installs and uninstalls the EXE on Windows, and installs/removes the DEB and runs the AppImage on Linux. Windows/Linux checks belong on disposable test machines because they install packages. The smoke window stays hidden and never opens the QUAKE or emits keyboard/media actions.

## Apple release credentials and validation

The macmini already has `Developer ID Application: Ramiro Rivera (TRGDCMBX3J)`. Certificate provisioning is solved. Whether its private key can sign unattended or be exported for a hosted runner, and whether notarization credentials exist, still needs an authorized check. An installed certificate on macmini doesn't provision GitHub's disposable macOS runner.

An authorized operator must supply these repository or organization Actions secrets through the private secret mechanism, never in source, chat, command arguments or artifacts:

| Secret | Required value |
| --- | --- |
| `APPLE_CERTIFICATE_P12_BASE64` | Base64 PKCS#12 containing the existing Developer ID Application certificate and its private key |
| `APPLE_CERTIFICATE_PASSWORD` | Nonempty password protecting that PKCS#12 |
| `APPLE_ID` | Apple account allowed to notarize for team `TRGDCMBX3J` |
| `APPLE_APP_SPECIFIC_PASSWORD` | That account's app-specific password for notarization |

Team `TRGDCMBX3J` and the identity qualifier `Ramiro Rivera (TRGDCMBX3J)` are public configuration. The builder chooses the Developer ID Application certificate type. No Developer ID Installer certificate or provisioning profile is required for these non-App-Store DMG/ZIP targets. The secret list was empty at the benchmark's start; this candidate doesn't provision secrets or export keys.

Only the macOS tag packaging step receives secrets. Dependency installation and app compilation run before that step. electron-builder 26.18.0 imports `CSC_LINK` into a temporary keychain, configures noninteractive signing access and removes it on disposal. The workflow also deletes leftover keychains and certificate files in its dedicated runner temporary directory with `always()`. Secrets aren't written to `GITHUB_ENV`, caches, effective builder configuration or release assets. Don't enable shell tracing or builder debug logs around credentials. Tag creation must remain limited to trusted code; this workflow doesn't use `pull_request_target` or sign PR code.

Hardened runtime is on for signed builds. The explicit entitlement file preserves the pinned builder's Electron JIT, executable-memory and library-loading baseline and adds microphone access. It doesn't enable App Sandbox or debugging entitlement `get-task-allow`. node-hid, koffi and the native media framework stay outside ASAR; the canonical signer recursively signs Mach-O binaries, native modules, frameworks and Electron helpers. The existing microphone/audio purpose strings remain. These entitlements allow runtime operation, they don't grant user permissions or prove physical hardware/audio acceptance. Keep the packaged native smoke as the runtime compatibility gate.

The builder uses `notarytool`, waits for acceptance and staples the app before creating DMG/ZIP. The smoke verifies the actual app mounted from DMG and extracted from ZIP with strict recursive `codesign`, expected authority/team, hardened runtime and secure timestamp, `stapler validate`, and Gatekeeper `spctl --assess`. A missing ticket or rejected signature blocks collection and publication. The DMG container itself isn't separately signed or notarized; the stapled app is what both formats distribute. ZIP files can't themselves be stapled.

To validate locally without publishing, use the existing Keychain identity with an existing notarytool profile. Once unattended private-key access and profile availability have been confirmed by an authorized operator, set these public selectors in Nushell, then run the normal build and package commands:

```nu
$env.OPEN_QUAKE_APPLE_SIGNING = '1'
$env.APPLE_TEAM_ID = 'TRGDCMBX3J'
$env.APPLE_KEYCHAIN_PROFILE = '<existing-profile-name>'
$env.RELEASE_VERSION = '0.0.0'
pnpm --filter @open-quake/desktop build
pnpm --filter @open-quake/desktop package --mac --arm64
pnpm --filter @open-quake/desktop test:package
```

Packaging always uses `--publish never`. Signing and notarization still use the private key and submit the app to Apple; they're separate from release publication and weren't performed for this candidate. `APPLE_KEYCHAIN` can select an existing profile's keychain. Alternatively use the Apple ID pair from an already configured private environment, with no profile variables. Mixed credentials and API-key credentials are rejected explicitly to keep the supported path unambiguous. Ordinary local builds need none of these variables.

For signature/ticket inspection alone, without launching the app, run `node apps/desktop/scripts/verify-apple-signing.mjs /path/to/open-quake.app`. For runtime verification, `test:package` additionally launches hidden smoke windows and loads native bindings, so follow the host's test authorization rules. Full signed/notarized artifact validation remains outstanding until the signing key and notarization account/profile are available through an authorized route.

Implementation references: [Electron signing guide](https://www.electronjs.org/docs/latest/tutorial/code-signing), [Apple notarization requirements](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution), and the installed pinned sources `app-builder-lib@26.18.0/out/mac/MacTargetHelper.js`, `out/macPackager.js`, `out/codeSign/macCodeSign.js`, its `templates/entitlements.mac.plist`, `@electron/osx-sign@1.3.3` and `@electron/notarize@2.5.0`. The builder source is authoritative for this version's environment names, identity qualifier and lifecycle; current web docs can describe a different version.
