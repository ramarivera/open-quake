## Context

Move / swap submits a geometry destination through key-library preview and save. KeyEditing owns layout validation and persistence. Existing pointer movement coverage doesn't establish selector behavior.

## Decisions

- Exercise the real React selector and KeyEditing service, and cover the main IPC handler with mocked Electron.
- The reproduced move failure is a wide-tile swap onto a covered cell. The selector submits that coordinate, while the layout function used only exact anchors and rejected the resulting overlap. Resolve covered destinations in the shared layout function, and read the saved anchor back into the editor. Simple one-cell moves already passed before this fix.
- Preserve move locks against the requested coordinate, even when a full-screen tile covers its own destination. The existing clock lock test protects this case.
- Honor the owner's updated customization policy: titles, icons and moves remain editable despite legacy template flags. Luminance titles are editable. Only structural resize, replacement and deletion protections remain; preview and Save use the same explanation.
- Use synthetic profiles and mocked host effects only. Run desktop typecheck/tests with the SSD TMPDIR and root lint.

## Risks

Draft snapshots can differ from committed keys. Movement must always derive from committed data and retain both configurations when swapping.

## Verification

In the original move/title fix, the selector regression failed because Save left revision zero. The main IPC regression rejected the same covered-cell preview. The locked Luminance regression failed because the disabled field had no accessible explanation. The final desktop suite passed 3,714 tests with one existing skip; desktop typecheck and root lint passed. Lint reports 20 warnings and three infos. The focused device editing and placement suites passed 21 tests. No app, Electron session or hardware/native test ran. Evidence logs are local scratch artifacts, referenced in the beads.

## Keys editor follow-up sweep

Tracked by open-quake-3nd, open-quake-nf7, open-quake-dbf, open-quake-ayj, open-quake-l86.26, open-quake-l86.29 and the title-layout subset of open-quake-l86.24.

- Resolve a moved key's saved anchor with the shared layout destination rules and read its saved configuration by that anchor. Reject hidden-key moves into another displayed footprint.
- Include the displaced swap target's footprint in structural protection checks. Allow existing Vivid moves from cell buttons while retaining replacement protections.
- Rebase knob drafts over key-only revisions using a property-order-independent comparison. Page creation can materialize an inherited knob, so refresh a clean knob editor from committed data. Preserve unsaved drafts and reject concurrent knob changes.
- Preserve numeric and boolean generic action types in their form controls. Keep domain validation authoritative.
- Chromium retains rectangles for descendants of closed disclosures. Exclude those controls from enumeration, open the function-library and JSON-import disclosures explicitly, and verify their controls with native window input. Verify the production renderer in the isolated management exerciser with fake HID, hidden windows and scratch userData.
- Reserve two rendered lines at the configured title font size when positioning ordinary tile artwork.

No new dependencies or real device access. The other knob-gauge and accent-arc findings in open-quake-l86.24 remain outside this sweep.

The management exerciser's swap scenario now follows the source at its new coordinate after the preceding move; its persisted source and displaced-key assertions remain intact. Profile/page selector gestures wait for the old key editor to clear before proceeding. Text probes choose a different string when the current value is already the probe text.

## Sweep verification

Desktop typecheck passed; desktop tests passed 3,750 with one existing skip; device tests passed 732; root lint passed with 20 existing warnings and three infos. Strict OpenSpec validation passed. The native management sweep visited all 13 pages: baseline run-McUrB6 had 13 failures and zero renderer errors; final run-qp4mKc had six known profile-duplicate failures, zero Keys failures and zero renderer/uncaught-main errors. All nine targeted native scenarios passed, including Emoji navigation and JSON restoration. The legacy blank force regression failed before the fix and passed after; the broad baseline did not reproduce nf7. No dependencies, real device access, owner app, foreground focus or physical cursor movement.

## Carried action-input findings

PR155 follow-ups use local numeric text state and the existing validity callback. Validity belongs to a mounted input; unmount reports its removal, and selection/function identity remounts fields. Existing domain validation and blank force behavior remain intact.
