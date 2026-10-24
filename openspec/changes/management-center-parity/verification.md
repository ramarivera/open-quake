# Management Center verification

The lane is split into two review layers. The module branch `lane/management-modules` contains the plan, agent workbench and integrations. PR https://github.com/ramarivera/open-quake/pull/33 targets main. The application branch `lane/management-center` adds emoji keys and composes the modules into the themed shell. PR https://github.com/ramarivera/open-quake/pull/34 targets the module branch. The module head is `467d113801450a88c8c98daa480a1ab0e1cbe777`; the integrated implementation commit is `07211a2`. No dependencies were added.

## Coverage and source

| Area | Audit rows addressed | Implementation and evidence |
| --- | --- | --- |
| Shell, appearance and chrome | CENTER-001–005, 007–013, 017; MGMT-012, 045, 118, 434 | `renderer/src/App.tsx`, `management/management.css`, `management/navigation.ts`, `theme/`, `main/management/appearance.ts`. Appearance migration/validation tests, alias tests and native screenshots. Existing Overview, Profiles, Connection, Screen, clock, monitor and hardware controls remain active. Responsive CSS replaces vendor panel-size props. |
| Emoji | CENTER-018, 080–090; MGMT-284 | `packages/edge/src/emoji/`, `packages/device/src/actions/action-registry.ts`, `main/emoji/`, `renderer/src/management/emoji/`, `shared/gif/`. Codec/property tests, persistence failure injection, TestClock press sequencing, profile rollback and native import/caption/placement/copy-only press. |
| Agent workbench | CENTER-019–022, 024–026, 028, 049–055, 057–060 | `packages/edge/src/agents/`, `main/agents/`, `renderer/src/management/agents/`. Workspace transactions, protected-main rejection, skill equip/unequip, bounded runtime transitions and real IPC consumers. Installer and WebChat portions of the referenced session rows are excluded. |
| Models and DK-Claw | CENTER-045–046, 065–068, 070, 103 | Agent model routing, write-only credential adapter and profile binding. Tests cover default/fallback roles, inheritance, timeouts and rollback. Native smoke saves the canonical four slots through the production profile validators. Edition installation is excluded. |
| Channels | CENTER-072–079 | `packages/edge/src/channels/`, `main/integrations/`, `renderer/src/management/integrations/ChannelsPage.tsx`. Correct six-channel fixture, setup decoding, QR expiry with TestClock, explicit pairing approval and IPC tests. Real pairing remains behind a runtime port. |
| Shortcuts | CENTER-092–096 | `packages/edge/src/shortcuts/`, integration controller and `ShortcutsPage.tsx`. JSON/Schema decoding, normalized chord conflicts, editable persisted libraries and profile sync. Generated content is never evaluated. |
| Home Assistant | CENTER-098–102 | `packages/edge/src/home-assistant/`, `main/integrations/ha-rest.ts`, integration controller, `HomeAssistantPage.tsx` and the HA strip tile. Token masking, TLS consent, AI allowlist and key display tests. Native smoke uses a loopback REST fixture and live state. The picker is hosted in the management page. |

Paths under `main/`, `renderer/` and `shared/` above are relative to `apps/desktop/src/`. Exact APIs and focused verification are documented in `main/agents/README.md`, `main/integrations/README.md`, `main/management/README.md` and `shared/gif/README.md`.

The source atlas is local-only at `~/dev/dark-encyclopedia/dk-suite-introspeccion/v0.4.95/`. Grey tokens were read from `/Applications/DK-Suite.app/Contents/Resources/app/assets/css/app.e28c8b6c.css`, the installed 0.4.69 CSS. Dark uses recovered renderer fallbacks. Light surfaces and some font roles are derived and recorded in `design.md`. DK-Suite was never launched.

## Repository gates

All commands run from the lane worktree. Scratch and `TMPDIR` use `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/management-center/`.

| Gate | Result | Log under scratch |
| --- | --- | --- |
| `pnpm biome check packages apps` | Passed, 515 files | `biome.log` |
| `pnpm typecheck` | Passed, six packages | `typecheck-current.log` |
| `pnpm test` | Passed, 1,039 tests: protocol 47, device 388, edge 55, desktop 549 | `test.log` |
| `pnpm build` | Passed | `build.log` |
| `pnpm --filter @open-quake/desktop test:bundle` | Passed, hermetic default-discovery and explicit mock modes, no hardware I/O | `bundle-current.log` |
| `openspec validate --all --strict` | Passed, 36 items | `openspec-current.log` |

These figures and the 60-capture native result below describe the initial integration. Later verification supersedes those counts. See [round one](verification-review-round-1-late.md), [round two](verification-review-round-2-top.md) and [round three](verification-review-round-3-top.md), which records 1,649 tests across 176 files, 39 strict OpenSpec items and 65 management captures.

The module branch also passed all six gates independently before its PR was opened; its logs use the `base-` prefix.

## Native mock acceptance

`main/management/smoke.ts` passed with 60 PNG screenshots under `scratch/screenshots/`. It uses hidden Electron windows, production preload and main handlers, safeStorage-backed credentials, a loopback HA fixture and `OPEN_QUAKE_MOCK_DEVICE=1`. It exercises protected `main`, workspace/skill persistence, model routing, DK-Claw profile sync, caption rendering, repeated emoji placement, panel copy-only press, shortcut sync, HA state/allowlist and sender rejection. Synthetic touch through the mounted emoji sink proves that an unavailable device keyboard triggers an invalid flash and that it clears after 160 ms. It also asserts all three font scales, keyboard sidebar resizing and visible content in the narrow rail.

The screenshots cover all ten pages in Dark, Grey and Light, including Screen's clock and monitor controls; all agent tabs, skills, channel catalog and DK-Claw; populated shortcut tables and HA key editors; and the UI settings popover. Grey also includes the caption dialog and 82 px rail. `panel-emoji-home-assistant.png` captures both live tile types. Contact sheets and full-size screenshots were inspected; the resulting rail-grid and hidden-panel CSS fixes are asserted by the harness.

The existing `main/media/smoke.ts` also passed. Its screenshots are in `scratch/media-screenshots/`. It verifies real image decoding, isolated serials, fill modes, synchronized clocks, reduced motion, existing strip profiles, synthetic touch and runtime disposal. Every native invocation used `env -u ELECTRON_RUN_AS_NODE OPEN_QUAKE_MOCK_DEVICE=1`. No real device or touch-controller handle was opened.

## Boundaries and remaining acceptance

- Production composition has no agent runtime, channel runtime, AI drafting provider or emoji motion provider. The UI reports unavailable; manual editing and imports work. These ports remain owned by the runtime/provider lanes, as specified in `design.md`.
- Physical QUAKE output, GIF clipboard compatibility, device-keyboard paste/Enter, external HA, real channel accounts and Windows/Linux native chrome remain unverified. HA display polling is every 2,000 ms rather than a WebSocket push.
- GIFs are bounded at 8 MiB, 1024×1024, 300 frames and 128 MiB retained RGBA. Encoding uses binary alpha and palette quantization. Still-image conversion is also limited to 1024×1024. Referenced assets are retained after package deletion.
- Emoji packages and shortcut libraries sync as custom profiles until folder navigation lands. Repeating sync updates the same profile. Saving does not establish hardware acceptance.
- CENTER-006 locale synchronization is outside this change. Account login, Agent Market, installer, editions, cloud model catalog and token-bearing WebChat are excluded by the approved scope and safety decisions.
- Beads `open-quake-lih.17.1.1`–`.21` record implementation and screenshot evidence. Delivery `.22` is also closed after both PRs were opened and linked. Lead-owned hardware acceptance `.23` remains open. The cluster, parity epic and redesign epic remain open. The macOS title-bar defect is tracked by `open-quake-nyd.1`; other platforms need native acceptance.
