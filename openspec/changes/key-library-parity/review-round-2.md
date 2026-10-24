# PR 35 review round 2

Implemented by Codex (gpt-6.1-sol, xhigh), without nested workers, in `/Volumes/ExtSSD/devplane/oq-key-library` on `lane/key-library`. Root checkout was not edited. Parent retains independent final verification, review and merge.

Start head: `aa4daf3eddb6d833aa259c3c77e1656c864cee10`. Normal merge `d69c55f2081dacdf978372c76a96170647ba4ced` includes main `25d99d7261e63ef7ab667bab234949fb4e70b04e`, including PR 31 meetings. Ancestry was checked directly. Its single conflict was additive imports in StripPanel; both key dispatch and meeting routing were retained. Meeting touchCancel handling, successful-release gating and awaited owner disposal remain present. No rebase or force push was used.

Primary fixes: `981d10f1c6f84ae5ee0e265aef4e25940bd49505`. Final source: `18ed5fdd5ab6ea8dead096f3ba0d07273bb2e5e6`, which adds explicit native fixture readiness without changing production behavior. All final gates ran on that source. The final tracking head is recorded in the external handoff; its changes are limited to this report and task completion.

Both confirmed findings were fixed and received attributed replies citing the full final source SHA before resolution:

- `PRRT_kwDOUADXpM6v56wB`: Sequence Value changes preserve trailing actions and retained action/step/config fields. Gap changes patch only the gap. Three sequence tests cover retained fields and numeric delay values. The mounted native editor changes Value, previews, saves through IPC/persistence, and executes the saved sequence through KeyRuntime and executeActionLeaf with recording adapters. It asserts exactly `text:After`, then `key:enter`. [Reply and resolution](https://github.com/ramarivera/open-quake/pull/35#discussion_r4367855188).
- `PRRT_kwDOUADXpM6v56wD`: Save synchronously guards its complete transaction and disables all editor controls until the reply. Mutation callbacks also reject changes while pending. Selection identity and mounted generation checks suppress stale responses and follow-on saves; token-bound revert clears a late unmounted preview. Deterministic native IPC barriers exercise same-key edit attempts, double Save, key selection, Cancel/Delete/click-away, revision advancement and a subsequent edit, conflict rejection with the draft retained, unmount before Save, and a delayed committed response after switching editor/key. [Reply and resolution](https://github.com/ramarivera/open-quake/pull/35#discussion_r4367855357).

The thirteen earlier fixes and their assertions remain intact. Host keyboard mode remains explicitly unavailable. No native host input is claimed.

All six final source gates passed:

- `pnpm biome check packages apps`: 628 files.
- `pnpm exec turbo run typecheck --force --concurrency=1 --env-mode=loose`: passed, zero cache hits.
- `pnpm exec turbo run test --force --concurrency=1 --env-mode=loose -- --maxWorkers=2 --no-cache`: 1,383 tests in 151 files. Protocol 60/4, device 420/36, edge 201/19, desktop 702/92.
- `pnpm exec turbo run build --force --concurrency=1 --env-mode=loose`: passed, zero cache hits.
- `pnpm --filter @open-quake/desktop test:bundle`: both hermetic default-HID and explicit-mock modes passed, including awaited shutdown.
- `openspec validate --all --strict`: 38 items passed.

Sequential native key-library, media and voice mocks passed with explicit PASS markers and exit zero. Every process group was checked after exit and had no remaining processes. Runs used `OPEN_QUAKE_MOCK_DEVICE=1`, unset `ELECTRON_RUN_AS_NODE`, and owned ExtSSD TMPDIR and smoke scratch roots. The key fixture now registers the merged meeting owner too. The final readiness edit was committed unchanged while that native sequence was running; the subsequent six gates verified the exact committed source.

The final native run produced 68 hashed captures. Nine were actually viewed: both pending-save states, saved sequence Value, switched-editor draft, retained conflict draft, wallpaper clock preview, baseline strip clock, meeting layout and completed mock voice answer. The conflict notice is below that capture's viewport; a mounted assertion verifies its exact code. The visible sequence row shows Value `After`; the execution record proves Enter separately. `viewed-captures.json` records exact paths, hashes and observations.

Failures and retries are retained. Initial helper-edit invocations failed before shell execution. An escaped CSS fixture edit was corrected before source gates. Fixture assertions were corrected to find keys by code because saves reorder them, compare JSON data despite Schema null prototypes, and use a title within the existing 20-weight limit. A nonempty-array type error was corrected with EffectArray.map, without a cast. The first final native attempt passed the new mounted checks but failed the existing rapid-selection assertion because the preceding retained-draft fixture made a generic editor-presence wait insufficient. The follow-up source commit waits for the actual profile transition and expected first key; the original timer assertion remains unchanged. The initial six-gate pass on 981d10f is retained separately; all six were repeated successfully on 18ed5fd.

Some deliberately failing native attempts returned Electron exit zero. They are recorded as failures because their required PASS markers are absent. Final acceptance checks both exit and PASS markers. The successful composed key fixture retains four Chromium Shared Dictionary/disk-cache diagnostic lines, zero missing-handler messages and zero renderer errors. Media has zero missing-handler messages. The isolated voice fixture has eight missing key-handler and six missing maintenance-handler messages because it registers fewer owners than main; its feature assertions pass. These diagnostics were not suppressed.

Evidence root: `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/key-library/review-round-2/`.

- `gate-summary.json`, `gate-results.json`, `gate-*.log`, `run-gates.py`: exact final commands, counts and outcomes. `gates-source-981d10f/` retains the first gate run.
- `regression-red-save/`, `regression-red-sequence-2/`: independent mounted reproductions. Other regression directories retain fixture failures and intermediate successful runs.
- `native-attempt-1/`: retained selection-setup failure. `native-attempt-2/`: successful sequential native runs, environment, process receipts and capture hashes.
- `native-attempt-2/key-library/editor-regressions.json`: actual IPC requests, saved profile and recorded text/Enter effects.
- `viewed-captures.json`, `native-log-summary.json`: visual inspection scope and diagnostic counts.
- `main-merge*.log`, `main-included.json`, `source-commit.log`, `source-followup-commit.log`, `source-push.log`: normal hooks, merge and source delivery.
- `thread-dispositions.json`, `thread-receipts.json`, per-thread API requests/responses: exact attributed replies and confirmed resolutions.
- External `handoff.md`, final GitHub snapshot and cleanup receipts record final delivery state.

Only Bead `open-quake-lih.10.2.12` and OpenSpec task 7.2 are completed by this round. Parent `.11` remains in progress; physical `.8`, icon fallback `.9`, the epic and package acceptance remain open. No real-device, real host-input, firmware or packaged acceptance is claimed. No paid review, watcher or merge was requested. Parent owns final-head review and merge.
