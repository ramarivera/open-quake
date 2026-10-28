## 1. Move / swap, open-quake-fb9

- [x] 1.1 Reproduce the selector failure in a regression test, trace IPC and fix movement, persistence and panel preview.

## 2. Luminance title, open-quake-efm

- [x] 2.1 Keep Luminance title editing available under the owner's updated customization policy and add regression coverage.

## 3. Delivery

- [x] 3.1 Pass desktop typecheck/tests and root lint; record evidence in both beads.

Delivery uses branch `fix/keys-editor-sweep` and a PR against main. The beads record the PR and head after pushing. No merge or bot waiting.

## 4. Keys editor sweep

- [x] 4.1 Fix knob revisions and generic action field types, with regression coverage. Beads open-quake-3nd and open-quake-nf7.
- [x] 4.2 Fix closed-disclosure enumeration and explicitly exercise native clicks on function-library Emojis and JSON import, with regression coverage. Beads open-quake-dbf and open-quake-ayj.
- [x] 4.3 Preserve moved-key selection, reject hidden overlap and remove stale Luminance lock design. Bead open-quake-l86.26.
- [x] 4.4 Fix the three late PR152 findings, with regression coverage. Bead open-quake-l86.29.
- [x] 4.5 Separate enlarged two-line titles from artwork, with regression coverage. Title subset of open-quake-l86.24.
- [x] 4.6 Run before/after management exercise, desktop types/tests, device tests and root lint; record the verified change for delivery.

## 5. Carried PR155 input findings

- [x] 5.1 Keep numeric action drafts editable when cleared and block Save until valid; preserve blank force semantics. Bead open-quake-l86.32.
- [x] 5.2 Remove validation blockers when Function replaces or unmounts invalid action inputs; cover mounted Save behavior. Bead open-quake-l86.33.
- [x] 5.3 Validate the changed consumers and ship in a follow-up PR with one addressing round.

PR157 delivery: squash merge `ebc68640398932a49230ce1ec4f98f928af7367a`, exact-head completed Devin review with no findings and all package/download checks passed. Owner app includes the correction. Native management sweep passed all 12 targeted scenarios; five existing speech configuration failures remain tracked separately in `open-quake-l86.31`.
