# Tasks

These are future implementation tasks. This lane creates specs only; no checkbox is complete. The parent creates one epic for this change and one issue per numbered task, using each task's text as its description and this OpenSpec path as its reference. Do not close implementation issues on planning-only evidence.

## 1. Protocol and image evidence

- [ ] 1.1 Resolve UF2 compatibility/target provenance/recovery proposals and document exact DFU framing with the SDK owner; verify no duplicate framing implementation and no guessed flash range.
- [ ] 1.2 Implement pure image/target validators and documented DFU encoding fixture in protocol; verify family/magic/count/range/overlap rejection and a narrowly scoped newline-header compatibility fixture.

## 2. Update lifecycle and adapters

- [ ] 2.1 Implement selected-device DFU serialization, conflicting-write pause and catalog errors; verify cancel/target loss/concurrent update and exactly one known DFU command through a fake HID consumer.
- [ ] 2.2 Implement boot-volume/bookmark inspection, explicit disambiguation and image/volume revalidation; verify stale data-volume bookmarks cannot receive a copy and multiple candidates require selection.
- [ ] 2.3 Implement exclusive copy/reconnect workflow with persisted interruption state; verify partial-copy recovery, no automatic reflash and copy/volume disappearance never imply completed.

## 3. Update UI and acceptance

- [ ] 3.1 Wire real firmware inspect/DFU/update/recovery controls through the typed client with local recovery documentation; verify each state and every confirmation/cancel path.
- [ ] 3.2 Run all firmware-dfu scenarios with synthetic images and fake hardware/filesystem layers, then supervised hardware DFU/flash/reconnect checks when available; record exact report bytes, target/version evidence and leave unrun hardware steps open.
