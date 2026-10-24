## Why

Gap cluster 16 (`open-quake-lih.17`) and the management redesign epic (`open-quake-nyd`): the management window has grown one plain page per lane and none of DK-Suite 0.4.95's Management Center. AUDIT_CENTER ranks ten user-facing gaps (emoji keys, channel catalog, skill library, DK-Claw tiles, shortcut libraries, model routing, Home Assistant display and entities, the shell, local agent lifecycle). AUDIT_MGMT top gap 10 adds the layout and the DK colour tokens. Ramiro called the current window garbage (`open-quake-nyd`), and the native title bar ignores the theme (`open-quake-nyd.1`).

## What Changes

- One Management Center shell: DK's sidebar with Device, Core and Apps sections, three themes (Dark, Light, Grey) × three font scales (Small, Medium, Large) persisted together, a resizable sidebar, the UI settings popover and deep-link tab activation. The window's title bar follows the theme. Existing lane pages (Overview, Profiles, Screen, Controls, Connection, Appearance) are restyled inside it with their behaviour unchanged.
- Emoji keys end to end: emoji packages, GIF import and caption re-render without ffmpeg, the copy / paste / paste-and-send press modes, foreground-app gating, and "Add to main screen".
- An agent workbench: local agent roster with a protected `main` agent and a two-step creation wizard, a shared vs per-agent skill library with equip/unequip and AI-drafted `SKILL.md`, the runtime lifecycle controls, the default/fallback model routing table with per-agent inheritance, and the four DK-Claw agent tiles with sync and rollback.
- AI shortcut libraries: app-targeted generation decoded by Schema (never `eval`), an editable table with conflict detection, persisted libraries and sync to the device.
- The six-channel catalog with every setup type and a DM pairing approval step, behind a runtime adapter.
- Home Assistant key display (icon, state, custom fields) rendered live on the strip, plus the AI-exposed entity picker, with a masked token and a per-connection certificate exception that needs explicit consent.

## Capabilities

### New Capabilities

- `management-center`: shell, themes, font scales, sidebar, deep links and title bar.
- `emoji-keys`: packages, assets, caption rendering, press behaviour and placement.
- `agent-workbench`: agents, skills, runtime lifecycle, model routing and DK-Claw tiles.
- `ai-shortcut-libraries`: generation, editing, libraries and sync.

### Modified Capabilities

- `integration-channels`: adds the catalog presentation, the setup drawer and DM pairing approval to the requirements in `openspec/changes/integration-channels`.
- `home-assistant-integration`: adds key display modes, the AI entity allowlist and masked token entry to `openspec/changes/home-assistant-integration`.

## Impact

`packages/edge` gains the `emoji`, `agents`, `shortcuts`, `channels` and `home-assistant` domain modules. `packages/device` gains the `emoji` action descriptor. `apps/desktop` gains main-process adapters (clipboard, foreground app, device keyboard, keychain, Home Assistant session), typed preload bridges and the renderer pages. No new dependencies. Out of scope by decision 9: account login, Agent Market, the OpenClaw installer, editions and the cloud model catalog. Real AI generation, a real agent runtime and real channel pairing stay behind unavailable adapters until their owning lanes supply them. Hardware delivery of the strip tiles needs the lead.
