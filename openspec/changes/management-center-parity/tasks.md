Epic bead: `open-quake-lih.17.1` (cluster `open-quake-lih.17`; redesign `open-quake-nyd`).

## 1. Planning and tracking

- [x] 1.1 Record the change, its audit row mapping and the epic/task beads under `open-quake-lih.17` and `open-quake-nyd`; `openspec validate --all --strict` passes. Bead `open-quake-lih.17.1.1`.

## 2. Management Center shell

- [x] 2.1 Appearance version 2: Grey, Dark and Light palettes, three font scales, sidebar width, version-1 migration, validation and cross-window sync, with unit tests (CENTER-003, CENTER-004, MGMT-434). Bead `open-quake-lih.17.1.2`.
- [x] 2.2 Shell layout: sidebar sections, product mark, status card, resizer with keyboard support, 980/760 px breakpoints, UI settings popover, page header and content card. Restyle every existing page without changing its behaviour, and run the existing smokes (CENTER-001, 005, 007–012, 017, MGMT-045). Bead `open-quake-lih.17.1.3`.
- [x] 2.3 Deep-link page activation from main and the launch URL, using DK's alias vocabulary (CENTER-013, MGMT-118). Bead `open-quake-lih.17.1.4`.
- [x] 2.4 Title bar follows the theme on macOS, Windows and Linux through a validated IPC channel (CENTER-002, MGMT-012, `open-quake-nyd.1`). Bead `open-quake-lih.17.1.5`.

## 3. Emoji keys

- [x] 3.1 In-repo GIF decoder, encoder and quantiser plus caption burn-in, with round-trip and property tests (CENTER-087, CENTER-018). Bead `open-quake-lih.17.1.6`.
- [x] 3.2 Emoji domain: packages, assets, drafts, app-match settings and the global mode, in an atomic repository with weighted-name and capacity rules (CENTER-081, 084–086, 089). Bead `open-quake-lih.17.1.7`.
- [x] 3.3 Emoji press: action descriptor, panel key sink, foreground gating, clipboard adapters, device-keyboard paste and Enter, and the invalid alert, tested with fakes and TestClock (CENTER-090, MGMT-284). Bead `open-quake-lih.17.1.8`.
- [x] 3.4 Emoji page: three-step studio, results stash, package library, caption editor, app-match dialog, Add to main screen and Export (CENTER-080–088). Bead `open-quake-lih.17.1.9`.

## 4. Agent workbench

- [x] 4.1 Agents domain: catalog, key rules, protected `main`, workspace templates, skills, and atomic moves with distinct failures (CENTER-049–053, 057–060). Bead `open-quake-lih.17.1.10`.
- [x] 4.2 Model routing: role invariants, provider defaults, per-agent inheritance and write-only credentials (CENTER-065–068, 070). Bead `open-quake-lih.17.1.11`.
- [x] 4.3 Runtime controller over `AgentRuntimePort` with 10 s and 5 s bounds and a reachable Error state, plus DK-Claw sync with preflight, revision-checked save, device step and rollback (CENTER-019–022, 024–026, 028, 045, 046, 103). Bead `open-quake-lih.17.1.12`.
- [x] 4.4 Agents IPC and preload with sender checks and consumer tests. Bead `open-quake-lih.17.1.13`.
- [x] 4.5 Agents page: four tabs, runtime indicator and offline panel, roster, wizard, skill management, AI Config tables and DK-Claw slots. Bead `open-quake-lih.17.1.14`.

## 5. Integrations

- [x] 5.1 Channels domain: catalog fixture, setup validation per type, secret references, QR sessions, pairing approval and a fake runtime adapter, with IPC (CENTER-072–079). Bead `open-quake-lih.17.1.15`.
- [x] 5.2 Channels UI: hub, cards, setup drawer, QR panel and pairing step. Bead `open-quake-lih.17.1.16`.
- [x] 5.3 Shortcuts domain: Schema decoding without eval, chord rules, conflict detection, libraries and profile sync, with IPC (CENTER-093–096). Bead `open-quake-lih.17.1.17`.
- [x] 5.4 Shortcuts page: generator, table and library aside. Bead `open-quake-lih.17.1.18`.
- [x] 5.5 Home Assistant domain: origin and token handling, scoped certificate consent, entities, areas, services, allowlist, key display and live state, with IPC (CENTER-098–102). Bead `open-quake-lih.17.1.19`.
- [x] 5.6 Home Assistant page and the strip's live-state tile. Bead `open-quake-lih.17.1.20`.

## 6. Verification and delivery

- [x] 6.1 Native mock smoke screenshots of every page in Dark, Light and Grey, plus the narrow rail and the popover, saved under the lane scratch folder. Bead `open-quake-lih.17.1.21`.
- [x] 6.2 Run the six repository gates, update beads and evidence, and open the PRs. Bead `open-quake-lih.17.1.22`.
- [ ] 6.3 Lead-owned hardware acceptance, explicitly outside this mock-only lane and left open at PR handoff: emoji paste and Enter through the device keyboard, Home Assistant against a real server, and DK-Claw and Home Assistant tiles on the QUAKE. Bead `open-quake-lih.17.1.23`.

## 7. Review fixes

- [x] 7.1 Integrate current main into PR33, address all module review findings with transactional deletion, preserved secrets, DK-Claw cleanup, reserved model scope, correct shortcut selection, disconnected catalog cleanup, transport consent and trusted AI/renderer boundaries. Verify concurrency, rollback and secret-scrub production paths with six fresh gates and native mock evidence. Bead `open-quake-lih.17.1.24`.

- [x] 7.2 Integrate reviewed PR33 into PR34, preserve shared desktop owners and awaitable shutdown, and fix emoji committed-selection authorization, GIF publication, caption/source metadata, export collisions, empty slots and package-link rollback with production IPC/data regressions, six fresh gates and native mock captures. Bead `open-quake-lih.17.1.25`.
- [ ] 7.3 Parent-owned genuine native-application GIF paste acceptance on macOS and Windows, including animation and attachment filename classification. Mock clipboard proof cannot close this task or physical acceptance `.23`. Bead `open-quake-lih.17.1.26`.
- [x] 7.4 Integrate meetings main into the PR33 base using a normal merge, preserve shared main/preload ownership and awaitable shutdown, and refresh all six gates plus synthetic native module proof before merging the updated base into PR34. Bead `open-quake-lih.17.1.27`.

- [x] 7.5 Address fresh PR33 follow-up threads with own-property model scope reads across rendering/resolution/saving and atomic selection repair when shortcut resync removes pages. Add real consumer regressions and refresh six gates and native proof. Bead `open-quake-lih.17.1.28`.

- [x] 7.6 Integrate weather/media main into the base with a normal merge, retain all shared owners and successful-release routing, refresh six gates and native mock proof, then merge the verified base into the top. Bead `open-quake-lih.17.1.29`.

- [x] 7.7 Align default appearance v2 serialization with validated records, preserve restored appearance acknowledgement and validation protections, and prove canonical roundtrip plus final gates. Bead `open-quake-lih.17.1.30`.
- [x] 7.8 Correct final PR33 feedback on trusted direct-key HA execution, preserving unsaved model rows across saves, and serial-scoped DK-Claw delivery/rollback. Add actual consumer regressions and native mock proof, refresh six gates and merge the verified base normally into PR34. Bead `open-quake-lih.17.1.31`.

- [x] 7.9 Confirm and fix late PR33 findings on missing HA entity polling, optional service selects, unsynced DK-Claw slot drafts and visible shortcut capacity. Add production-path regressions and native mock proof, refresh six gates on the base, then normally integrate and verify the top without changing shared ownership or awaited shutdown. Bead `open-quake-lih.17.1.32`.

- [x] 7.10 Address the twelve round-two PR33 findings: bounded credential availability and post-commit shared-reference retirement, portable temporary fixtures and source references, grouped HA fields and action-only execution validation, all dirty workspace tabs, valid skill folders, syncable shortcut defaults, protected global inheritance and provider URL placeholders. Consumer regressions, six fresh gates (1,535 tests/166 files; 39 strict specs), both bundles and four sequential native mocks passed on source `17dfe7b254791ed5d7433c931bf4495a2d1bab1c`; see `verification-review-round-2-base.md`. Base PR33 only; parent owns PR34 integration and final review. Bead `open-quake-lih.17.1.34`.

- [x] 7.11 Address PR34 round2 findings: include validated emoji records and immutable assets in native backup/restore, preserve legacy `page=meetings` startup fallback with activeTab precedence, normalize only filename-derived GIF names, persist validated appearance migration before export, and cancel held emoji touches after intervening selection changes. Prove clean-root restore through library lookup/profile reference/synthetic press, actual import and static naming boundaries, mounted startup and meetings restart/history, six fresh gates and sequential native mocks. Source and evidence: `verification-review-round-2-top.md`. Bead `open-quake-lih.17.1.35`.

- [x] 7.12 Fix final-head emoji thumbnail authorization/image readiness and merge restored emoji records without losing destination libraries, drafts, settings or retained profile references. Prove registered capture isolation and both restored/destination key execution, including ID collisions and repeated restore. Evidence: `verification-review-round-3-top.md`; source `d25fa8c`. Bead `open-quake-lih.17.1.36`.

- [ ] 7.13 Address PR34 review findings on metadata-only emoji snapshots and cached visible assets, placement validation identity, repeated GIF decoding, repeated same-alias activation and sidebar/theme persistence; repair portable smoke instructions and historical report references. Prove affected consumers, run fresh gates/native fixtures, reply before resolving all nine findings, and propagate fixes into PR35. Bead `open-quake-lih.17.1.37`.
