# Tasks

These are future implementation tasks. This lane creates specs only; no checkbox is complete. The parent creates one epic for this change and one issue per numbered task, using each task's text as its description and this OpenSpec path as its reference. Do not close implementation issues on planning-only evidence.

## 1. Contract and configuration

- [ ] 1.1 Confirm the endpoint/TLS/AI-intent proposals and obtain a user-controlled HA test fixture plan; verify decisions and dependencies on AI/profile capability contracts are recorded.
- [ ] 1.2 Add endpoint, entity/service and service-data schemas plus HA repository and protected-secret documentation; verify origin validation, numeric/select field validation and redacted config serialization.

## 2. Connection and execution

- [ ] 2.1 Implement HA connection generation, entity/service refresh and catalog errors behind a host adapter; verify auth/certificate failure, stale response rejection and isolated TLS policy.
- [ ] 2.2 Implement the shared HA action capability for configured keys and validated intents; verify invalid intents send no request and dropped mutation responses are not replayed on reconnect.

## 3. UI and acceptance

- [ ] 3.1 Wire connect/reconnect, room/domain selectors, field editor and entity display to the typed client; verify the real editor saves the intended entity ID and preserves the last valid key on validation failure.
- [ ] 3.2 Run all home-assistant-integration scenarios against fakes and then an HA test instance; record exactly-one service call from a real key action and leave device/hardware claims open without evidence.
