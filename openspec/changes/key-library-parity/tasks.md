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
- [ ] 6.2 Reconcile the remaining icon presentation and resource fallback differences with the Management Center/artwork lanes: picker window shape, exact paging/progress/palette, proprietary resource-table resets and extracted app artwork. See verification.md for the precise partial rows; do not copy unsafe SVG execution or bundle proprietary packs.

## 7. Review integration

- [x] 7.1 Address all thirteen PR #35 review threads after merging current main: disconnect/runtime cleanup, host keyboard fallback, navigation validation, portable font smoke, retained sequence fields, owned-panel authorization, SVG validation, serialized tap pairs, selection feedback, inert unsupported imports, overlay gesture cancellation, editor-only sequence IDs, and wallpaper-aware clock preview. Prove with regressions, six fresh gates and isolated native mock smokes; record evidence and close only open-quake-lih.10.2.10. Evidence: review-round-1.md; source b7c8ee7c03fefd9e7f2c9675e1c3fb68c8a5d8aa.

- [x] 7.2 Fix PR #35 round-two sequence Value data loss and pending-Save draft races. Preserve untouched action fields and optional Enter, guard the complete save transaction and stale responses, add real input/save/execution and delayed-IPC mounted regressions, run six fresh gates and sequential native key-library/media/voice mocks, reply with attributed source SHA before resolving both threads, and close only open-quake-lih.10.2.12. Parent .11, physical .8, icon fallback .9 and package acceptance stay open. Evidence: review-round-2.md; final source 18ed5fdd5ab6ea8dead096f3ba0d07273bb2e5e6.

- [x] 7.3 Fix PR #35 round-three unsupported Function replacement, application bundle references, State 2 editor artwork and single-state replacement, local icon collection ownership, and chooser-independent runtime cancellation. Verify mounted selector/preview/Save/persistence/KeyRuntime consumers, recorded desktop OS boundaries including sequences and mock isolation, and selected-draft-only alternate preview. Preserve prior fixes, run six fresh gates and four sequential native mocks, reply with attributed fix SHA before resolving the six threads, and close only open-quake-lih.10.2.13. Lead .11, epic, physical .8, icon fallback .9 and package acceptance remain open. Evidence: review-round-3.md; source 03f4c32c4196db7d60a0868f4a7dfbd4cd252093.

- [x] 7.4 Fix PR #35 round-four profile preview/thumbnail locale ownership and inert key-selection tiles. Prove mounted manager and real thumbnail render/cache consumers with conflicting Keys locale and later changes; exercise controllable media transport, keyboard and native editor events with zero host commands while live strip controls remain interactive. Preserve prior fixes, run six fresh gates and four sequential native mocks, reply with attributed source SHA before resolving both threads, and close only open-quake-lih.10.2.14. Lead .11, epic, physical .8, icon fallback .9 and package acceptance remain open. Evidence: review-round-4.md; source 7a4cbffa5c10b4f3a5285a49eab9184833e1cc94.

- [x] 7.5 Integrate the verified management shell into PR35, preserving key editor navigation, management profile validation, both touch paths, editor preview updates and shared service disposal. Run six fresh gates and sequential native consumers before delivery. Evidence: `verification-management-integration.md`; tested source `0f293dd`. Bead `open-quake-lih.10.2.15`.

- [x] 7.6 Fix PR35 final-head review findings on live alternate artwork after function replacement, persisted Keys locale across remounts, custom emoji icon URLs, and final sequence-step completion. Verify actual renderer/runtime consumers, run fresh gates and native fixtures, then reply before resolving all four threads. Bead `open-quake-lih.10.2.16`. Evidence: `review-round-5.md`; source `081b9cbc7e494e49e1888468826c6e6e72e5818d`.

- [ ] 7.7 Integrate PR34 lazy emoji assets and shell review fixes, and clear held emoji taps on overlay/gesture cancellation. Prove cancellation reaches neither clipboard nor keyboard while ordinary taps still work, retain current editor/runtime behavior, run six fresh gates and affected sequential native mocks, and reply before resolving PR35 review feedback. Bead `open-quake-lih.10.2.17`.
