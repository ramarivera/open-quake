# Tasks

These are future implementation tasks. This lane creates specs only; no checkbox is complete. The parent creates one epic for this change and one issue per numbered task, using each task's text as its description and this OpenSpec path as its reference. Do not close implementation issues on planning-only evidence.

## 1. Clock contract

- [ ] 1.1 Confirm local-time/default-format and scheduling proposals; verify the recovered preset/12h conversion references and record the accepted clock contract.
- [ ] 1.2 Add clock configuration/format invariants and profile integration documentation; verify midnight, noon, invalid format and date/timezone boundary cases with a fake clock.

## 2. Views and lifecycle

- [ ] 2.1 Implement shared visible-clock scheduling and cleanup in desktop adapters; verify resume/timezone refresh, no replayed ticks and zero timers after last view closes.
- [ ] 2.2 Wire the DK-Desktop-Clock preset and format editor through the profile owner; verify save/restart preserves the key format without changing unrelated fields.

## 3. Acceptance

- [ ] 3.1 Exercise management/panel clock consumers under normal and reduced motion with documented setup; verify matching labels across rollover and theme/motion changes.
- [ ] 3.2 Run all desktop-clock scenarios and capture actual panel layout when hardware is available; record hardware as unverified until that evidence exists.
