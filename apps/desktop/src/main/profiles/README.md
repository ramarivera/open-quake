# Profiles manager

Implements `openspec/changes/profiles-manager-parity` tasks 1.1–1.5 on the
PR #12 profile model. Task 1.6, `open-quake-lih.9.1.6`, remains open for
real-device integration and acceptance. The cluster and epic remain open.

## Catalog and source evidence

The local research root is
`~/dev/dark-encyclopedia/dk-suite-introspeccion/v0.4.95/`.
`recovered_sources/src/utils/DefaultProfileData.js` supplies 117 records in
11 arrays, including three Quick variants. `locales/locale-*.json` supplies
648 exact strings across English, Chinese, German, French, Italian, Spanish,
Japanese and Korean. The committed JSON contains configuration facts and a
reduced string dictionary, without vendor application code or artwork.

Menu order is Discord, MeetAI, Vivid, Quick, SysView, AI Chat, Music, Clock,
DK Claw. Resource IDs retain the installer order, so Vivid is `1-4` and Quick
is `1-2`. macOS stores Discord but excludes it from the manager/menu.
Windows/macOS Quick titles are literal in the source. Linux Quick references
a locale namespace missing from all eight dictionaries, so its source titles
remain literal. DK Claw agent labels resolve through `openclawAgents`.

Only the approved adaptations change raw catalog facts: six website actions
point to the project and its issues, three DECOKEE labels become open-quake,
and clock weather starts disabled. No Spotify, account, NSFW or jailbreak
material is included. Shell actions keep their recovered text and require
native confirmation before their first execution. Approval persists as a
SHA-256 digest of profile ID, key coordinate and exact command. A changed
command requires approval again. Renderer requests cannot supply shell text.

| Audit rows | Implementation and verification |
| --- | --- |
| MGMT-315–316, 338–340, 343, 346–384 | Nine resources, source footprints/actions/locks, platform Quick and locale projection. Catalog tests and local source comparison cover the data. Widget execution and full-strip rendering belong to other lanes. |
| MGMT-313–324, 345 | Serialized CRUD, weighted names, deep copy, visibility, 30 visible profiles, stable deletion anchor and thumbnails. Manager/repository tests cover failures and concurrent key saves. The hidden vendor copy action is available through IPC with localized Copy suffixes. |
| MGMT-326–327, 329–337 | Plain profile properties, installed-app selection, Other picker, connected-device scope, startup singleton and confirmation. Recovered labels are used; this page is ready for the design lane. App icons and vendor dialog styling are deferred. |
| MGMT-091, 333–334; MAIN-079, 084 | Immediate polling, 3000/2000 ms intervals, 500 ms cache, native deadlines, normalized LCS >=0.79, 300 ms per-device debounce and first-connect default protection. Effect TestClock exercises switching and disposal. Native macOS identity/app-list reads are included in the smoke. |
| MGMT-430–434 | Real hidden-window captures, content/locale cache keys, per-row update, batch progress and cancellation. Captures show the current plain profile preview. |
| MAIN-085 | Integration contract only. Lifecycle must supply logical serials and exclude the Quake-HID twin. Hardware delivery remains unverified. |

Additional source locations are
`recovered_sources/src/views/Components/FunctionWheelEditor.vue:349–356,
519–683, 793–1334`, `ProfileProperties.vue:141–420`,
`recovered_sources/src/main/utils/activeWindowService.logic.js:1–67`, and
`app-resources/background.js` installer, `_loadAppMonitorConfigInfo`,
`_onActiveWindowMonitorChange`, `sendProfileChangeRequest`, and
`isSameAppPath`. The new name input preserves surrogate pairs while applying
the source UTF-16 weighting.

## Composition and integration

`ProfileManager` and `ProfileSwitching` share one `ProfileRepository` and its
mutex. The optional manager metadata is backward-compatible with PR #12.
Transactions persist the complete envelope before publishing frozen,
detached snapshots. Existing user profiles survive catalog installation.
Fresh desktop storage installs the catalog without the old empty seed.
Hidden built-ins remain stored. Strip geometry rules are unchanged.

`registerProfiles(management, renderer?, deliver?)` owns the repository,
foreground monitor, IPC handlers, native dialogs and capture windows. The
optional `deliver(serial, profile): Promise<void>` callback is the real
profile transport seam. Rejection produces `ProfileDeliveryFailed`; no panel
selection event is sent on failed delivery. The lifecycle owner must call
the returned `connect(serial, reportedProfileId?)` after identity discovery
and `disconnect(serial)` when that session ends. Connect reserves the session
before storage IO, so duplicate initialization reports cannot race it.
Disconnect invalidates pending debounce and initialization work.

The baseline bus exposes neither serial identity nor profile transport.
Desktop composition therefore connects `desktop-preview` only in explicit
mock mode. Real discovery does not fabricate a serial. Without a delivery
callback, selection is persisted and published to the desktop panel only.
`ProfileSwitchingPort` is also exported for direct Effect composition.

Selected-profile previews replay persisted selection on mount and filter live
events by the `serial` query parameter, defaulting to `desktop-preview`.
Thumbnails are PNG captures of the built renderer, keyed by canonical content
and locale. They contain labels and source sizes; this lane does not implement
the specialized clock, monitor, meeting or AI widgets.

Only the main-owned management window's top-level renderer frame can mutate,
capture, choose apps or execute a shell key. Matching renderer documents may
read. Query strings do not grant write permissions. Preview reads preserve
the management locale. Every subscription has a disposer, captures destroy
their windows in `finally`, and quit waits for pending requests and runtime
disposal.

Native probes use fixed `execFile` arguments. macOS reads NSWorkspace and
CoreGraphics without System Events scripting; Windows reads user32 and the
owning process path; Linux uses X11 `xprop` plus `/proc`. Wayland monitoring
is unsupported in this adapter. macOS application discovery covers top-level
system/application directories; Windows uses App Paths registry entries;
Linux reads system desktop files without executing their command lines.
The native picker's Other option covers applications outside those lists.

## Verification

Run the six lane gates from the repository root:

```sh
pnpm biome check packages apps
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @open-quake/desktop test:bundle
openspec validate --all --strict
```

Set `TMPDIR` to the lane scratch directory before filesystem tests. Build and
run the native proof with an absolute screenshot destination:

```sh
pnpm --filter @open-quake/desktop exec electron-vite build --config src/main/profiles/smoke.config.ts
env -u ELECTRON_RUN_AS_NODE OPEN_QUAKE_MOCK_DEVICE=1 pnpm --filter @open-quake/desktop exec electron out/profiles-smoke/smoke.js "$PROFILE_EVIDENCE_DIR"
```

The proof uses hidden windows, real preload/main IPC and native captures. It
checks first-run installation, actual UI create/rename, an outbound delivery
callback, selected-panel reload, spoofed-window rejection, batch capture,
restart/default persistence and narrow overflow. On macOS it also reads real
foreground identity and installed apps. It creates temporary user data under
the evidence directory and removes it on exit. It never registers the HID bus.

Lane logs, source comparison and screenshots are under
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/profiles-manager/`:
`biome.log`, `typecheck.log`, `test.log`, `build.log`, `bundle.log`,
`openspec.log`, `source-verification.log`, `profiles-smoke.log`,
`media-smoke.log`, `manager.png`, `manager-narrow.png`,
`profile-settings.png`, `selected-profile.png`, and `media/*.png`.

Real QUAKE delivery/acknowledgments, physical key execution, Windows/Linux
native adapters, Wayland support and native first-run shell dialogs remain
unverified. Controller tests prove approval/cancellation and exact-command
binding without running shell content. No device was opened, no firmware was
flashed, and DK-Suite was not started.
