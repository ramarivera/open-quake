Epic bead: `open-quake-lih.17.1` (cluster `open-quake-lih.17`; redesign `open-quake-nyd`).

## 1. Planning and tracking

- [x] 1.1 Record the change, its audit row mapping and the epic/task beads under `open-quake-lih.17` and `open-quake-nyd`; `openspec validate --all --strict` passes. Bead `open-quake-lih.17.1.1`.

## 2. Management Center shell

- [ ] 2.1 Appearance version 2: Grey, Dark and Light palettes, three font scales, sidebar width, version-1 migration, validation and cross-window sync, with unit tests (CENTER-003, CENTER-004, MGMT-434). Bead `open-quake-lih.17.1.2`.
- [ ] 2.2 Shell layout: sidebar sections, product mark, status card, resizer with keyboard support, 980/760 px breakpoints, UI settings popover, page header and content card. Restyle every existing page without changing its behaviour, and run the existing smokes (CENTER-001, 005, 007–012, 017, MGMT-045). Bead `open-quake-lih.17.1.3`.
- [ ] 2.3 Deep-link page activation from main and the launch URL, using DK's alias vocabulary (CENTER-013, MGMT-118). Bead `open-quake-lih.17.1.4`.
- [ ] 2.4 Title bar follows the theme on macOS, Windows and Linux through a validated IPC channel (CENTER-002, MGMT-012, `open-quake-nyd.1`). Bead `open-quake-lih.17.1.5`.

## 3. Emoji keys

- [ ] 3.1 In-repo GIF decoder, encoder and quantiser plus caption burn-in, with round-trip and property tests (CENTER-087, CENTER-018). Bead `open-quake-lih.17.1.6`.
- [ ] 3.2 Emoji domain: packages, assets, drafts, app-match settings and the global mode, in an atomic repository with weighted-name and capacity rules (CENTER-081, 084–086, 089). Bead `open-quake-lih.17.1.7`.
- [ ] 3.3 Emoji press: action descriptor, panel key sink, foreground gating, clipboard adapters, device-keyboard paste and Enter, and the invalid alert, tested with fakes and TestClock (CENTER-090, MGMT-284). Bead `open-quake-lih.17.1.8`.
- [ ] 3.4 Emoji page: three-step studio, results stash, package library, caption editor, app-match dialog, Add to main screen and Export (CENTER-080–088). Bead `open-quake-lih.17.1.9`.

## 4. Agent workbench

- [ ] 4.1 Agents domain: catalog, key rules, protected `main`, workspace templates, skills, and atomic moves with distinct failures (CENTER-049–053, 057–060). Bead `open-quake-lih.17.1.10`.
- [ ] 4.2 Model routing: role invariants, provider defaults, per-agent inheritance and write-only credentials (CENTER-065–068, 070). Bead `open-quake-lih.17.1.11`.
- [ ] 4.3 Runtime controller over `AgentRuntimePort` with 10 s and 5 s bounds and a reachable Error state, plus DK-Claw sync with preflight, revision-checked save, device step and rollback (CENTER-020–028, 045, 046, 103). Bead `open-quake-lih.17.1.12`.
- [ ] 4.4 Agents IPC and preload with sender checks and consumer tests. Bead `open-quake-lih.17.1.13`.
- [ ] 4.5 Agents page: four tabs, runtime indicator and offline panel, roster, wizard, skill management, AI Config tables and DK-Claw slots. Bead `open-quake-lih.17.1.14`.

## 5. Integrations

- [ ] 5.1 Channels domain: catalog fixture, setup validation per type, secret references, QR sessions, pairing approval and a fake runtime adapter, with IPC (CENTER-072–079). Bead `open-quake-lih.17.1.15`.
- [ ] 5.2 Channels UI: hub, cards, setup drawer, QR panel and pairing step. Bead `open-quake-lih.17.1.16`.
- [ ] 5.3 Shortcuts domain: Schema decoding without eval, chord rules, conflict detection, libraries and profile sync, with IPC (CENTER-093–096). Bead `open-quake-lih.17.1.17`.
- [ ] 5.4 Shortcuts page: generator, table and library aside. Bead `open-quake-lih.17.1.18`.
- [ ] 5.5 Home Assistant domain: origin and token handling, scoped certificate consent, entities, areas, services, allowlist, key display and live state, with IPC (CENTER-098–102). Bead `open-quake-lih.17.1.19`.
- [ ] 5.6 Home Assistant page and the strip's live-state tile. Bead `open-quake-lih.17.1.20`.

## 6. Verification and delivery

- [ ] 6.1 Native mock smoke screenshots of every page in Dark, Light and Grey, plus the narrow rail and the popover, saved under the lane scratch folder. Bead `open-quake-lih.17.1.21`.
- [ ] 6.2 Run the six repository gates, update beads and evidence, and open the PRs. Bead `open-quake-lih.17.1.22`.
- [ ] 6.3 Lead-owned hardware acceptance, explicitly outside this mock-only lane and left open at PR handoff: emoji paste and Enter through the device keyboard, Home Assistant against a real server, and DK-Claw and Home Assistant tiles on the QUAKE. Bead `open-quake-lih.17.1.23`.
