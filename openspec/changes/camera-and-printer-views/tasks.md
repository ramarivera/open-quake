# Tasks

These are future implementation tasks. This lane creates specs only; no checkbox is complete. The parent creates one epic for this change and one issue per numbered task, using each task's text as its description and this OpenSpec path as its reference. Do not close implementation issues on planning-only evidence.

## 1. Gateway investigation and feed contract

- [ ] 1.1 Resolve question 5 by documenting executable start/stop, readiness, framing, auth and shutdown fixtures; verify a production adapter cannot be enabled while that evidence is missing.
- [ ] 1.2 Add gateway/frame/printer schemas, stale/backpressure invariants and adapter documentation; verify optional fields differ from zero, normalized printer states and timing bounds.

## 2. Adapters and lifecycle

- [ ] 2.1 Implement feed conductors and fake gateway adapter with catalog errors; verify latest-frame delivery, ten-second health rules, unsupported controls and credential-free diagnostics.
- [ ] 2.2 Implement a production gateway/process adapter only after its protocol gate is met; verify startup failure, last-subscriber teardown and no orphan process after failure/shutdown.

## 3. Views and acceptance

- [ ] 3.1 Wire actual camera, camera-control and printer tiles through typed feed clients; verify unconfigured/starting/live/offline/stale states and profile-switch cleanup.
- [ ] 3.2 Run every camera-and-printer-views scenario with fake feeds, then verified RTSP/printer endpoints and QUAKE output; document actual evidence and leave unknown control/hardware paths open.
