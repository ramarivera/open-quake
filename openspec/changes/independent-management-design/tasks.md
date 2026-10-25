# Tasks

Epic bead `open-quake-nyd`; this change's task bead is `open-quake-nyd.2`.

## 1. Planning and coordination

- [x] 1.1 Publish the cross-lane brief, tokens, navigation and device-palette decisions to the redesign scratch and notify the chat and device lanes.
- [x] 1.2 Capture real before screenshots at 1180 px and a true 390 px viewport in two themes with layout/accessibility metrics (hidden mock Electron, actual app root).

## 2. Visual system

- [x] 2.1 Replace the built-in theme values (Graphite, Midnight, Paper) and validate contrast in tests; keep the custom-theme contract and stored theme ids.
- [x] 2.2 Add the `--oq-*` token layer, the type scale and the rebuilt shared controls (buttons, fields, tabs, badges, cards, unboxed panel, empty state, dialog, segmented, status).

## 3. Shell and IA

- [x] 3.1 Regroup navigation into Overview / Device / Assistant / Integrations / App with compact labelled rows, selected state and the titlebar breadcrumb plus status.
- [x] 3.2 Add the narrow drawer navigation (labelled Menu button, Escape, focus return, close on selection) and per-page content layouts (`default`, `wide`, `full`), with behaviour tests.

## 4. Pages

- [x] 4.1 Flatten Overview (flat strip frame, numeric live input) and the Appearance/UI settings surfaces with the new theme labels.
- [x] 4.2 Restyle the owned management pages (keys, profiles, hardware, wallpaper, meetings, maintenance, connection diagnostic, emoji, shortcuts, Home Assistant, channels) so no bordered container nests inside another.

## 5. Acceptance

- [x] 5.1 Run the renderer tests, typecheck and Biome; capture after screenshots for every page at 1180 and 390 in all themes, inspect them, fix clipping/overlap, and record before/after evidence plus the remaining gaps in `verification.md`.

## 6. Integration follow-ups

- [x] 6.1 Language control on the integration branch (`lane/nyd2-on-opus-led`, on top of `redesign/opus-led` with the shared `useAppLocale` provider): Display popover and Appearance group, native language names, translated heading, load/persist failure text.
- [ ] 6.2 Parent-owned root smokes adopt `.nav-item[data-nav-page=…]`, the drawer at narrow widths and the HA `h1` title (exact list in the lane scratch `PARENT-SEAMS.md`), then rerun the combined root/preload acceptance.
