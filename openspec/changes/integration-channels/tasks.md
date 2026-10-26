# Tasks

These are future implementation tasks. This lane creates specs only; no checkbox is complete. The parent creates one epic for this change and one issue per numbered task, using each task's text as its description and this OpenSpec path as its reference. Do not close implementation issues on planning-only evidence.

## 1. Catalog and runtime boundary

- [ ] 1.1 Record the six recovered descriptor fixtures and China/international grouping (`CENTER-072/073`), then confirm setup/expiry proposals; verify each planned adapter names its owning runtime contract.
- [ ] 1.2 Add channel/setup/status schemas, registry invariants and public API documentation; verify empty catalog, unsupported setup type and credential-free status round-trips.

## 2. Setup lifecycle

- [ ] 2.1 Implement channel repository/conductor and runtime adapter interface with catalog errors; verify save is distinct from connection, unavailable runtime does not install and disabled status survives restart.
- [ ] 2.2 Implement session-correlated QR/credential setup and removal; verify expiry/cancel/late events, secret deletion failure and isolation from unrelated channels using fake adapters.

## 3. Hub acceptance

- [ ] 3.1 Wire catalog cards, setup drawer, QR progress, disable/remove and error states through the typed client with adapter-author documentation; verify actual UI flows on empty and controllable fixture catalogs.
- [ ] 3.2 Run all integration-channels scenarios and one real adapter pairing after runtime readiness; retain the source-verified catalog evidence and record external pairing as unverified until exercised.

## Agents burn-down lane, 2026-10-26

- [x] A.1 Preserve all six recovered channel descriptors and localized metadata in eight locales, with fallback and both regional groups. Sources CENTER-072/073. Bead `open-quake-lih.17.11`; `channel-catalog.test.ts` checks the source-derived fields and locale fallback.
- [x] A.2 Bind the production integrations composition to an explicitly selected local OpenClaw CLI using isolated state. Keep installed-capability checks, configuration, verified status, disable/remove, QR cancellation/expiry and pairing approval distinct from installation. Sources CENTER-074/077/078/079. `channel-runtime.test.ts` and `channel-registration.test.ts` drive the adapter and production registration with fake command runners. No real channel credentials or messaging accounts were used.
- [x] A.3 Localize cards, distinguish Configured from Connected, dispatch settings invalidation and expose portal failures. Source CENTER-075; mounted `channel-cards.test.tsx` covers the actual controls.
- [ ] A.4 Live acceptance remains required for CENTER-074/077/078/079. Plugin installation is deliberately absent. CLI version/plugin compatibility and ASCII-only QR output remain unverified; URL and PNG data-URL events work at the fake transport boundary. Do not count a configured fake channel as a paired real channel.
