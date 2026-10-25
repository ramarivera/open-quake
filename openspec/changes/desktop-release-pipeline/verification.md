# Desktop release verification

Implementation is tracked by open-quake-bgu.1; hosted verification and the requested bot-review round remain open in open-quake-bgu.2.

Local Apple Silicon verification passed with electron-builder 26.18.0 and Electron 43.4.1. The generated DMG and ZIP use version 0.0.0-test.1. The packaged executable loaded the real node-hid native binding and koffi, rendered the production React thumbnail surface through the real preload, completed IPC and emitted `PACKAGE_SMOKE_PASS darwin arm64 0.0.0-test.1`, exit 0. It never opened hardware. Production bundle startup passed in both default-HID and explicit mock modes. A type-only export correction produced byte-identical build output.

Nine release tests passed, covering version validation, the complete eight-asset matrix, checksum content, missing/empty/extra assets, stable/prerelease publication, draft retries, published-release refusal, failed API lookups, failed uploads and incomplete uploads. Desktop typecheck, Biome, strict OpenSpec validation and actionlint passed.

Native installer builds on Windows and Linux, combined hosted artifact validation and review of the round-one changes are pending. No version tag, public release or npm publication has been created. The workflow's real publication/attestation path remains unexercised until an authorized version tag is pushed.

Local artifacts remain outside git under /Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-release/verified-build/. T3 Code matrix reference is pingdotgg/t3code at e57c093cdd9032355c6251dd7192280b915b7a23. The executor reference is 42b5508ca30bb0714ea1b9d1d628bef5a9759229. Ramiro explicitly excluded Intel Mac builds.

## Review round one

The first hosted run, 40187671430 on 853fa26, failed validation before packaging. Multiple Turbo suites each started a Vitest worker pool on a small runner, and a profile test exceeded the default deadline. Validation now runs one package suite at a time with at most two test workers, without changing assertions or timeouts. A two-core Linux reproduction also exposed macOS bookmark tests that did not select their intended platform and lifecycle teardown accepting a stale quit call before asynchronous cleanup finished. Both fixtures are corrected. Their 37 focused tests pass on Mac and Linux. The full bounded suite passed 1,797 tests across 190 files on Linux. A Mac full run with the same bounded concurrency also passed 1,797 tests; its initial scratch invocation failed because Turbo filtered TMPDIR and the existing backup symlink guard rejected the host's temporary-directory alias. The corrected local invocation forwarded the scratch environment; backup safety was preserved.

Codex completed review of 853fa26 without findings. Copilot errored, CodeRabbit skipped the stacked base and Macroscope skipped, so none of those statuses count as a completed review. Devin supplied two findings, both accepted. Recording now probes the external FFmpeg encoder list before requesting permissions or creating capture windows and returns a typed installation error when it cannot encode MP3. FFmpeg remains an explicit system prerequisite. The distributed-artifact smoke now mounts the DMG, extracts the ZIP, installs/uninstalls the Windows EXE, installs/removes the DEB and runs the AppImage. NSIS automatic launch is disabled so installation cannot accidentally start the normal hardware application during smoke testing.

Thirteen focused recording/registration tests pass on both Mac and Linux, including missing/failed converters, absent MP3 encoding, typed error identity and private cause retention. Updated local DMG and ZIP both passed their real distributed-artifact smoke with `PACKAGE_SMOKE_PASS darwin arm64 0.0.0-test.1`, exit 0. All workspace typechecks, Biome on 821 files, nine release tests, both production bundle modes, actionlint and strict OpenSpec validation passed. Linux/Windows installer behavior remains unverified until the next hosted run finishes.

Round-one artifacts and logs remain outside git under /Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-release/, including round1-build, round1-distributed-smoke.log and linux-fixed-full-v2.log. No public release, version tag or merge has occurred.

## Hosted installer diagnosis

Run 40188815594 passed validation and the complete Mac arm64 and Linux arm64 jobs. Windows x64 built and silently installed its EXE, but the executable rejected `--package-smoke` with exit 9. The runner was supplied an empty ELECTRON_RUN_AS_NODE value; Windows can still treat that variable as present. The smoke now removes that key entirely, including differently cased inherited variants. Linux x64 built both downloads but the smoke expected x64 filenames. The pinned builder actually expands x64 to amd64 for DEB and x86_64 for AppImage. One shared filename function now serves the smoke, checksum manifest and publication validation.

Two regression tests first failed with the observed filename mismatch and retained Node-mode variable, then passed after correction. All 11 release tests pass, including a comparison against the installed pinned builder's architecture-macro expansion for all eight assets. Both Mac distributed smokes still pass using the corrected child environment. The full suite and app bundles did not change in this diagnostic fix.

Windows arm64 built its installer but timed out during silent installation with no output. Its cause is still unverified. The smoke now prints bounded process and installed-file diagnostics at 60 seconds while retaining the existing 120-second installation deadline. This does not claim to fix that separate failure. Hosted reruns and review of the changed release scripts remain pending.
