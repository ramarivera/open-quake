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
- [x] 4.9 Complete the requested Terra/Sol benchmark comparison under `open-quake-i3j.4`. The same-base comparison used the hardware diagnostics and Pino bridge tasks in `pre-hardware-observability`, with independent Opus 5.5 and Wonder Full judgments. This did not repeat already-solved Apple signing or unused port-helper research. Per-task results and one-run limits are in that change's design.

Final integration checks: all 20 release/signing tests pass after the documentation merge. Signing source and workflow behavior are unchanged from the locally verified candidate. Current-head hosted checks and review remain pending.

## 5. Hosted signing rehearsal, open-quake-i3j.7

- [x] 5.1 Add a main-only manual nonpublishing rehearsal using the existing signing/package/verification path and preserve PR secret isolation and tag-only publication. Ramiro explicitly approved this CI change. All 22 release/signing checks pass, including untrusted-ref rejection, forced signing on main, read-only contents permissions and tag-only publication.
- [x] 5.2 Run the reviewed workflow on GitHub and verify its signed/notarized DMG/ZIP artifacts without creating a tag. Workflow run 40569365883 succeeded on merged main d6cc8610, version 0.0.0-rehearsal.508. Both downloaded app copies passed the existing signature, expected identity/team, hardened runtime, timestamp, staple and Gatekeeper verifier. All five packages and the complete matrix passed. Publication was skipped and no release or rehearsal tag was created.

PR133 reviews 4391645019, 4391676290 and 4391676301: credential documentation and the earlier signing-secret requirement now include both macOS version-tag signing and main-only manual rehearsals. PR and Windows/Linux secret isolation is unchanged. Documentation-only correction; the 22 existing release/signing checks cover the referenced workflow behavior.

Hosted acceptance completed on 2026-10-27 under `open-quake-i3j.7`. Verification used both the hosted artifact checks and independent inspection of the downloaded DMG and ZIP without installation or local app launch. The DMG was detached and the extracted app removed. This proves the release pipeline at d6cc8610; it does not claim a hosted signed package of the later diagnostics merge.
