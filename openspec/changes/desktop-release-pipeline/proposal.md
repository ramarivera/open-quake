# Tagged desktop releases

## Why

There are no published releases or installer builds. Development commands do not provide an installable desktop app. Ramiro requested tag-triggered downloads comparable to T3 Code, with unsigned packages permitted.

## What changes

- Package macOS arm64 DMG and ZIP, Windows arm64/x64 NSIS EXE, Linux arm64/x64 AppImage and DEB.
- Build and smoke-check installers on pull requests and version tags using GitHub Actions, then publish complete releases with checksums after all targets pass.
- Document unsigned installation, Linux device access and current platform limitations.
- Keep private SDK packages private. The CLI is currently a placeholder, not an npm-installable application.

## Impact

Desktop build configuration, native dependency packaging, release scripts, GitHub workflows and installation documentation. No automatic update client or first public tag is introduced. Outstanding application feature and physical acceptance tasks remain tracked separately.
