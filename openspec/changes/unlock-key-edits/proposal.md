# Unlock key editing

## Why

Saved DK-Suite editing flags disable renaming, artwork and move/swap in built-in Quick profiles. The owner wants every key to support these edits without migrating saved data. Bead: open-quake-l86.27.

## What changes

- Ignore stored title, icon and allowDrag flags for all keys.
- Ignore ordinary resize/delete flags; retain protection for structural MeetAI controls, the full-screen clock and Vivid, existing undeletable navigation/settings types, and fixed widget sizes.
- Refuse replacement or swap displacement of a structurally protected tile, including covered cells.
- Update renderer feedback, lock tests and the profiles README.

## Impact

Shared device editing policy and geometry, desktop Keys editor, and tests. No dependencies, data migrations or hardware access. Verify with desktop typecheck/tests, device tests, lint, and PR #151's hidden management exerciser merged only in scratch.
