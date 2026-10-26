# Tasks

The software implementation extends the seven-module panel with saved metric selection, app/window monitoring and monitoring override. Bluetooth reports unsupported in normalized state and management. See verification.md for scenario evidence and remaining target-platform/physical acceptance. Beads epic open-quake-s8d owns the numbered tasks; its acceptance issue stays open.

## 1. Contracts and evidence

- [x] 1.1 Resolve the sampling/monitoring override proposals and map each metric to a real collector or unsupported status; verify a decision record and collector availability matrix against the cited sources.
- [x] 1.2 Add monitoring schemas, sample/staleness and monitoring override invariants in packages/edge with API documentation; verify schema round-trips and fake-clock/property cases for rate bounds and restore behavior.

## 2. Collection and transport

- [x] 2.1 Implement monitoring repository/conductor and catalog errors with scoped collection; verify non-overlap, disable-during-query, cleanup, retained cause and scrubbed diagnostics.
- [x] 2.2 Add desktop collector/foreground adapters and typed client subscriptions; verify concurrent foreground requests share a query and one failing collector does not stop another.

## 3. Consumers and acceptance

- [x] 3.1 Wire management controls, panel tiles and monitoring override to the shared state with consumer documentation; verify saving/disable/restore through the real controls and observe old collectors stop.
- [ ] 3.2 Run every system-monitor-tiles scenario through fake layers and targeted native collector smoke checks; record platform-specific support and leave physical panel evidence open until hardware is exercised.
