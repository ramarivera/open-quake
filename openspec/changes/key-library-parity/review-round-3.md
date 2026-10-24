# PR 35 review round three

All six findings are implemented in source `03f4c32c4196db7d60a0868f4a7dfbd4cd252093`, based on parent integration `eddd6f02059c351d53b1e3c1acc6569b809c3b91`, including main `85f1e3bacc49e16f2965f614a5ce2a38f6eb3e06`. Work stayed in managed branch `t3/ebb1871f` at `/Users/ramarivera/.t3/worktrees/open-quake/t3-ebb1871f`. Normal pushes target `HEAD:lane/key-library`. No merge, reviewer request, watcher, nested worker, hook bypass, toolchain change or root checkout edit occurred.

## Changes and consumer evidence

- Explicit Function replacement clears only a true unsupported compatibility marker and resets artwork editing to State 1. Cosmetic title/style/icon edits retain quarantine. Mounted selector, preview, Save and repository assertions preserve imported source and config metadata; recorded KeyRuntime/leaf execution produces only `key:c`, never the obsolete imported website action.
- Application references use macOS Launch Services through `/usr/bin/open` with separate `-b` and bundle-ID arguments. The case-insensitive prefix accepted by the contract is supported. Other platforms return tagged `HostActionFailed` without an OS launch; absolute paths still use `shell.openPath`. Real desktop-port tests record injected OS boundaries, private original causes, scrubbed serialization, sequence success/failure, and zero OS effects in mock mode. Native host keyboard unavailability is unchanged.
- State 2 projects localized alternate title, style and icon into the selected draft's grid only. Missing alternate artwork and blank alternate icons fall back to primary; explicitly user-authored blank titles remain blank. Projection never reaches Save or executable fields. Mounted grid assertions verify both states, neighboring-key isolation, German localization, style/icon edits and persistence. Switching from State 2 to a single-state Function edits and saves primary artwork while retained alternate fields and replacement actions remain intact.
- Individual icon deletion selects and filters only Local App Icons, rejects installed-pack-only IDs, and retains committed/draft reference protection. Real IPC imports the same SVG as both an installed pack and a local icon, removes the local entry, opens a fresh persistent store, and verifies the installed pack remains intact and reimportable.
- Chooser and file preparation run outside the shared edit critical section. Store commits stay serialized and recheck authority/disposal. A deterministic IPC barrier stalls the chooser while the real panel path cancels a running sequence and navigates before chooser release. Releasing the interrupted first leaf cannot run the next leaf. Successful/cancelled imports and late navigation/shutdown completions are covered; disposal still awaits owned work.

The prior Save guard, token/epoch ownership, sequence trailing fields, meeting input/cancel ordering, weather cards and awaited shutdown remain covered by the retained suites and composed native fixtures. No shared contracts or invariants needed modification.

## Verification on the source commit

All six fresh gates passed:

1. `pnpm biome check packages apps`: 661 files.
2. `pnpm exec turbo run typecheck --force --concurrency=1 --env-mode=loose`: 6 tasks, zero cache hits.
3. `pnpm exec turbo run test --force --concurrency=1 --env-mode=loose -- --maxWorkers=2 --no-cache`: 1,536 tests in 158 files. Desktop 855/99, edge 201/19, protocol 60/4, device 420/36; zero cache hits.
4. `pnpm exec turbo run build --force --concurrency=1 --env-mode=loose`: passed, zero cache hits.
5. `pnpm --filter @open-quake/desktop test:bundle`: default HID absence and explicit mock passed, including awaited quit and no hardware I/O.
6. `openspec validate --all --strict`: 39 passed.

The focused desktop adapter/registration suite passes 19 tests in two files. Recorded red runs reproduce unsupported replacement, missing alternate projection, stale alternate editing, bundle launch failure, unsafe icon deletion and chooser-blocked cancellation/late writes. Native failures returning exit zero were classified as failures when required PASS markers were absent.

After the production build, native mocks ran sequentially: key-library, media, voice, weather-media. Every run returned exit zero and every required PASS marker. `OPEN_QUAKE_MOCK_DEVICE=1` was set, `ELECTRON_RUN_AS_NODE` was unset, and each TMPDIR/smoke root was a fresh absolute ExtSSD directory. No live apps, clipboard, physical device, user data, network provider or paid reviewer was used.

Final diagnostics remain unsuppressed: key-library has four preexisting Chromium cache lines plus two missing `weather-media:request` handler lines; media has zero; isolated voice has eight missing `keys:request` and six missing `maintenance:request` lines; weather-media has five missing `keys:request` lines. No final renderer termination or other renderer error was observed. These reflect scoped mock owners rather than production registration.

## Receipts and artifacts

Evidence root: `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/key-library/review-round-3/`.

- `gates.json`, `gate-*/output.log`, `native-proof.json`, `native-*/result.json` preserve exact commands, results, markers and diagnostics.
- `regressions.json` and `red-*/output.log` preserve failing regressions. Earlier fixture errors are retained: an incorrect Electron path, omitted optional field encoded as undefined, title truncation, clicking an icon container rather than its button, missing fixture-option readiness, and an invalid readiness expression. One stalled native attempt was terminated by its owned process group. The final passing fixture preserves every earlier assertion and waits for actual profile selection.
- `capture-manifest.json` records 93 final PNG hashes. `viewed-captures.json` records nine actually viewed captures and observations: four new editor captures, media clock/meeting, completed voice, weather/music clock and playing record. Editor inputs are visible, but the grid is partly above those screenshot viewports; mounted DOM assertions independently check the exact grid output. Do not treat those cropped images as complete visual proof.
- `thread-receipts.json` and per-thread request/response files confirm reply-before-resolve for all six threads, each citing source `03f4c32` and attributing Codex `gpt-6.1-sol`. Reply IDs: `4367932583`, `4367932706`, `4367932811`, `4367932942`, `4367933083`, `4367933218`.
- `cleanup.json` records 32 owned process groups with zero remaining processes, removal of 74 synthetic temporary roots/generated smoke bundles, and revalidation of all 93 capture hashes. Logs, captures and manifests remain.

Only Beads `open-quake-lih.10.2.13` and task 7.3 close in this bookkeeping update. Lead `.11`, epic, physical `.8`, icon fallback `.9` and package acceptance remain open. Parent owns independent verification, final review disposition and merge. No physical-device, real application-launch, host-input or packaged acceptance is claimed.
