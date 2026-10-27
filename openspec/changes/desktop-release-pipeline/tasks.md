## 1. Packaging and automation, open-quake-bgu.1

- [x] 1.1 Add pinned packaging tooling, bundle workspace dependencies and preserve unpacked native bindings.
- [x] 1.2 Add version validation, package smoke and release asset validation/checksums.
- [x] 1.3 Add five-target PR builds and tag-triggered complete-release publication.
- [x] 1.4 Document downloads, unsigned installation, Linux access and npm boundaries.

## 2. Verification and delivery, open-quake-bgu.2

- [x] 2.1 Run focused release tests, desktop checks and a real local packaged smoke.
- [x] 2.2 Commit, normally push and open a PR against the latest application branch.
- [x] 2.3 Reconcile hosted installer builds and one configured bot-review round.

## 3. Firmware burn-down updater, open-quake-lih.13.3

- [x] 3.1 Implement the disabled-by-default owned signed-metadata adapter, bounded artifact checks, asynchronous download, native install approval and renderer interaction tests using only synthetic feeds and nonexecutable bytes. Rows MAIN-114, SETTINGS-006, SETTINGS-049, SETTINGS-050.
- [ ] 3.2 Choose the owned feed, artifact origin, signing key distribution and packaged installer policy before enabling production delivery. Blocked by the lane's explicit no-real-feed/no-binary instruction.

## 4. Apple release signing, open-quake-i3j.4

- [x] 4.1 Wire release-only Apple credentials into the existing macOS tag packaging step with canonical builder import/notarization and always-run cleanup; preserve unsigned PR/local and Windows/Linux packaging.
- [x] 4.2 Require hardened runtime, explicit Electron/native entitlements and signed/stapled artifact checks for the app in both DMG and ZIP; cover gating and verifier failure paths with focused tests.
- [x] 4.3 Document the installed certificate, runner credential references and nonpublishing validation path; keep settings signing claims unchanged.
- [x] 4.4 Authorized operator verifies unattended key access and notarization credentials, provisions the runner through the private secret route, and validates actual signed/notarized DMG/ZIP without publication. Certificate provisioning itself is already solved. Completed under `open-quake-i3j.6`: the existing credentials are provisioned to GitHub, and local candidate `d51bd19b` passes actual DMG/ZIP signature, staple and Gatekeeper verification. Hosted signed tag execution remains unperformed. The Terra comparison is tracked separately below.

Initial candidate verification before authorized credential setup, 2026-10-27: 19 focused release tests pass, including the pinned builder schema/helper consumer, unsigned/tag/platform gating, credential isolation, both format verification calls and rejected signature/ticket states. Scoped Biome, JavaScript type checks, plist validation and workflow shell syntax pass. OpenSpec validation passes with pre-existing long-requirement warnings; strict mode retains those same warnings. actionlint is unavailable through both the host shim and mise. No real signing/notarization, credential mutation or publication was attempted.

- [x] 4.5 Keep published release notes consistent with the required macOS signing policy and Windows unsigned policy. Verify the actual notes file used by publishRelease. PR132 review 4388246418, bead open-quake-i3j.4.

- [x] 4.6 Support the owner's existing notarization API credential without creating a new Apple ID password. Keep API material in the trusted signing step and private temporary file, reject incomplete/mixed modes, and retain local profile/Apple ID compatibility. Bead `open-quake-i3j.6`. All 20 focused release tests pass, including pinned builder configuration, credential-mode checks, workflow secret isolation, shell syntax and cleanup ordering. Authorized setup restored the existing project decryption identity, verified the signing key and certificate match, authenticated with Apple notarization, and provisioned all five GitHub Actions secrets. Actual local artifact verification passed for combined candidate `d51bd19b`; hosted signed tag execution has not run.

- [x] 4.7 Reconcile proposal/design signing scope after review 4389763081: macOS PR and ordinary local builds remain ad-hoc, macOS tags require signing/notarization, and Windows/Linux remain unsigned. Record credential provisioning separately from signed-artifact acceptance; later acceptance is recorded under 4.4. Bead `open-quake-i3j.6`.

- [x] 4.8 Integrate reviewed main, preserve updater policy and replace obsolete signing prerequisites with verified credential and local-artifact facts. Bead `open-quake-i3j.5`. Both distributed app copies pass the existing verifier; the parent independently rechecked the DMG and both artifact hashes. No installation, GUI launch, hardware test, tag or publication occurred.
- [ ] 4.9 Complete the requested Terra/Sol benchmark comparison under `open-quake-i3j.4`; completed Apple credential/artifact verification does not settle that separate comparison.

Final integration checks: all 20 release/signing tests pass after the documentation merge. Signing source and workflow behavior are unchanged from the locally verified candidate. Current-head hosted checks and review remain pending.
