# Tasks

The parent creates an epic and one issue per checkbox at this OpenSpec path. Source tier S is not execution evidence; only close tasks with their stated verification.

## 1. First-release registry and typed inputs

- [x] 1.1 Record Ramiro's decisions on first-release payloads, default text-enter behavior, supported host keys, and open question 10; record the initial hotkeySwitch deferral and its MAIN-067 resolution by key-library-parity.
- [x] 1.2 Add a single packages/device capability registry and action Schemas for website/hotkey/text/open/media, plus profile/knob/clock integration descriptors; verify every first-release entry has input validation, permission/autonomy, support flags, aliases, and an explicit required adapter.
- [x] 1.3 Add narrow import normalization for next-track's mismatched type, localized hotkey sentinels, and empty text-enter objects; verify fixtures preserve originals and do not rewrite a genuine previous-track tile or hotkeySwitch.
- [x] 1.4 Add the action conductor, typed host interfaces, per-reason catalog errors, and no-auto-retry policy for side effects; verify invalid/unavailable actions produce distinct scrubbed failures and no adapter calls.

Evidence for tasks 1.1–1.4 is recorded in `verification.md`. Parent owns Beads updates for open-quake-r7r.1 through open-quake-r7r.4.

## 2. First-release host adapters and editors

- [ ] 2.1 Implement desktop hotkey and text insertion adapters with an explicit supported-token catalog; verify exact newline text insertion, optional enter ordering, modifier cleanup, permission denial, and one press/release producing one operation through the real adapter consumer.
- [ ] 2.2 Implement desktop website and application launch adapters; verify http/https validation, selected-app launch, missing-app failure, and that paths are never interpreted as shell commands; document platform limits.
- [ ] 2.3 Implement media command dispatch per supported host command; verify all eight media values with adapter fixtures and exercise supported commands on the host, leaving unsupported repeat/random commands visibly unavailable.
- [ ] 2.4 Build the library and operation editor from registry metadata; verify independent assigned copies, incomplete drafts, knob-support hotkey fields, and non-executing preview/save behavior through actual editor interactions.
- [ ] 2.5 Add app-owned/user-import artwork references and shared fallback rendering; verify missing artwork leaves action payloads intact and document local asset ownership without copying recovered icon packs.
- [ ] 2.6 Connect normalized input to committed profile/page revisions; verify one press/release dispatches once, stale revisions cannot execute new actions, and rendering/import/drag/save never call host adapters.

## 3. Later catalog and composite runtime

- [ ] 3.1 Register later timer/device-toggle/folder/audio/AI/agent/HA/camera/printer/cmd/monitor metadata with explicit runtime dependencies; verify unavailable entries cannot execute and document all submenu coverage from design.md.
- [ ] 3.2 Implement ordered non-recursive multiActions and delay after their leaf adapters exist; verify sequence order, cancellation, first-failure stop, held-input cleanup, and no reconnect replay using the real sequence consumer.
- [ ] 3.3 Enable each later function only with its owning domain's Schema, dispatch, and integration evidence; verify that registering metadata alone never marks a backend available and record dependency links per family.
- [x] 3.4 Resolve hotkeySwitch using MAIN-067 and Ramiro's 2026-10-24 key-library scope. Implement consecutive presses, held/release suppression, profile/revision continuity, disconnect reset and alternate artwork in key-library-parity; verify with key-runtime.test.ts, action-service.test.ts and the native key-library smoke.

## 4. Integration close-out

- [ ] 4.1 Run first-release function scenarios through management assignment, saved profile, normalized input, and host output, then repository gates; verify diagnostics omit text/URLs/private paths, validation passes, and unsupported platform/hardware results remain explicit.

## 8. key-runtime burn-down

- [x] 8.1 Implement saved native dispatch and sequence/plugin seam. Beads open-quake-lih.10.22 and .25; .25 remains a plugins handoff.
- [x] 8.2 Implement scoped timer completion, debounce, zero-clear and feedback expiry. Bead open-quake-lih.10.23.
- [x] 8.3 Implement saved nested folder/profile navigation using existing allocation and selection. Bead open-quake-lih.10.24.

Key-runtime verification on 2026-10-27: 5001 root tests passed, four existing skips, six package typechecks passed, Biome had zero errors, build and both bundle checks passed. The existing hidden mock native smoke passed with EN/DE timer, page indicator, progress and checkmark captures. MAIN-076 and plugin MAIN-066 remain partial under open-quake-lih.10.25. OpenSpec 1.15 strict reports 9 passed and 38 failed from existing long-requirement warnings, tracked in open-quake-lih.23.2; the added lane requirements have no diagnostics. Physical QUAKE and native Linux/Windows acceptance remain unverified. All lane beads stay open for lead integration.

## PR #127 final hosted-validation fix

- [x] Reuse immutable sequence dropdown options and a compiled support predicate across rows. Bead `open-quake-lih.10.27`. Preserve the 100-operation capacity, rejection feedback, single-write save and canonical Close draft/value/force behavior. Verification lives in the bead and supplied scratch directory; hosted validation remains for the lead.

## PR #127 authorized residual continuation

- [x] Validate sequence audio through the soundboard owner before host effects, renew equal-percentage progress expiry across revisions, and route optional text media follow-ups through the shared hotkey owner. Bead `open-quake-lih.10.28`. Focused fake regressions cover malformed sound payloads, valid playback/empty stop ordering, absent preflight, both progress lifetimes, supported media commands and failure-before-insertion behavior. Parent owns current-head CI/review acceptance; the bead stays in progress.

Continuation verification: 110 focused device tests and 56 desktop adapter/soundboard tests passed; the new regressions fail against the original source. Device and desktop typechecks, repository lint and desktop build passed. Ordinary validation passes both owning changes with the existing length warnings; strict baseline remains tracked in `open-quake-lih.23.2`. No native input, device, audible playback or provider tests ran. The sequence-editor capacity optimization and assertions are unchanged.
