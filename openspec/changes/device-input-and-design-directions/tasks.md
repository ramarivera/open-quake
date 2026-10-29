# Tasks

- [x] 1 Explain the ring and fix Y inversion, unwanted click indicator and visible DK claw branding. Bead open-quake-mr7.1.
- [x] 2 Produce three materially different directions using the same three scenes and show an interactive comparison. Bead open-quake-mr7.2.
- [x] 3 Add device-screen automated regressions and safe structured Effect/Pino diagnostics, then management coverage. Bead open-quake-mr7.3.
- [x] 4 Deliver correctness changes after focused checks and one bot addressing round; preserve human redesign selection and physical acceptance limits. PR165 squash merged as `6712d68070df2f9e25ac0663ac1b7bce11e33726`.
- [x] 5 In the next PR, avoid hidden diagnostic expiry work and add a dedicated development diagnostic launch control. Bead open-quake-mr7.4, implemented in the follow-up branch after PR165.

- [x] 6 Implement Instrument Console device presentation and Studio mirror/table/inspector with Scene Rail selector and knob overlay. Preserve real profile/actions, localization and input geometry. Bead open-quake-mr7.5.
- [x] 7 Verify selected hybrid with device-first interaction regressions, management selection/save coverage and actual rendered screens; deliver through one review addressing round. Bead open-quake-mr7.5.

- [x] 8 In the next PR, share Scene Rail page-control constants and remove the unused close rectangle. Current hit rectangles match rendered controls. Bead open-quake-mr7.6.

- [x] 9 Keep artwork clear of explicitly styled top titles in device and editor previews. Bead open-quake-mr7.7.

- [x] 10 Deliver title/artwork and shared Scene Rail geometry follow-up through focused checks and one addressing round. Beads open-quake-mr7.6 and open-quake-mr7.7.

## Implementation evidence

The rotating dial counts raw detents at 15 degrees per tick and expires after four seconds. It doesn't represent a control value. The ordinary panel now omits that dial and raw touch markers; development diagnostics require explicit URL opt-in and use the same coordinate normalization as tile routing. Offline status and actual control/selector feedback remain.

Mounted pointer/vendor tests distinguish the top and bottom rows at supported viewport rotations 0/90 and half scale. Diagnostic marks cover all four vendor rotations. Persisted `DKClaw` displays as Agent in the catalog and mounted management settings without rewriting saved names or IDs.

Focused panel, mounted touch, catalog, locale, manager, key editor, touch controller, selector and strip interaction suites pass. Both owning typechecks pass. The hidden production Electron guided self-test passed with live-input assertions and an inspected frame without diagnostic markers. Synthetic input doesn't establish physical touch accuracy.

Diagnostics reuse the Effect/Pino pipeline with bounded tile/action/outcome fields and existing touch health counters and named runtime spans. The persistence test rejects private serial/text and invalid identities.

## Proposal milestone

All three independent Opus 5.5 CLIProxyAPI directions are available in the scratch artifact `open-quake/device-input-and-design-directions/comparison.html`. The comparison switches all directions together between home, knob/profile and management editor; individual direction and 1:1 zoom controls are available. Parent previews inspected all three actual HTML artifacts, then checked every shared scene switch and direction filtering in a hidden browser. Proposals remain mockups; selection was completed on 2026-10-29.

Mobile delivery correction: nested frames rendered blank on Ramiro's phone. `comparison.html` now embeds all nine screen images without frames or scripts; the interactive desktop version is retained as `comparison-interactive-desktop.html`. Three scene comparisons were previewed at phone width in light mode, and full-size A/B/C PNG sheets were delivered for zooming. Ramiro selected B home/editor and C selector/knob.

## Single review round

PR165's original head was reviewed by Codex, Devin and CodeRabbit. Copilot reported an internal review error. Accepted findings move admitted/suppressed input logging into KeyRuntime's actual contact decision and assert both down/up callbacks for pointer and vendor paths. The two informational development/performance suggestions are tracked in open-quake-mr7.4 for the next PR. No rereview requested; later findings carry forward.

## Follow-up implementation

Ordinary device feedback now folds link-status events only and schedules no raw-input expiry timers. Opt-in diagnostics keep their normal expiry behavior, and switching them off cancels pending work. The development launch variable `OPEN_QUAKE_INPUT_DIAGNOSTICS=1` adds the diagnostic query flag only to development panels. The renderer still requires the development bridge flag. Mounted regressions cover default rendering, offline status, diagnostic expiry and disabling; query tests cover explicit opt-in and production/management exclusion.

## Selected hybrid milestone

Ramiro chose Instrument Console for device home and Studio, with Scene Rail for profile selection and knob feedback. Production components now implement that combination. Create console profile adds and selects a seven-tile preset through existing import/select contracts; saved profiles are preserved. Real Agent routes occupy the action bank, rather than promising unimplemented Focus/Meeting behavior. Explicit Console clock and Agent input keys honor their stored sizes to support the two-by-two clock and four-by-one command bank. Unmarked saved keys retain their legacy forced spans, including the bundled clock saved as one cell. Volume shows only revision-matching observed runtime readings.

Studio retains the existing inspector and save machinery, adds the key table, and uses one selected-footprint outline. The picker and passive knob overlay share three unique neighbour cards, active/selected labels, localized controls and explicit timeout copy. The physical hit test uses the same rectangles; a timer-only snapshot cannot cancel a held contact. Focused device, profile and mounted management checks pass. Native hidden renderer captures inspected home, picker, knob and Studio using sample data; these captures are not hardware acceptance or real provider validation. Production build and both owning typechecks pass. PR review/delivery remains task 7.

## Hybrid review fixes

The single addressing round activates the preset through the profile manager and preserves the previous selection on rejected delivery. Volume keys retain hidden and styled headings, and smaller saved keys keep their icon/title layout instead of the two-by-two readout. Compact clocks use explicit tile geometry; scaled full-strip previews retain their full composition. A retained Console compatibility marker selects saved sizing without changing the storage schema, while unmarked clock/input keys keep legacy spans and editing rules. Studio table rows reflect unsaved names. The three-card rail labels jump controls with the actual destination profile instead of a misleading page count.

Profile regressions, mounted editor interactions, selector navigation, clock previews, volume titles and the original hosted validation failures pass locally. Both owning typechecks, Biome and the production build pass. PR167 fix head `61014082` passed hosted validation and the complete download matrix, then squash merged as `8efcf903703678fa6edbd5ebc9626aa8ea8c4256`. The watch stopped after merge. The later P2 title/artwork overlap belongs to the next PR under the one-round cap, tracked in open-quake-mr7.7.

## Carried follow-up milestone

Explicitly styled generic keys again position and size artwork using the title-aware metrics. The default Console icon/title arrangement remains unchanged. The regression failed on the merged PR167 source and passes after the fix for wrapping top/bottom titles at device scale and half-scale preview. Scene Rail page buttons now render from the same rectangles used for physical hit tests, and the model and renderer share the 15-profile page size. Mounted tests exercise first, middle and last pages. The unused close rectangle is removed because blank-area touches already dismiss the picker.

Focused follow-up verification passes 73 renderer tests and 27 knob-model tests, both owning typechecks, Biome and production build. A hidden render with loaded sample artwork confirms separation at device scale and half scale. This remains software evidence; no physical input or live-provider acceptance is claimed.

## Follow-up single review round

The PR168 initial Codex and Devin findings reproduced centered text/artwork overlap and hidden titles changing artwork layout. Only visible explicit headings now request title-aware artwork placement. Centered headings reserve an icon area above their two-line text block. Full-screen regressions cover size-8 and size-12 titles at top/middle/bottom at device and half scale, plus hidden-heading stability. Both defects failed before the fix. All 35 owning renderer tests, desktop typecheck, Biome and production build pass, and an updated hidden render was inspected with all sample artwork loaded. No rereview is requested; later findings carry into the next PR.

## Delivery complete

PR168 fix head `5589518cc4a691507996b72c24f739c9da82df49` passed hosted validation and the complete download matrix. Codex reviewed that head with no findings; no unresolved review threads remained. PR168 squash merged as `d08a143f8ca95df18ae9e837205f035109653921`, and its owned watch stopped. The initial two findings were addressed in exactly one fixing round without requesting another review or buying review capacity. Physical touch, visible illumination and live-provider acceptance remain outside this software completion record.
