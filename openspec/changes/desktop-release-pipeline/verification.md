# Desktop release verification

Implementation is tracked by open-quake-bgu.1; hosted verification and the requested bot-review round remain open in open-quake-bgu.2.

Local Apple Silicon verification passed with electron-builder 26.18.0 and Electron 43.4.1. The generated DMG and ZIP use version 0.0.0-test.1. The packaged executable loaded the real node-hid native binding and koffi, rendered the production React thumbnail surface through the real preload, completed IPC and emitted `PACKAGE_SMOKE_PASS darwin arm64 0.0.0-test.1`, exit 0. It never opened hardware. Production bundle startup passed in both default-HID and explicit mock modes. A type-only export correction produced byte-identical build output.

Nine release tests passed, covering version validation, the complete eight-asset matrix, checksum content, missing/empty/extra assets, stable/prerelease publication, draft retries, published-release refusal, failed API lookups, failed uploads and incomplete uploads. Desktop typecheck, Biome, strict OpenSpec validation and actionlint passed.

Native installer builds on Windows and Linux, combined hosted artifact validation and the bot round are pending. No version tag, public release or npm publication has been created. The workflow's real publication/attestation path remains unexercised until an authorized version tag is pushed.

Local artifacts remain outside git under /Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-release/verified-build/. T3 Code matrix reference is pingdotgg/t3code at e57c093cdd9032355c6251dd7192280b915b7a23. The executor reference is 42b5508ca30bb0714ea1b9d1d628bef5a9759229. Ramiro explicitly excluded Intel Mac builds.
