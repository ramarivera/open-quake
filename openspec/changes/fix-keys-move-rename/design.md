## Context

Move / swap submits a geometry destination through key-library preview and save. KeyEditing owns layout validation and persistence. Existing pointer movement coverage doesn't establish selector behavior.

## Decisions

- Exercise the real React selector and KeyEditing service, and cover the main IPC handler with mocked Electron.
- The reproduced move failure is a wide-tile swap onto a covered cell. The selector submits that coordinate, while the layout function used only exact anchors and rejected the resulting overlap. Resolve covered destinations in the shared layout function, and read the saved anchor back into the editor. Simple one-cell moves already passed before this fix.
- Preserve move locks against the requested coordinate, even when a full-screen tile covers its own destination. The existing clock lock test protects this case.
- Preserve explicit built-in edit policies. The Windows/macOS Quick Luminance template sets title false; recovered OperationConfiguration.vue lines 1067-1071 deliberately hides title settings under that policy. Explain a locked title instead of overriding this restriction.
- Use synthetic profiles and mocked host effects only. Run desktop typecheck/tests with the SSD TMPDIR and root lint.

## Risks

Draft snapshots can differ from committed keys. Movement must always derive from committed data and retain both configurations when swapping.

## Verification

The selector regression failed before the fix because Save left revision zero. The main IPC regression rejected the same covered-cell preview. The locked Luminance regression failed because the disabled field had no accessible explanation. The final desktop suite passed 3,714 tests with one existing skip; desktop typecheck and root lint passed. Lint reports 20 warnings and three infos. The focused device editing and placement suites passed 21 tests. No app, Electron session or hardware/native test ran. Evidence logs are local scratch artifacts, referenced in the beads.
