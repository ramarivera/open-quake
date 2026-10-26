## 1. Packaging and automation, open-quake-bgu.1

- [x] 1.1 Add pinned packaging tooling, bundle workspace dependencies and preserve unpacked native bindings.
- [x] 1.2 Add version validation, package smoke and release asset validation/checksums.
- [x] 1.3 Add five-target PR builds and tag-triggered complete-release publication.
- [x] 1.4 Document downloads, unsigned installation, Linux access and npm boundaries.

## 2. Verification and delivery, open-quake-bgu.2

- [x] 2.1 Run focused release tests, desktop checks and a real local packaged smoke.
- [x] 2.2 Commit, normally push and open a PR against the latest application branch.
- [x] 2.3 Reconcile hosted installer builds and one configured bot-review round.

## 3. Firmware burn-down updater, open-quake-lih.13.3

- [x] 3.1 Implement the disabled-by-default owned signed-metadata adapter, bounded artifact checks, asynchronous download, native install approval and renderer interaction tests using only synthetic feeds and nonexecutable bytes. Rows MAIN-114, SETTINGS-006, SETTINGS-049, SETTINGS-050.
- [ ] 3.2 Choose the owned feed, artifact origin, signing key distribution and packaged installer policy before enabling production delivery. Blocked by the lane's explicit no-real-feed/no-binary instruction.
