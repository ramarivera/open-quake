# Tasks

## 1. Device and desktop lifecycle

- [x] 1.1 Extend QuakeDevice with screen power and EIO recovery; implement bounded reconnect supervision. Verify with fake transport and TestClock, including typed failures and teardown.
- [x] 1.2 Implement physical display matching, serialized discovery, window grace, lock/wake recovery, single-instance startup and release fallback policy. Verify real main entrypoint with Electron mocked and TestClock lifecycle scenarios.

## 2. Diagnostics and host remediation

- [x] 2.1 Implement schema-checked authorized diagnostic IPC, connection page, Re-detect and consent/snooze prompts; document native calls. Verify mock consumer flows, permission rejection, prompt timings, renderer states and native smoke screenshots.

## 3. Integration and delivery

- [ ] 3.1 Run all lane gates, native smoke, inspect screenshots, sync beads with evidence, commit/push and open a PR against main with hardware limits. Verify clean git state and linked PR head.
