# Tasks

## 1. Approved assets

- [x] 1.1 Add exact @mdi/svg 7.4.47 to desktop and commit the lockfile; verify installed metadata and manifest pin.

## 2. Editing and titles

- [x] 2.1 Implement revision-checked live drafts, Save/revert/reset and focused-field Delete protection; verify invariant, IPC and editor tests and document clock auto-save.
- [x] 2.2 Add title-origin metadata and eight-language resolution using the catalog; verify weighted length and custom/empty/default-title round trips.

## 3. Icon library

- [x] 3.1 Implement safe bounded Stream Deck and iconfont symbol ZIP imports, local storage, in-use deletion checks, MDI search/zoom/paging and target-bound selection; verify import/security/reference tests and native picker smoke. Verify native TTF rendering without another dependency.

## 4. Key actions

- [x] 4.1 Implement hotkeySwitch and cancellable timer/countdown/alarm and multi-action progress with consumer tests and Effect TestClock; reconcile key-function-library question 10.
- [x] 4.2 Wire wrapping navigation and merged strip slide gestures; verify page boundaries, gesture ownership and actual panel dispatch.

## 5. Integration

- [x] 5.1 Run required lint, types, tests, build, bundle, OpenSpec and native mock smoke gates; save screenshots and report evidence in the lane report and PR.

## 6. Deferred acceptance and exact vendor presentation

- [ ] 6.1 Lead-only physical acceptance: verify real shortcut/text effects, audible alarms, resource delivery and reconnect on the single QUAKE owner. This lane is restricted to mocks.
- [ ] 6.2 Reconcile the remaining icon presentation and resource fallback differences with the Management Center/artwork lanes: picker window shape, exact paging/progress/palette, proprietary resource-table resets and extracted app artwork. See verification.md and verification-icon-presentation.md. Source 12d42ab now covers the owned picker, viewport batches, progress/palette, local application extraction, portable PNGs and semantic fallback, with six fresh gates and complete native fixtures. Exact proprietary resource artwork remains unclaimed; do not copy unsafe SVG execution or bundle proprietary packs.

## 7. Review integration

- [x] 7.1 Address all thirteen PR #35 review threads after merging current main: disconnect/runtime cleanup, host keyboard fallback, navigation validation, portable font smoke, retained sequence fields, owned-panel authorization, SVG validation, serialized tap pairs, selection feedback, inert unsupported imports, overlay gesture cancellation, editor-only sequence IDs, and wallpaper-aware clock preview. Prove with regressions, six fresh gates and isolated native mock smokes; record evidence and close only open-quake-lih.10.2.10. Evidence: review-round-1.md; source b7c8ee7c03fefd9e7f2c9675e1c3fb68c8a5d8aa.

- [x] 7.2 Fix PR #35 round-two sequence Value data loss and pending-Save draft races. Preserve untouched action fields and optional Enter, guard the complete save transaction and stale responses, add real input/save/execution and delayed-IPC mounted regressions, run six fresh gates and sequential native key-library/media/voice mocks, reply with attributed source SHA before resolving both threads, and close only open-quake-lih.10.2.12. Parent .11, physical .8, icon fallback .9 and package acceptance stay open. Evidence: review-round-2.md; final source 18ed5fdd5ab6ea8dead096f3ba0d07273bb2e5e6.

- [x] 7.3 Fix PR #35 round-three unsupported Function replacement, application bundle references, State 2 editor artwork and single-state replacement, local icon collection ownership, and chooser-independent runtime cancellation. Verify mounted selector/preview/Save/persistence/KeyRuntime consumers, recorded desktop OS boundaries including sequences and mock isolation, and selected-draft-only alternate preview. Preserve prior fixes, run six fresh gates and four sequential native mocks, reply with attributed fix SHA before resolving the six threads, and close only open-quake-lih.10.2.13. Lead .11, epic, physical .8, icon fallback .9 and package acceptance remain open. Evidence: review-round-3.md; source 03f4c32c4196db7d60a0868f4a7dfbd4cd252093.

- [x] 7.4 Fix PR #35 round-four profile preview/thumbnail locale ownership and inert key-selection tiles. Prove mounted manager and real thumbnail render/cache consumers with conflicting Keys locale and later changes; exercise controllable media transport, keyboard and native editor events with zero host commands while live strip controls remain interactive. Preserve prior fixes, run six fresh gates and four sequential native mocks, reply with attributed source SHA before resolving both threads, and close only open-quake-lih.10.2.14. Lead .11, epic, physical .8, icon fallback .9 and package acceptance remain open. Evidence: review-round-4.md; source 7a4cbffa5c10b4f3a5285a49eab9184833e1cc94.

- [x] 7.5 Integrate the verified management shell into PR35, preserving key editor navigation, management profile validation, both touch paths, editor preview updates and shared service disposal. Run six fresh gates and sequential native consumers before delivery. Evidence: `verification-management-integration.md`; tested source `0f293dd`. Bead `open-quake-lih.10.2.15`.

- [x] 7.6 Fix PR35 final-head review findings on live alternate artwork after function replacement, persisted Keys locale across remounts, custom emoji icon URLs, and final sequence-step completion. Verify actual renderer/runtime consumers, run fresh gates and native fixtures, then reply before resolving all four threads. Bead `open-quake-lih.10.2.16`. Evidence: `review-round-5.md`; source `081b9cbc7e494e49e1888468826c6e6e72e5818d`.

- [x] 7.7 Integrate PR34 lazy emoji assets and shell review fixes, and clear held emoji taps on overlay/gesture cancellation. Prove cancellation reaches neither clipboard nor keyboard while ordinary taps still work, retain current editor/runtime behavior, run six fresh gates and affected sequential native mocks, and reply before resolving PR35 review feedback. Bead `open-quake-lih.10.2.17`. Evidence: `review-round-6.md`; source `96dcac4074ddd325e8b67b6c1fdd8aa8c2136942`.

- [x] 7.8 Block quarantined emoji keys at registered press dispatch and include validated icon packs/local icons in native backup export and lossless restore. Verify real press and restored store consumers, populated/repeated restore and malformed input rejection, six fresh gates and sequential native mocks. Reply before resolving both PR35 findings. Bead `open-quake-lih.10.2.18`. Evidence: `review-round-7.md`; source `b9d21e0f02bae466d574c51d5d3dd64d96293bb8`.

- [x] 7.9 Accept importer-produced repeated artwork IDs in icon backups, preserve differently named aliases and normalize collisions deterministically during clean/populated/repeated restore, including existing libraries. Verify actual parser/store/backup consumers and native proof; run fresh gates and reply before resolving PR35 finding. Bead `open-quake-lih.10.2.19`. Evidence: `review-round-8.md`; source `b62e18a79f6dee0cd8661e1e6ef6ecac2d4d36ab`.

## 8. Lead acceptance

- [x] 8.1 Run quiet live-device acceptance on this Mac using one QUAKE owner and isolated test data. Trusted shortcut/text/Enter/alternate/sequence receipt, actual display framebuffer, portable artwork, and prior settled software reconnect pass. Clipboard and original hardware preferences restored; no audible action or message sent. Home Assistant deferred. Full physical 6.1 and native GIF animation/Windows acceptance remain open. Bead `open-quake-lih.10.2.20`. Evidence: `verification-quiet-keyboard-display.md` and `verification-quiet-startup.md`.

- [x] 8.2 Repair real-device profile enrollment and unambiguous DK-QUAKE display startup found by quiet acceptance. Own profile connection lifetime with the native HID scope, preserve ambiguity handling, release display-discovery reservations even when a resume/disconnect race cancels the fiber before it starts, add red/green consumer tests and repeat quiet live proof. Bead `open-quake-lih.10.2.21`; related device-lifecycle requirement updated together. Evidence: `verification-quiet-startup.md`; source `451f108`.

- [x] 8.3 Enroll profiles independently of optional hardware preference loading. Preserve scoped disconnect cleanup and typed hardware failure reporting. Verify corrupt-preference startup and teardown through the actual main/fake-HID consumer. PR36 review follow-up; bead `open-quake-lih.10.2.22`. Evidence: `verification-quiet-startup.md`; tested source `d6aa21e`.

- [x] 8.4 Address PR37 review findings: keep installed application scans outside the live key request lock, preserve intentionally blank artwork, and restrict icon mutations to the owned picker. Verify registered IPC concurrency/authority and rendered blank/resource behavior, six fresh gates and sequential native consumers. Bead `open-quake-lih.10.2.23`. Evidence: verification-icon-review-round-1.md; tested source `1fdd5ec`; 1,780 tests, four sequential native fixtures and quiet live icon delivery pass.

- [x] 8.5 Fix PR37 reset source identity per artwork state, fill underflowing picker viewports on resize/load/zoom/search/group changes, and normalize accepted raster imports before storage. Prove reset → Save → deletion protection and native high-detail import → selection → Save; run fresh gates and sequential native consumers. Bead `open-quake-lih.10.2.24`. Evidence: verification-icon-review-round-2.md; tested source `90fb862`; six gates, 1,781 tests, four sequential native fixtures and quiet live reset/source proof pass.

- [x] 8.6 Replace native picker closure timing assumptions with bounded destruction checks after selection and function replacement. Verify the full Keys fixture and focused lint/types; production behavior remains the verified round-two source. Bead `open-quake-lih.10.2.25`. Evidence: verification-icon-review-round-2.md and closure-followup/verification.json; complete native Keys, types, lint and strict change validation pass.

- [x] 8.7 Fix the native CoreGraphics helper crash found during unlocked quiet acceptance. Use supported JXA argument types, verify the actual read-only macOS helper and consented arrangement, retain typed failure handling, and record fresh device output plus cleanup. Bead `open-quake-lih.10.2.20.1`. Evidence: `verification-quiet-keyboard-display.md`; two actual macOS binding regressions and real consented arrangement pass.

- [x] 8.8 Perform one comment-curator round on PR38; run newly authorized automated live sound and Home Assistant checks, extend native GIF animation/filename acceptance where available, and preserve exact evidence and user state. Physical controls and cable actions remain user-owned for later. Bead `open-quake-lih.10.2.26`. Evidence: `verification-sound-gif-ha.md`; source `f77d91d2a2ab6b399543d5d3ba3be70c6c3db150`. Broader physical and messaging/Windows acceptance remains open.

- [x] 8.9 Replace the bulky management sidebar scrollbar with a narrow theme-matched thumb; verify live compact/full sidebar scrolling and inspect current Linux adapters. Bead `open-quake-lih.10.2.27`. Evidence: `verification-sound-gif-ha.md`; source `f77d91d2a2ab6b399543d5d3ba3be70c6c3db150`. Broader physical and messaging/Windows acceptance remains open.

- [x] 8.10 Wire saved Home Assistant keys into the guarded production activation path. Cover direct execution, duplicate/stale/hidden/quarantined rejection and typed host failure, and verify live HTTPS off/on/off against a temporary helper. Bead `open-quake-lih.10.2.28`. Evidence: `verification-sound-gif-ha.md`; source `f77d91d2a2ab6b399543d5d3ba3be70c6c3db150`. Broader physical and messaging/Windows acceptance remains open.

- [x] 8.11 Release the shared key input lock before awaiting Home Assistant network work; retain atomic activation guards and held-key deduplication, interrupt scoped owned work on reset, and prove blocked requests do not delay unrelated keys, navigation or cleanup. Address PR38 final-head review with attributed reply and fresh checks. Bead `open-quake-lih.10.2.29`. Evidence: `verification-sound-gif-ha.md`, PR38 review follow-up; 424 device and 67 focused desktop tests, both types, build, bundles, lint and strict change validation pass.

- [x] 8.12 Keep unrelated strip taps responsive through the production panel dispatcher while Home Assistant is pending, and propagate reset/disconnect cancellation across the desktop Promise callback into the integration runtime. Prove both consumer paths and preserve same-key ordering and authorization. Bead `open-quake-lih.10.2.30`. Evidence: `verification-sound-gif-ha.md`, production-boundary follow-up; 92 focused desktop tests, desktop typecheck, build, both bundle modes, lint and strict change validation pass. Published-head review and checks remain goal-owned until reconciled.


## Device widget coverage lane

- [x] test-device-widgets: MGMT-255/340 brightness/plugin/template reset precedence, real editor platform selection and blank Clock reset.

- [x] Mounted editor and title-recovery burn-down regressions for MGMT-049/083/096/097/100/249. Beads open-quake-lih.9.2 and open-quake-lih.9.3 remain open for lead integration.

## Grid-editor burn-down lane

- [x] Implement grid-editor placement, movement, selection, navigation, sizing, hints and scheduling with mounted consumer tests. Beads open-quake-lih.10.7/.8/.9.
