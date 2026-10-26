# Tasks

Implementation is tracked by open-quake-18d under open-quake-lih.13. Checked tasks have source and automated evidence in apps/desktop/src/main/maintenance/README.md and the lane report. Task 3.2 stays open until supervised physical acceptance; mock results never close it.

## 1. Protocol and image evidence

- [x] 1.1 Confirm standard UF2 magic and target provenance/recovery proposals (`SETTINGS-047/048`) and document exact DFU framing with the SDK owner; verify no duplicate framing implementation and no guessed flash range.
- [x] 1.2 Implement pure image/target validators and documented DFU encoding fixture in protocol; verify family/magic/count/range/overlap rejection and standard newline magic acceptance and null-terminated magic rejection fixtures (`SETTINGS-048`).

## 2. Update lifecycle and adapters

- [x] 2.1 Implement selected-device DFU serialization, conflicting-write pause and catalog errors; verify cancel/target loss/concurrent update and exactly one known DFU command through a fake HID consumer.
- [x] 2.2 Implement boot-volume/bookmark inspection, explicit disambiguation and image/volume revalidation; verify stale data-volume bookmarks cannot receive a copy and multiple candidates require selection.
- [x] 2.3 Implement exclusive copy/reconnect workflow with persisted interruption state; verify partial-copy recovery, no automatic reflash and copy/volume disappearance never imply completed.

## 3. Update UI and acceptance

- [x] 3.1 Wire real firmware inspect/DFU/update/recovery controls through the typed client with local recovery documentation; verify each state and every confirmation/cancel path.
- [ ] 3.2 Run all firmware-dfu scenarios with synthetic images and fake hardware/filesystem layers, then supervised hardware DFU/flash/reconnect checks when available; record exact report bytes, target/version evidence and leave unrun hardware steps open.

## 4. Firmware burn-down lane

- [x] 4.1 Implement trusted bundled discovery and retained availability with synthetic fixtures, tracked by open-quake-lih.13.1.
- [x] 4.2 Implement bounded progress, Windows lookup cadence, close reconciliation and renderer lifecycle/guidance tests, tracked by open-quake-lih.13.2.
- [ ] 4.3 Validate the actual audited production image. Blocked by this lane's synthetic-only instruction; no real firmware binary may be opened or downloaded.

## 5. PR 102 review fixes

Tracked by open-quake-18d.8. Each finding gets a regression, commit, push and reply; threads remain unresolved.

- [x] 5.1 Replace installer path handoff with a verified private descriptor-backed copy and refuse cache swaps, review 4379260349.
- [x] 5.2 Stream bounded downloads and verification, review 4379258894.
- [x] 5.3 Keep Settings available with unreadable optional firmware directories, review 4379259396.
- [x] 5.4 Accept newer hardware version observations, review 4379259164.
- [x] 5.5 Finish normally returning installs, review 4379259656.
- [ ] 5.6 Prune superseded update artifacts, review 4379259888.
- [ ] 5.7 Persist bounded intermediate copy progress, review 4379260103.
- [ ] 5.8 Reconcile unanswered Codex/Copilot threads and run full gates plus synthetic native firmware smoke.
