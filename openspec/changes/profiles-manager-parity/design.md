## Context
Recovered sources: dark-encyclopedia/dk-suite-introspeccion/v0.4.95/recovered_sources/src/utils/DefaultProfileData.js, views/Components/FunctionWheelEditor.vue, ProfileProperties.vue, main/utils/activeWindowService.logic.js and app-resources/background.js. Locale dictionaries provide labels. Dataset records interoperability facts only, not vendor application source.

## Decisions
Extend PR #12 with a serialized whole-envelope transaction, sharing its mutex, atomic storage and commit stream. Optional manager metadata tracks revision, hidden built-ins, startup choice, app links and command approvals. Existing user profiles survive catalog installation. IDs 1-0 through 1-8 retain vendor resource identity; menu order differs from resource order. macOS stores Discord but omits it from its menu.

Store untranslated catalog identities and translate on reads. Custom labels stay literal. Unknown actions retain data for downstream capability owners. Do not modify geometry rules. Preserve source footprints and covered placeholders.

All IPC commands decode Schemas. Only the main-owned management window may mutate or approve commands; panel windows may read. A native confirmation shows exact shell content, and approval is bound to that content so edits require another prompt. No renderer can submit arbitrary shell text.

Native foreground probing uses fixed execFile programs/arguments, 5 s deadlines and 500 ms caching. A scoped Effect loop polls immediately then every 3000/2000 ms. Normalize bundle paths and use LCS similarity >=0.79. Keep the current profile on unmatched apps. Per-device generation-based 300 ms debounce cancels stale requests. Startup default wins once per connected session; duplicate initial reports cannot overwrite it. Main publishes complete selected profiles to the panel transport. A small delivery port accepts real serials from the device lifecycle owner without opening hardware here.

Thumbnails capture the current canonical profile through a hidden renderer window, cache by profile revision and locale, report batch progress and cancellation, and fail explicitly when capture is unavailable. No proprietary icons or app artwork are copied.

Implementation evidence and source findings are in `apps/desktop/src/main/profiles/README.md`. Thumbnail cache keys include full content and locale so catalog updates also invalidate them. The baseline bus has no serial identity/profile transport. `registerProfiles(management, renderer?, deliver?, managementURL?)` exposes optional async delivery plus connect/disconnect methods; mock composition exercises the complete desktop path. Real serial/twin filtering and hardware acceptance remain task 1.6 / `open-quake-lih.9.1.6`. Keep this change and its epic open until that integration has evidence.

Integration with merged management/strip lanes retains `<userData>/profiles-v1.json` and shares one repository/runtime with the strip's read-only IPC. The manager has its own preload name and snapshot channel, and a Knob Profile sidebar page. Previews and captures consume the strip lane's `StripScreen`/`StripViewport`; no span or geometry rules change.

## Safety adaptations
Decision 12 excludes vendor account, Spotify and NSFW/jailbreak presets. MGMT-341 vendor links become project links. Decision 15 turns automatic IP weather lookup off. Shell keys ship with first-run native confirmation per decision 13. Hardware runs are forbidden in this lane; mock mode must also work in built Electron applications.

## Review round 1 integration

Main includes the shared clock and hardware registrations while retaining the single profiles repository, manager sidebar and touch route. Selection delivery occurs under the repository transaction before committing or publishing. Manager commands prepare connected-device selections in the same transaction. Failed delivery leaves durable selections and repository subscribers unchanged.

Management mutations require both the main-owned window's main frame and its exact expected URL. Initialization uses a semaphore and caches only a successful controller. Typed failures reach IPC and can be retried. Mock bus shutdown disconnects the old profile session before reopen.

Visibility clears hidden startup defaults; connection also rejects legacy hidden defaults/reports/saved selections. Deletion restores only visible anchors and preserves unrelated transient selections. Matching selects the best eligible link for each serial, after filtering hidden profiles. Linux application paths are canonicalized before linking; its picker omits extension filters. Approved long-running commands resolve on spawn acceptance rather than waiting for application exit.

Task 1.8 defers Windows's per-probe `Add-Type` replacement to a scoped persistent PowerShell helper with native Windows latency/lifecycle verification. Bead: `open-quake-lih.9.1.8`.

The subsequent main merge includes knob-model parity. Knob reads and selections use the existing manager runtime and its transactional selection path. Committed snapshots refresh the knob context; shutdown interrupts that subscription before disposing the knob and profile runtimes. Hidden profiles are excluded from knob context, and the actual Vivid catalog ID selects wallpaper mode.

Catalog metadata includes stable resource and title keys for renderer themes. Translation restores those identifiers on older installed built-ins without changing custom metadata. The strip selects only visible profiles, including its no-selection fallback, so a fresh macOS panel agrees with the manager without requiring a mock device connection.
