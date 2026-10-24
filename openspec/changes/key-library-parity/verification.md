# Key-library verification

Date: 2026-10-24. Branch: lane/key-library. Worktree: /Volumes/ExtSSD/devplane/oq-key-library. Cluster: open-quake-lih.10. Epic: open-quake-lih.10.2.

The initial main update included PR #26 at 19d7240. The delivery also integrates origin/main through bdf8ca8, including monitor-panel PR #30. Dependency commit 055d3da pins @mdi/svg to exactly 7.4.47 and commits the lockfile. No other dependency was added.

## Audit coverage and limits

| Rows | Result and evidence |
| --- | --- |
| MGMT-078, 247, 248, 255, 262, 310, 311 | Live target-bound drafts, explicit Save, revision conflicts/write failures retaining drafts, click-away/navigation revert, deferred icon reset, edit locks; existing clock appearance and hour-format auto-save. key-editing.test.ts and native editor/main/panel smoke. Reset covers known default metadata and matching catalog cells; proprietary resource-table fallback remains unavailable. |
| MGMT-249 | Corrects the vendor bug: Delete in editable fields does not remove the key. editor-input.ts focus guard and native focused-field Delete check. |
| MGMT-099, 100, 120, 258–261, 383 | Eight-language defaults and profile catalog reuse, separate primary/alternate user origins, weighted limit, nonempty auto-style, mid alignment and advanced style/reset controls. key-editing.test.ts, schema round trips and native title controls. Explicit user text wins even when it matches an English default, avoiding the vendor's polluted-default heuristic. |
| MGMT-256 | Two-state title/icon editing and runtime alternate artwork for hotkeySwitch. Proprietary HA state configuration remains with its owning lane. |
| MGMT-415–417, 420–422 | 7,447 MDI assets, name/tag/alias search at 500 ms, zoom 40–120/step 8/default 72, Stream Deck/symbol/TTF iconfont imports, local icons, in-use icon/pack protection. Pack/security/store tests and actual native picker/reference tests. DK artwork and extracted application artwork are not bundled. |
| MGMT-414, 418, 419, 423–426 | Functional equivalents with deliberate differences: embedded target-bound picker; bounded 120-item lazy pages; inert SVG URLs rather than vendor 170×170 cached PNG; functional loading/empty/error states using the existing UI. The vendor child-window dimensions, viewport-based paging formula, staged progress/fades and exact palette are not claimed. No SVG innerHTML or pack script execution. |
| MAIN-067 | First press executes chord 0, then alternates chord 1/0 with release deduplication. ActionService test, TestClock runtime tests and actual strip tap smoke. Resolves key-function-library question 10. |
| MAIN-075, 081 | Millisecond timer/countdown, second-press cancellation, countdown -1 at expiry, alarm feedback 2, invalid feedback 1, reset feedback 0; profile switches preserve countdown and suppress inactive visual alarms. Scoped reset/disconnect clears state/fibers. TestClock plus native countdown/alarm and native silent WAV decoding/playback. Audible OS behavior is unverified. |
| MAIN-076 | Validated sequential execution, default 100 ms gaps plus delay values, step progress, second-press and failure cancellation. TestClock and native progress screenshot. Supported leaves: hotkey, website, text, application, delay. Nested/proprietary/plugin sequence execution remains unavailable. |
| MAIN-077, 078 | Wrapping previous/next page, clamped goToPage, slides 0/1 for pages and 2/3 for visible profile groups. Reuses merged recognizer and preserves in-tile/knob ownership. Runtime tests, dispatcher tests and native synthetic slide. |

Local-only source evidence: /Users/ramarivera/dev/dark-encyclopedia/dk-suite-introspeccion/v0.4.95/audit/AUDIT_MGMT.md and AUDIT_MAIN.md; recovered_sources/src/views/Components/OperationConfiguration.vue:158–192, 2094–2310, 2418–2552; views/IconSelect/IconSelectContent.vue:415–994; recovered locale-*.json. The source archive is not committed.

## Gates

Run from the lane worktree. Commands and native entry points are in apps/desktop/src/main/key-library/README.md. Full logs and screenshots are local under /Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/key-library/.

- `pnpm biome check packages apps`: pass.
- `pnpm typecheck`: pass.
- `pnpm test -- --maxWorkers=2`: pass, 940 tests in 97 files; worker cap avoids cross-lane CPU contention.
- `pnpm build`: pass.
- `pnpm --filter @open-quake/desktop test:bundle`: pass, default and explicit mock startup, no native discovery or clipboard access.
- `openspec validate --all --strict`: pass, 36 changes.
- Native key-library smoke: pass, editor preview/revert/Save/Delete focus, rapid selection, actual title-style rendering, MDI/search/zoom, safe pack import/reference protection, native TTF and silent WAV, panel alternation/progress/countdown/alarm/wrap/swipe, exact authority, renderer reload draft cleanup, clock hour-format auto-save and responsive screenshots.
- Required native media smoke: pass, synthetic raw touch → parser/tracker → main bus → preload IPC → mounted panel, strip integration, native images and media runtime disposal.

## Screenshots

All paths below are relative to the scratch directory above:

- editor-saved.png, title-style.png, clock-auto-save.png
- mdi-search-zoom.png, icon-library.png, icon-library-narrow.png
- editor-narrow.png
- sequence-progress.png, countdown.png, alarm.png
- panel-quick.png, panel-meetai.png, panel-spans.png, panel-clock.png, panel-vivid.png from the media smoke

## Acceptance boundary

No real QUAKE/touch hardware was opened, no firmware was flashed, and DK-Suite was never launched. Mock smoke does not verify resource delivery to the physical screen, real shortcut/text effects, audible alarms, OS permissions or firmware acknowledgments. The existing profile catalog, grid geometry and knob model are unchanged. Management shell restyling belongs to another lane. No dependency blocker remains.
