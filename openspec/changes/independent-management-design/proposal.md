## Why

Ramiro rejected the Management Center on 2026-10-25 as an ugly DK-Suite imitation (glass/dark DK palette, 56 px navigation rows that push half the pages out of view, nested bordered cards, a fake hardware bezel and skeuomorphic knob, an icon-only rail at narrow widths). The previous redesign pass changed only three legibility details, and he called that out as a failure (`open-quake-nyd`, task `open-quake-nyd.2`). He explicitly superseded the recovered DK visual-parity requirements: features and behaviour stay, DK visuals go, and an Opus design lead owns all design decisions across the management, chat and device lanes.

## What Changes

- An open-quake visual system that replaces DK's recovered palette and geometry: three neutral themes (Graphite default, Midnight, Paper; ids `grey`, `dark`, `light` unchanged) with one jade accent reserved for primary action, selection and focus, and green/amber/red only for state. All themes are validated for text and control contrast.
- A semantic `--oq-*` token layer (surfaces, lines, text, accent, state, focus, radius, spacing, floating elevation) published to peer lanes, with the legacy `--mc-*` names aliased onto it. The font-scale roles stay and the Small base body size becomes 14 px.
- Shared controls rebuilt for a calm product UI: secondary, primary, quiet and danger buttons, label-above fields, underline tabs, toned badges, one bordered container level (`.mc-panel` becomes an unboxed section), left-aligned empty states, flat dialogs.
- A new management information architecture: Overview, then Device (Keys, Knob profiles, Screen, Controls, Connection), Assistant (Agents, AI shortcuts, AI emoji, Meetings), Integrations (Home Assistant) and App (Appearance, Settings), with compact 32 px labelled rows so every page is visible at once. The title strip shows the section and page breadcrumb plus live device status.
- Narrow windows (below 760 px) get a top bar with a labelled Menu button that opens the navigation as a drawer, instead of an icon-only rail. Medium widths keep the labelled sidebar.
- The content column gets layouts per page: forms at a readable 880 px measure, Overview at 1200 px, and Agents full-bleed for the chat workspace.
- Overview and the strip preview become flat: the real strip canvas in a plain frame, with a numeric live-input readout and no fake knob or bezel.
- Page-level restyles of the management pages owned by this lane, so no bordered card nests inside another.

## Capabilities

### New Capabilities

- `management-design-system`: themes, tokens, shared controls, navigation IA, responsive shell and page layouts for the management window.

### Modified Capabilities

- `management-center` (in `openspec/changes/management-center-parity`): the DK-geometry parts of "Management Center layout", "Resizable and responsive sidebar", "Themes and font scales" (DK palette sources), "UI settings popover" (labels) and "Content panels and status card" are superseded by `management-design-system`. Routes, deep-link activation, persistence, font scales, the resizer behaviour, the title-bar theming contract and the live status regions stay as specified there.

## Impact

Renderer only: `apps/desktop/src/renderer/src/{styles.css,App.tsx shell section,management/** except chat/agents/agent-http,theme/**,ui/**}` and the management-page CSS of keys, profiles, hardware, wallpaper, meetings, maintenance and the connection diagnostic. No main, preload, shared, edge or dependency change. The root management smoke asserts the DK 82 px rail at 820 px and needs a parent-owned update (seam request in the lane scratch). Chat/agents (`open-quake-nyd.3`) and strip/panel (`open-quake-nyd.4`) consume the published tokens in their own changes.
