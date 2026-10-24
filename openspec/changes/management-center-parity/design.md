## Context

Evidence: dark-encyclopedia `dk-suite-introspeccion/v0.4.95/audit/AUDIT_CENTER.md` (CENTER-001…106), `AUDIT_MGMT.md` MGMT-012, MGMT-045, MGMT-118, MGMT-284, MGMT-434, and `GAP-MAP.md` cluster 16. The renderer sources are `v0.4.95/recovered_sources/src/views/ManagementCenter/` (`MC/` below), `views/CustomConfig/`, and `views/Components/HomeAssistantConfig.vue`. The main process is `v0.4.95/app-resources/background.js`: the channel catalog starts at byte 1739148, `processEmojiAction` at about 1042300, and the keystroke helper `Gi` at 1048037. UI strings come from `v0.4.95/locales/locale-en.json`. The 0.4.69 build's compiled `/Applications/DK-Suite.app/Contents/Resources/app/assets/css/app.e28c8b6c.css` was read as a file; the app was not launched. These are local research inputs; no vendor source is copied beyond strings, data tables and numeric values.

Bead map: cluster `open-quake-lih.17`, redesign epic `open-quake-nyd`, title bar bug `open-quake-nyd.1`. The epic for this change and its task beads are listed in tasks.md.

## Goals / Non-Goals

Goals: one coherent Management Center that restyles every existing page without changing its behaviour, and delivers the ten AUDIT_CENTER gaps plus the shell.

Non-goals (decision 9): DecoKee account login and its nags (CENTER-014–016), Agent Market browse, share and install (CENTER-056, 061–064), the bundled OpenClaw installer, offline packs, upgrades and scene editions (CENTER-027, 029–039, 035, 043, 044), the cloud model catalog and region policy (CENTER-069, 071), and the dev-only and dead legacy UIs (CENTER-042, 091, 097). The embedded OpenClaw WebChat (CENTER-023, 041) is not shipped: it is a third-party UI that needs the gateway token in the URL ("Don't copy"). Service port, log level, autostart and data directory (CENTER-047, 048) and the unused OpenClaw IPC surface (CENTER-104) rank 11th and 12th, outside AUDIT_CENTER's top ten; follow-up beads track them.

## Decisions

### 1. Palettes

DK-Suite 0.4.95 sets three classes on the root, `theme-light`, `theme-mainscreen` and none for dark (CENTER-004). Its `management-center-theme.less` was not recovered, so:

- **Dark** uses the 0.4.95 renderer's inline `--mc-*` fallbacks, the most frequent value per token across `MC/**/*.vue`:
  - bg `#0A0A0B`, titlebar `#0e1015`, sidebar `#0e1015`
  - surface `#131316`, surface-soft `#13151b`, surface-raised `#191c24`
  - border `#1e2028`, border-soft `#333849`, border-strong `#2e3040`
  - text `#f4f4f5`, text-muted `#d4d4d8`, text-subtle `#8b8b94`
  - accent `#FFFFFF`, accent-soft `rgba(255,255,255,.06)`
  - accent-blue `#38BDF8`, accent-blue-soft `rgba(56,189,248,.14)`, accent-blue-line `rgba(56,189,248,.5)`
  - green `#4ADE80`, amber `#F5B547`, red `#F87171`
  - primary button foreground `#0B0B0D`, hover background `#E5E5E5`
- **Grey** (DK "mainscreen", the first-run default) uses the 0.4.69 compiled `.dk-mainscreen` tokens (MGMT-434):
  - surface `#282828`, surface-deep `#242424`, panel `#2f2f2f`, panel-inner `#2c2c2c`, elevated `#323232`
  - borders `rgba(255,255,255,.07)`, strong `.10`, divider `.06`
  - text `#f0f0f0`, muted `#a8a8a8`, subtle `#909399`
  - hover `rgba(255,255,255,.04)`
  - accent `#5a5a5a`, strong `#4e4e4e`, hover `#626262`
  - focus `#8a8a8a`, selected border `#9a9a9a`, danger `#ef4444`, success `#10b981`
  - primary button `#484848`, hover `#585858`, text `#fafafa`
  - radii 8/12/16, panel shadow `0 1px 4px rgba(0,0,0,.12)`

  Grey keeps DK's blue only for status and focus, not selection, matching the main screen.
- **Light** is derived. The only recovered light values are the warm text hints `#211e1a`, `#403c35` and `#6e6960` (MC/ManagementCenterContent.vue:782–829, ClawControlPanel.vue:152–161). Surfaces are a warm paper scale (`#f6f4f0`, `#fbfaf7`, `#ffffff`); the accent blue is darkened to `#0369a1` for 4.5:1 contrast. This deviation is recorded because DK's values are unknown.

Each palette maps onto the existing nine `--quake-*` tokens, so every lane page restyles without edits. It also fills the `--mc-*` set for the shell. An imported custom theme derives its `--mc-*` set from its nine tokens with `color-mix`, so imports still restyle everything (theming-animation-contract "Validated custom themes").

### 2. Font scales

DK exposes ten roles: `--mc-font-micro`, `caption`, `meta`, `body-sm`, `body`, `subtitle`, `title`, `title-lg`, `display` and `button`. Only some fallbacks were recovered (display 22, body 13 and 14, body-sm 13, meta 11 and 12). Small uses those values: 10, 11, 12, 13, 14, 15, 16, 18, 22 and 13 px. Medium adds 1 px to each role (display +2) and Large adds 2 px (display +4). The roles that were not recovered are interpolations and are marked as derived.

### 3. Appearance version 2

`open-quake.appearance.v2` holds `{version: 2, theme: dark|light|grey|custom, customTheme, motion, fontScale: small|medium|large, sidebarWidth: 120–360 | null}`. The version-1 key is read once and migrated in memory with its theme preserved. It is written as version 2 only on the next change, so a downgrade still reads version 1. Storage, broadcast and validation reuse the theming contract's mechanism.

### 4. Title bar

macOS: `titleBarStyle: "hiddenInset"`, with a 52 px themed drag strip that pads 78 px for the traffic lights. Windows: `titleBarStyle: "hidden"` plus `titleBarOverlay {height: 55, color, symbolColor}`, updated through `setTitleBarOverlay`. Linux keeps the native frame. On every platform the renderer sends `{base, titlebar, symbol, background}` over one validated IPC channel. Main applies `nativeTheme.themeSource`, `setBackgroundColor` and the overlay, accepting only the management window's top frame. The window starts with the stored palette's background, read from a small main-side cache, to avoid a white flash.

### 5. Domains and ownership

Each domain follows effect-conductor: `<domain>-contracts.ts`, `-invariants.ts`, `-errors.ts` (its own catalog until a shared kernel exists, as in `packages/edge/src/ai`), `-repository.ts` and `-service.ts`, under `packages/edge/src/<domain>/`. Main-process adapters live under `apps/desktop/src/main/<domain>/`, typed IPC contracts under `apps/desktop/src/shared/<domain>-contracts.ts`, preload bridges under `window.quake<Domain>`, and renderer pages under `apps/desktop/src/renderer/src/management/<domain>/`. Every IPC handler checks the sender is the management window's top frame, like the hardware and profile handlers.

GPT-6.1 Sol owns the management window design and integration. Domain implementation may be split into bounded Sol tasks following the Beads workflow, with one owner for shared registration and renderer files. No Claude workers are used. The implementation must follow current main's profile services, knob dispatcher and credential adapter rather than assuming they are missing.

### 6. Adapters that stay unavailable

The repository does not yet compose an AI provider, an agent runtime or a channel runtime in main. Each consumer depends on a port with an explicit unavailable implementation, and the UI says so:
- AI drafting: one `DraftPort` (`generateText(system, prompt)`) for agent personas, skill drafts and shortcut generation.
- Motion generation: `EmojiGenerationPort`.
- Agent runtime: `AgentRuntimePort`.
- Channel runtime: `ChannelRuntimePort`.

Tests and the native smoke supply fakes. When the owning lanes land (`open-quake-9h3` agent runtime, `open-quake-lih.15` AI providers), they register real implementations without UI changes.

### 7. Emoji without ffmpeg

DK burns captions with ffmpeg (CENTER-083). open-quake has no ffmpeg and adds no dependency, so it keeps the original GIF frames and renders captions in the management renderer:
1. Decode with an in-repo GIF decoder (LZW, disposal, transparency).
2. Composite each frame to RGBA.
3. Draw the caption on a canvas: weight 800 white fill with a dark stroke at the chosen size and position.
4. Quantise each frame to at most 256 colours (median cut with a cached nearest lookup).
5. LZW-encode, keeping delays, loop count and canvas size.

Main decodes the result before it replaces anything. Still images become one-frame GIFs the same way.

### 8. Emoji press path

open-quake has no general key-action dispatcher in main yet (key-function-library task 2.6, `open-quake-r7r.10`). The panel already emits `quake-strip-key`, so this change adds a narrow key sink: the panel forwards `{profileId, pageId, keyCode, keyAction}`. Main resolves the key against the committed profile envelope and, for `type: "emoji"`, runs the emoji press conductor on release (keyAction 1). Other types are ignored here and stay owned by the action lane. The sink is a typed handler map, so the action lane can register further types.

The conductor's ports are: foreground app (the profiles lane's probe), clipboard (osascript or PowerShell with the path as data, never in a command string), and keyboard (`hardwareKeyboardAdapter` on the device session, matching DK's default gaming-mode route, MAIN-015). The panel shows the invalid alert by flashing the key.

### 9. Placing keys on the strip

The strip has no folder navigation yet (cluster 9). "Add to main screen" and "Sync to main screen library" therefore write a custom profile named after the package or library, with up to 16 keys per page, and remember the profile ID in the package or library. Repeating the action updates that profile. When folder keys land, a follow-up can switch to DK's folder-key form.

### 10. Home Assistant transport

Requests use a dedicated Node HTTPS agent for each HA origin. Its TLS connection verifies normal trust first. A failing certificate is accepted only when its SHA-256 fingerprint and exact origin match an explicit saved consent. The socket reaches the HTTP client only after this check, so the bearer token is never sent before trust succeeds. Other HTTPS requests keep normal verification. Areas come from the REST template endpoint (`areas()`, `area_entities()`), entities from `/api/states`, and services from `/api/services`. Live state polls `/api/states/<id>` for subscribed entities every 2 s while the strip shows them. DK pushes over a WebSocket, but polling keeps every request inside the origin-scoped TLS transport; the cost is up to 2 s latency.

## Risks / Trade-offs

- Light palette values are derived, not recovered. They are easy to adjust once the LESS file is found.
- In-renderer GIF quantisation can band gradients. Captions on busy GIFs may look slightly worse than ffmpeg's palettegen.
- Writing profiles for emoji and shortcut placement adds profiles the user did not create by hand. They are named after the package and removable like any custom profile.
- Domain contracts can drift from the UI's needs. Integration verifies each IPC consumer and its visible success and failure paths.

## Migration plan

Appearance migrates from version 1 to version 2 in memory (Decision 3). The new stores are versioned JSON under `userData`: `emoji-v1/`, `agents-v1/` and `integrations-v1/`. Emoji uses a validated primary and backup plus immutable hashed assets. Agents commit a generation pointer for the catalog and workspace Markdown together. Integration JSON files use a temporary file and atomic rename. Secrets use Electron safeStorage encryption backed by the OS credential store; unavailable encryption and Linux basic_text are refused. Public replies contain a mask or availability flag. Saved strip keys retain asset references after package removal, so assets are retained rather than collected automatically.

## Verification

Unit and property tests per domain (Effect TestClock for timeouts and delays), consumer tests through the real IPC handlers with fakes, and the native mock smoke. The smoke screenshots every page in Dark, Light and Grey, plus the narrow rail and the popover, into `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/management-center/`. The following stay unverified until the lead runs them on the hardware: paste and Enter through the real device keyboard, the clipboard file on the real host, Home Assistant against a real server, and the strip tiles on the QUAKE.
