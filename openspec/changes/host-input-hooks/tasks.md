# Tasks

These are future implementation tasks. This lane creates specs only; no checkbox is complete. The parent creates one epic for this change and one issue per numbered task, using each task's text as its description and this OpenSpec path as its reference. Do not close implementation issues on planning-only evidence.

## 1. Host-input contracts

- [ ] 1.1 Resolve the focus/global-binding/clipboard proposals and record per-OS adapter support; verify documented input ownership agrees with profile and automation lane contracts.
- [ ] 1.2 Add chord/session/binding/selection schemas and capability entries with usage documentation; verify modifier normalization and empty-selection/unsupported round-trips.

## 2. Native lifecycle

- [ ] 2.1 Implement focused recording and global binding conductor/adapters; verify blur/window/shutdown cleanup, registration conflict rollback and held-key de-duplication.
- [ ] 2.2 Implement explicit selection/input adapters with catalog errors and conditional clipboard restore; verify denied injection performs no IO, concurrent clipboard changes survive and diagnostic output contains no captured text.

## 3. Consumer acceptance

- [ ] 3.1 Wire real recorder fields and authorized profile/automation consumers through the typed client; verify recording never invokes an action and unpermitted actions never reach the adapter.
- [ ] 3.2 Run all host-input-hooks scenarios, document OS permissions and capture native smoke evidence on supported hosts; keep actual permission prompts and physical triggers unverified until exercised.
