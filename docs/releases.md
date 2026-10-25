# Install and release open-quake

Download installers from [GitHub Releases](https://github.com/ramarivera/open-quake/releases). A workflow on a branch or a green review check isn't a published release. Until the first version tag is published, PR builds are available only as zipped GitHub Actions artifacts, usually requiring a GitHub login.

| System | Architecture | Downloads |
| --- | --- | --- |
| macOS | Apple Silicon, arm64 | DMG and ZIP |
| Windows | Intel/AMD, x64 | EXE installer |
| Windows | ARM64 | EXE installer |
| Linux | Intel/AMD, x64 | AppImage and DEB |
| Linux | ARM64 | AppImage and DEB |

Intel Mac packages aren't built. Choose the package matching your system architecture. The desktop app is self-contained, so Node.js and npm aren't needed to install it. Workspace packages are private, and the CLI is a placeholder. `npm install open-quake` isn't an installation method.

## Unsigned builds

macOS packages have an ad-hoc signature for Apple Silicon execution, without a Developer ID signature or notarization. Drag the app from the DMG into Applications. macOS may block the first launch. After verifying the download, use System Settings > Privacy & Security > Open Anyway if macOS offers it. Organization-managed Macs may forbid this. Grant Accessibility, Microphone or Screen Recording permissions only for the features you use.

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

The release job alone has write permission and uses GitHub's short-lived token. No npm token, Apple identity or Windows signing certificate is needed. The pi-goal npm OIDC workflow was inspected as a reference, but npm trusted-publisher configuration isn't needed until there's an intentionally public npm package.

A failed target prevents publication. Failed uploads can leave a draft; fix the cause and rerun the workflow for the same immutable tag. The workflow can retry a draft, but refuses to replace a published release. Don't move tags to repair releases. Publish a new version instead.

There's no automatic updater in this change. Download and install a newer release manually.

## Local packaging

Use Node 24 and the repository's pinned pnpm version. On the target operating system, run `pnpm install --frozen-lockfile`, `pnpm --filter @open-quake/desktop build`, then `pnpm --filter @open-quake/desktop package --mac --arm64` on Apple Silicon, `--win --x64` or `--win --arm64` on Windows, or `--linux --x64` or `--linux --arm64` on Linux. Build the matching architecture natively. Output goes to the ignored `apps/desktop/dist/` directory.

For a packaged smoke check, set `RELEASE_VERSION` to the package version, then run `pnpm --filter @open-quake/desktop test:package`. The default local version is `0.0.0`; CI uses the tag version or an explicit PR prerelease version. On Linux run the check under `xvfb-run -a` if no display is available. The smoke window stays hidden and never opens the QUAKE or emits keyboard/media actions.
