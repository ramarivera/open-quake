# Key actions

Import the module through `actions` from `@open-quake/device`. `ACTION_REGISTRY`
contains validation schemas, draft defaults, aliases, support/edit flags,
permissions, autonomy, required capabilities, and dispatch bindings. Drafts may
be incomplete. `validateAction` validates the action portion of a key. The
profile owner validates layout, title, artwork and committed revision.

`createActionDraft` returns an independent copy. `normalizeActionImport` is pure
and returns independent `original` and `normalized` values plus value-free
migration diagnostics. Store `original` as compatibility metadata. It never
executes or saves a profile. Unknown records and hotkeySwitch retain their data.
The skipForward defect is a contextual migration, never a global skipBackward
alias. New text defaults have no enter action.

The recovered behaviors are referenced, not redistributed. The independently
authored test records are in `test/actions/action-fixtures.ts`. Read-only sources:

- `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, section 3.
- `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion/artifacts/recovered_sources/webpack:__dk-suite_src_plugins_KeyConfiguration.js`, skipForward at lines 1177–1202.
- `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion/artifacts/recovered_sources/webpack:__dk-suite_src_plugins_hotKeyFun.js`, isHotkeyPlaceholderValue and transferKeyName.
- `/Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion/artifacts/recovered_sources/webpack:__dk-suite_src_views_Components_config_OperationConfig.vue`, handleCheckbox and handleSupportKnobChange.
- `/Users/ramarivera/dev/open-quake/.context/decokee-quake-template/src/locales/en.json` and `zh.json`, hotkeyMatching and observingKeys. Other locales can supply exact additional sentinels through `HotkeyImportSentinels`.

At composition, supply `ActionHostAdapters` and `ActionProfileSource` to
`ActionService.DefaultWithoutDependencies` using a flat merged layer. The default
service has no host capabilities and no active snapshot. There are no OS
implementations in this module. Adapters report the catalog's permission,
missing-application, or host-failure leaves at their actual IO boundary. They
retain original causes privately. No automatic side-effect retry is installed.
An atomic chord adapter must release modifiers on success, failure and
interruption. Text inserts exact content. The conductor checks optional enter
support before inserting and sends it only after insertion succeeds.

The profile source returns only committed active snapshots, with the device's
current connection session. Normalized events identify that same profile, page
and revision. Sequence numbers increase per device/control within a session,
including across profile changes. A repeated publication retains its sequence.
Logical and verified mapped physical presses are accepted. Raw HID input has no
entry point here. Missing, hidden and stale keys do nothing. Each control stays
held until release; duplicate presses, repeats and holds never execute. An old
revision's release may clear held state but cannot execute an action. Reconnect
uses a new session, so old-session events cannot replay against it.

Profile navigation, panelBrightness, assistant direct voice and dkDesktopClock
are integration descriptors. Their schemas match the owning change's action
contract. They report unavailable in this host leaf conductor and delegate
execution or rendering to their own runtime. A two-chord focused hotkey also
requires the knob router; a tile press cannot guess which chord to execute.
hotkeySwitch remains unresolved and cannot validate as executable. Later catalog
coverage and composite actions remain tasks 3.x.

Verification uses the real action conductor with fake adapters and committed
snapshot sources. It proves outbound arguments, call counts, ordering,
capability failures, import preservation, safe error serialization and duplicate
suppression. Host permissions, native effects, hardware mapping and UI/IPC
integration remain unverified until tasks 2.x.
