# Design

Use electron-builder with native GitHub-hosted runners for five operating-system/architecture combinations. T3 Code at e57c093cdd9032355c6251dd7192280b915b7a23 supplies the matrix and download-format reference. Ramiro's executor desktop workflow supplies the build-without-publish, artifact fan-in pattern. pi-goal publish.yml uses npm OIDC, but open-quake has no distributable npm CLI yet, so no registry package or token is introduced.

Bundle workspace TypeScript and JavaScript libraries into Electron main; keep node-hid and koffi external and unpack their native resources from ASAR. Use tag-derived SemVer as packaged metadata without changing internal workspace versions. PR builds use a prerelease version. Build jobs have read-only repository access; only the tag publication job can write releases. Do not expose publishing credentials to PR builds.

Validate version tags, gate publication on checks and all five native package builds, stage a draft release, upload every required installer and a SHA256 manifest, and publish only after complete upload. Prerelease tags remain prereleases and never replace latest stable. Never overwrite an already published release. Failed runs may leave a draft for a safe retry.

Exercise the distributed artifacts: mount the DMG, extract the ZIP, silently install/uninstall the NSIS EXE, install/remove the DEB and launch the AppImage. NSIS does not automatically launch the normal app after installation. Load real packaged native modules and the actual preload/renderer in hidden smoke windows with isolated user data. Never open hardware or run OS actions in this smoke. Existing bundle tests cover production main startup independently. These checks establish packaging and startup, not full platform/hardware parity.

Unsigned macOS builds may require explicit Gatekeeper approval and Windows shows an unknown publisher. Linux HID access needs a scoped udev rule. Linux display, shortcut and media support varies by compositor and isn't claimed equivalent to macOS. No signing, notarization, paid runner provider, registry publication, auto-updater or initial public version is required for this change.

Ramiro narrowed macOS to Apple Silicon only on 2026-10-25. Intel Mac builds are excluded; Windows and Linux retain both architectures.

FFmpeg remains a documented external prerequisite rather than a bundled executable. Before recording, probe its encoder list with an eight-second deadline and require libmp3lame. A missing, failed or incompatible converter produces a catalogued installation error before permission requests or capture-window creation. Mock capture and live translation do not need the recording converter.

## Approved release policy 2026-10-27

Linux AppImage is the primary automatic update target. The runtime resolves only stable releases in ramarivera/open-quake, verifies the GitHub asset SHA-256 and byte count, and atomically replaces the existing AppImage after confirmation. deb packages use the owned release page for manual installation. Windows remains unsigned with no paid signing service. No CI changes are part of open-quake-i3j.

macOS distribution must move from the current ad-hoc builder configuration to Developer ID Application signing with hardened runtime and Apple notarization. This needs verified paid Developer Program membership, a Developer ID certificate/private key and notarization credentials entered through the secret mechanism. Those credentials are absent from this lane. The current config remains ad-hoc; no signed or notarized build is claimed. A release operator must explicitly enable and verify that configuration after credentials are provisioned.
