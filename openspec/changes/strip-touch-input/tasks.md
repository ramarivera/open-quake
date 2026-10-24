# Tasks

## 1. Vendor device input

- [x] 1.1 Implement bounded raw parsing, identity and contact tracking; verify vectors, malformed input, nearest matching and 100 ms/capture scenarios with properties and TestClock. Document recovered layout.
- [x] 1.2 Bind the scoped touch reader behind QuakeDevice with retries, read recovery, lock/wake controls and safe health; verify fake transport lifecycle and cancellation.

## 2. Strip input

- [x] 2.1 Implement coordinate normalization, injected tile resolver, single-key and overlay arbitration; verify actual event-consumer routing and delayed releases.
- [x] 2.2 Implement reusable sub-target registry, tap/scroll recognition and monitor/chat physics; verify threshold scenarios and bounded-motion properties, and document cross-lane interfaces.

## 3. Integration and delivery

- [x] 3.1 Feed synthetic raw frames in mock mode and add the opt-in guarded capture script; verify mock delivery and script guards without opening hardware.
- [x] 3.2 Run all lane gates and native mock smoke, record evidence and unverified hardware findings, synchronize beads, commit, push and open the PR.
