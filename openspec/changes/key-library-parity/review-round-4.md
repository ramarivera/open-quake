# PR 35 review round four

Both assigned findings are fixed in source `7a4cbffa5c10b4f3a5285a49eab9184833e1cc94`, based on `3e198c589782af7f86e4d0a455fedcc4dcf28e41` and including unchanged main `85f1e3bacc49e16f2965f614a5ce2a38f6eb3e06`. Work stayed in managed branch `t3/8d9379e1` at `/Users/ramarivera/.t3/worktrees/open-quake/t3-8d9379e1`. Normal pushes target `HEAD:lane/key-library`. Implemented by Codex (gpt-6.1-sol, xhigh), without nested workers. Parent retains independent verification and merge ownership.

## Changes and consumer proof

`StripScreen` accepts an explicit title policy. Profile Manager previews and thumbnails preserve the titles translated by their requested `ProfileDesktop.view`; the Keys editor also preserves its own locale and selected State 2 projection. These consumers do not read or subscribe to the Keys storage locale. Ordinary live strips initialize their locale from storage before their first render and retain storage and same-window locale updates. The previous artificial title-origin flag on alternate display artwork is no longer needed.

The key-selection preview captures selection clicks before nested handlers and opts into the strip's inert interaction policy. Native inert behavior removes nested controls from pointer, focus and keyboard operation; native capture also blocks programmatic input and non-bubbling sub-touch events. The tile context prevents preview player/clock transport and theme writes and renders enabled weather artwork without starting its provider. Existing accessible key buttons and the Save ownership/busy boundary remain intact. Controls outside the editor retain their live behavior.

The new `preview-smoke.ts` uses production renderer, preload, Profile Manager, thumbnail renderer/cache, Keys editor, strip and weather/media controller. All native IO is synthetic or recorded. Its assertions cover:

- German `Aufnahme` and French `Enreg.` in mounted manager previews with conflicting English/Japanese Keys storage, later storage events and manager-language changes.
- Exact titles at the real thumbnail capture readiness boundary, later conflicting locale events, actual PNG capture, locale-specific cache bytes and cache reuse after owner restart without recapture.
- A mounted controllable Music session. A real native mouse click on its transport artwork selects the player key and sends zero adapter commands. Programmatic nested clicks, native keyboard, drag/drop and non-bubbling sub-touch input also send no host actions. Accessible key buttons select the intended key by native keyboard.
- Enabled clock enrichment and meeting controls remain inert, with zero media, weather-provider, voice, meeting, clock or runtime activation requests. Explicit fixture configuration and ordinary reads are accounted separately.
- The live strip renders its stored German locale initially, responds to French/German locale events, and its real transport wiring records `pause` and `next`.

The complete existing key-library native fixture also passes its retained round-three, sequence text/Enter, metadata, alternate artwork, pending-Save and mutation-exclusion assertions. No old assertion was weakened or dropped.

## Verification

All six fresh gates passed on the source implementation:

1. `pnpm biome check packages apps`: 663 files.
2. `pnpm exec turbo run typecheck --force --concurrency=1 --env-mode=loose`: six tasks, zero cache hits.
3. `pnpm exec turbo run test --force --concurrency=1 --env-mode=loose -- --maxWorkers=2 --no-cache`: 1,536 tests in 158 files. Desktop 855/99, device 420/36, edge 201/19 and protocol 60/4; zero cache hits.
4. `pnpm exec turbo run build --force --concurrency=1 --env-mode=loose`: production build passed, zero cache hits.
5. `pnpm --filter @open-quake/desktop test:bundle`: both default HID absence and explicit mock passed, including awaited quit and no hardware IO.
6. `openspec validate --all --strict`: 39 items passed. The final bookkeeping update is validated separately and is not claimed as another source test run.

After the production build, key-library, media, voice and weather-media native mocks ran sequentially. All exited zero with every required final PASS marker. The focused preview fixture also exited zero with both final markers. Every runner used fresh absolute ExtSSD `TMPDIR` and `OPEN_QUAKE_SMOKE_SCRATCH`, `OPEN_QUAKE_MOCK_DEVICE=1`, and unset `ELECTRON_RUN_AS_NODE`.

The valid baseline probes fail before the fix: manager titles remain English `Record`, the real German thumbnail capture contains `Record` instead of `Aufnahme`, and native transport input records unwanted `pause`. Logs preserve all pilot failures and retries, including an initial fixture syntax error, missing installed Electron binary, incomplete synthetic localization metadata, an incorrect French readiness string, read-only maintenance requests initially misclassified as actions, and a screenshot captured before paint. The final fixture waits for fonts and two paint frames. Early failure fixtures returning zero without PASS markers were treated as failures.

Final diagnostics remain visible and match the scoped baselines: key-library has four Chromium cache diagnostics and two missing weather handlers; media has zero; voice has eight missing Keys and six missing maintenance handlers; weather-media has five missing Keys handlers. The focused preview fixture has four Chromium cache diagnostics. There are no final renderer termination reports.

## Receipts, captures and cleanup

Evidence root: `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/key-library/review-round-4/`.

`gates.json`, `native-proof.json`, per-run `result.json`/`output.log`, `red-valid-*`, `native-preview-final/thumbnail-consumers.json` and `outbound.json` retain the exact commands and observations. `capture-manifest.json` hashes 101 final PNGs. Nine final captures were actually opened: complete Music and clock editor grids, French manager preview, both localized thumbnails, composed meeting strip, AI Copilot strip, weather/music clock and playing record. `viewed-captures.json` records those paths and hashes. Exact DOM and outbound assertions complement the images.

Both replies succeeded before resolution, name the exact source SHA and attribute Codex (gpt-6.1-sol): locale reply https://github.com/ramarivera/open-quake/pull/35#discussion_r4368001613 and inert-preview reply https://github.com/ramarivera/open-quake/pull/35#discussion_r4368001777. `thread-receipts.json` retains the request/response receipts. The bounded source-head snapshot reports 23 resolved threads, zero unresolved and no pagination, preserving all 21 earlier resolutions. No review trigger, paid review, watcher or merge was used.

`cleanup.json` records zero live processes in all 36 owned process groups, removal of 42 owned temporary roots/generated fixture bundles, and revalidation of all 101 capture hashes. Logs, captures and reports remain intentional evidence. No root/prior-lane checkout, real user data, DK-Suite, physical HID/DFU, clipboard, real app launch, network provider, Xcode or security settings were used or changed.

Only Beads `open-quake-lih.10.2.14` and task 7.4 close with this bookkeeping commit. Lead `.11`, epic, physical `.8`, icon fallback `.9` and package acceptance remain open. Physical and packaged acceptance are not claimed. Final source, bookkeeping and pushed refs are recorded in the external `handoff.md`.
