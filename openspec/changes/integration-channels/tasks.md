# Tasks

These are future implementation tasks. This lane creates specs only; no checkbox is complete. The parent creates one epic for this change and one issue per numbered task, using each task's text as its description and this OpenSpec path as its reference. Do not close implementation issues on planning-only evidence.

## 1. Catalog and runtime boundary

- [ ] 1.1 Resolve question 9 and setup/expiry proposals by recording supported descriptor fixtures rather than inventing a complete catalog; verify each planned adapter names its owning runtime contract.
- [ ] 1.2 Add channel/setup/status schemas, registry invariants and public API documentation; verify empty catalog, unsupported setup type and credential-free status round-trips.

## 2. Setup lifecycle

- [ ] 2.1 Implement channel repository/conductor and runtime adapter interface with catalog errors; verify save is distinct from connection, unavailable runtime does not install and disabled status survives restart.
- [ ] 2.2 Implement session-correlated QR/credential setup and removal; verify expiry/cancel/late events, secret deletion failure and isolation from unrelated channels using fake adapters.

## 3. Hub acceptance

- [ ] 3.1 Wire catalog cards, setup drawer, QR progress, disable/remove and error states through the typed client with adapter-author documentation; verify actual UI flows on empty and controllable fixture catalogs.
- [ ] 3.2 Run all integration-channels scenarios and one real adapter pairing after runtime readiness; record catalog and external pairing evidence as unverified until then.
