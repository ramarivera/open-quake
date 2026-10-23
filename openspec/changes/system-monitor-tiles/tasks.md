# Tasks

These are future implementation tasks. This lane creates specs only; no checkbox is complete. The parent creates one epic for this change and one issue per numbered task, using each task's text as its description and this OpenSpec path as its reference. Do not close implementation issues on planning-only evidence.

## 1. Contracts and evidence

- [ ] 1.1 Resolve the sampling/gaming proposals and map each metric to a real collector or unsupported status; verify a decision record and collector availability matrix against the cited sources.
- [ ] 1.2 Add monitoring schemas, sample/staleness and gaming-overlay invariants in packages/edge with API documentation; verify schema round-trips and fake-clock/property cases for rate bounds and restore behavior.

## 2. Collection and transport

- [ ] 2.1 Implement monitoring repository/conductor and catalog errors with scoped collection; verify non-overlap, disable-during-query, cleanup, retained cause and scrubbed diagnostics.
- [ ] 2.2 Add desktop collector/foreground adapters and typed client subscriptions; verify concurrent foreground requests share a query and one failing collector does not stop another.

## 3. Consumers and acceptance

- [ ] 3.1 Wire management controls, panel tiles and gaming mode to the shared state with consumer documentation; verify saving/disable/restore through the real controls and observe old collectors stop.
- [ ] 3.2 Run every system-monitor-tiles scenario through fake layers and targeted native collector smoke checks; record platform-specific support and leave physical panel evidence open until hardware is exercised.
