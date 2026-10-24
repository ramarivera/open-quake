# PR35 final-head review fixes

Source `081b9cbc7e494e49e1888468826c6e6e72e5818d` addresses all four Codex findings on `c9205003c73cdb12117c18f9101d2ef0055b6cc1`. It includes main `c60378fafcd041245a8c54ae329c87003f4fdcab`. Implemented by Codex, gpt-6.1-sol, in the existing `lane/key-library` checkout. No worker was dispatched.

## Fixes and consumer proof

- Live alternate artwork applies only to a current hotkeySwitch. The native regression activates State 2, changes the Function to a hotkey, saves while retaining alternate fields, and asserts the replacement's primary title and icon before and after another panel activation.
- Keys initializes its language from the validated stored preference shared with the live strip. Native coverage selects German, leaves and remounts Keys, reloads management while the panel remains mounted, and checks translated output. Invalid stored language returns to English.
- Emoji tiles resolve `emoji:` assets and preserve ordinary image URLs. Native coverage selects and saves a real MDI icon, checks that emoji action references remain unchanged, renders MDI and local PNG artwork in the editor and live strip, and generates a thumbnail containing both custom icons and an intentionally empty icon. Empty icons no longer block thumbnail readiness. Existing management proof still renders hash-backed emoji assets and thumbnails.
- Sequence gaps apply only between operations. Three Effect v3 TestClock regressions cover default and 60-second final gaps and an explicit final delay. A new tap begins a new execution immediately after completion. The three tests fail against the previous runtime and pass with the fix.

## Verification

All six fresh gates passed on the source commit:

1. Biome checked 798 files.
2. Forced workspace typecheck passed, six tasks with zero cache hits.
3. Forced tests passed: 1,741 tests across 186 files. Desktop 1,025/123, device 423/36, edge 233/23 and protocol 60/4. Zero cache hits.
4. Forced production build passed.
5. Bundle smoke passed both default HID absence and explicit mock cases.
6. Strict OpenSpec validation passed all 40 items.

Three native fixtures ran sequentially with fresh synthetic data and mandatory mock mode. Each exited zero and contained every required final PASS marker: the complete Keys fixture, the preview locale/inert-control fixture, and the management fixture. Existing editor Save races, sequence text/Enter execution, alternate editing, safe imports, audio, runtime progress/cancellation, locale-specific thumbnail caching and management emoji behavior remain covered. The management fixture produced its full 65-capture PASS marker.

Evidence root: `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/key-library/review-round-5/`. `verification.json` records all commands and exits. `captures-sha256.json` contains 96 final PNG hashes, rechecked after cleanup. Five final captures were opened, recorded in `viewed-captures.json`: live replacement, restored German editor, custom emoji strip, German profile thumbnail and hash-backed emoji thumbnail.

## Review dispositions and cleanup

The four threads received source-SHA replies with Codex attribution before resolution. `thread-receipts.json` records replies and resolution receipts. The bounded post-reply GitHub snapshot reports 27 resolved threads, zero unresolved, and no next page. The two review summary comments introduced no additional code findings. Final published-head review remains pending; check success and CodeRabbit's review-limit notice are not substitutes for a fresh review.

`cleanup.json` records zero processes in every recorded owned process group, removal of the task's temporary root and three generated fixture bundles, and retained evidence. Fixture-owned synthetic user data was removed by awaited disposal. The root checkout was not edited.

Diagnostics remain in `native-log-audit.json` and raw logs. Keys recorded four Chromium cache errors, one macOS task-suppression diagnostic, and missing-handler invocations for management theme, agents and weather/media in its isolated harness. Six theme promise errors were logged by its renderer. Preview recorded four cache errors and missing management-theme/agent handlers. Management had none of these errors. All required consumer assertions and final markers passed. Early focused runs failed because the assertion assumed saved-key array order; the corrected fixture finds keys by code. Runs missing the final marker were rejected even when Electron exited zero.

Only Beads `open-quake-lih.10.2.16` and OpenSpec task 7.6 close. Physical, icon/resource fallback and package acceptance remain open. Real keyboard, clipboard, device, audible-output and package acceptance are not claimed.
