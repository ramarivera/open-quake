## ADDED Requirements

### Requirement: Agents page and runtime lifecycle controls
The Core › Agents page SHALL have four tabs: "Agent sessions", "Agent management", "AI Config" and "Settings", with the first selected by default and tab state kept while switching. Its header SHALL host a runtime indicator: an 8 px dot, a status label (Ready, Starting, Stopping, Error, Stopped) and 28 px Start, Stop and Restart buttons. Start SHALL be disabled while ready or starting; Stop and Restart SHALL be disabled unless ready. The indicator SHALL subscribe to runtime status rather than poll. Unlike DK, whose snapshot never sets it, the Error state SHALL be reachable. Start and restart SHALL be bounded at 10 s and stop at 5 s (agent-runtime "Optional runtime"). When no runtime backend is installed, the indicator SHALL say so, every control SHALL be disabled, and no installer SHALL run. The sessions tab SHALL show the runtime pill with the agent count, and an offline panel with large Start, Stop and Restart buttons (148×84, radius 12) whenever the runtime is not ready. The embedded OpenClaw WebChat SHALL NOT be shipped: it is a third-party UI that needs a gateway token in the URL. Source: CENTER-019, CENTER-020, CENTER-021, CENTER-022, CENTER-024, CENTER-026, CENTER-028.

#### Scenario: Start fails
- **WHEN** the runtime adapter reports a start failure
- **THEN** the dot turns red, the label reads Error, and a "Start failed" message carries the failure code

#### Scenario: No runtime installed
- **WHEN** no agent runtime backend is registered
- **THEN** the indicator reads that no runtime is installed, every lifecycle control is disabled, and pressing nothing can launch an installer

#### Scenario: Start timeout
- **WHEN** the runtime has not reported ready 10 s after Start
- **THEN** the status becomes Error with a timeout code and the start is cancelled

Audit regression coverage: CENTER-019.

#### Scenario: Workbench drafts survive tab switches
- **WHEN** the user edits local state in sessions, agents, AI config and Settings then switches away and back
- **THEN** each panel retains its draft and keyboard tab navigation exposes the selected panel

### Requirement: Local agent roster
"Agent management" SHALL list local agents with a count, search by display name and ID, the filter chips All and Local, and a four-row skeleton while loading. Each row SHALL show an emoji avatar, display name, ID, a badge (System for `main`, Local otherwise) and Edit and Delete actions. The `main` agent SHALL always exist, SHALL show a lock labelled as a protected agent, and SHALL offer neither edit nor delete. Deleting SHALL ask for confirmation naming the agent and remove its workspace. Empty states SHALL offer "Clear search" or "Create agent". Selection SHALL persist and fall back to the first agent when the selected one is removed. Agent Market filters, share and install requests are out of scope (decision 9). Source: CENTER-049, CENTER-051, CENTER-054, CENTER-055, CENTER-059.

#### Scenario: Protect main
- **WHEN** a delete request names `main`
- **THEN** it is rejected as a protected agent and the catalog is unchanged

#### Scenario: Search with no match
- **WHEN** the user searches for `zzz`
- **THEN** the list shows the no-results state with Clear search

### Requirement: Two-step agent creation
"Create agent" SHALL open a two-step wizard. Step 1 ("Basic Info") SHALL take an agent ID, a display name and one of the 20 emoji presets (default 🤖). The ID SHALL be validated live against `^[a-z][a-z0-9-]*$`, at most 48 characters, not `main`, and unique; input SHALL be sanitised by dropping characters outside `[a-zA-Z0-9-]`, lowercasing and truncating to 48. "Next" SHALL create the agent and its workspace from open-quake-authored templates (`IDENTITY.md`, `SOUL.md`, `AGENTS.md`) and move to step 2 with no way back. Step 2 ("Role Config") SHALL offer a persona prompt with "Generate config", which drafts the workspace Markdown through the AI drafting adapter, and a tabbed editor for the workspace `*.md` files. "Save Agent" SHALL save every dirty file in order using each successful reply's revision and close only after all edits persist. A partial failure SHALL keep the dialog open with remaining edits intact; retry SHALL skip files already saved. Editing an existing agent SHALL open step 2 directly. Source: CENTER-050, CENTER-057, CENTER-058.

#### Scenario: Reserved ID
- **WHEN** the user types `main` as the agent ID
- **THEN** step 1 shows the reserved-ID error and Next is disabled

#### Scenario: Several workspace tabs edited
- **WHEN** the user edits IDENTITY.md, SOUL.md and AGENTS.md and presses Save Agent
- **THEN** all three files survive a reload; if a later file fails to save, earlier successful saves remain and the other edits stay available for retry

#### Scenario: AI drafting unavailable
- **WHEN** no AI drafting adapter is configured and the user presses Generate config
- **THEN** the wizard explains that AI drafting needs a configured provider and the workspace files are unchanged

### Requirement: Skill library and equipping
Skills SHALL be folders holding a `SKILL.md` with `name` and `description` front matter, stored either in the shared library or in one agent's workspace. "Skill management" SHALL list every skill with search (name, folder, description, agent) and a location pill ("Public library" or the agent's name). A shared skill SHALL offer "Equip to agent", which lists agents other than `main` and its current owner. An agent skill SHALL offer "Move back to common". Moves SHALL be atomic and SHALL fail with distinct reasons: a skill of that folder name already at the target (conflict), an invalid workspace, a source that moved meanwhile, or an incomplete copy, which is rolled back. Creating or editing a skill SHALL take a name, an optional description prompt with "Generate skill" through the AI drafting adapter, and an 18-row Markdown editor; name and content are required. Deleting a skill SHALL ask for confirmation. Source: CENTER-052, CENTER-053, CENTER-060.

#### Scenario: Skill name has no ASCII prefix
- **WHEN** the user creates a skill named `3D tools` or `网页搜索`
- **THEN** its folder satisfies the folder contract, its original display name remains intact and existing folders receive distinct collision suffixes

#### Scenario: Equip a shared skill
- **WHEN** the user equips the shared skill `web-search` to agent `researcher`
- **THEN** the skill now lives in `researcher`'s workspace, the shared library no longer lists it, and the success message names both

#### Scenario: Equip conflict
- **WHEN** `researcher` already has a skill folder `web-search`
- **THEN** the move fails as a conflict and both copies are unchanged

Audit regression coverage: CENTER-053, CENTER-060.

#### Scenario: Edit and reload a skill
- **WHEN** the user searches skill metadata, edits its name, description and Markdown, and saves
- **THEN** the saved skill reloads with all edits; empty fields prevent submission, failed saves retain the editor, deletion requires confirmation and move conflicts show their reason

### Requirement: Model routing table
"AI Config" SHALL have "Default Config" and "Agents Config" sub-tabs. The default table SHALL show one row per model with role (None, Default, Fallback), provider (free text with suggestions from the bundled provider defaults), model (free text with that provider's common models), base URL, credentials, max tokens (an integer of at least 1, default 4096), and Save row / Delete. An "Add model" action SHALL add a row; DK fills rows only from its cloud, which is out of scope. The rules SHALL be DK's:
- At most one row is Default; if none is, the first configured row becomes Default.
- Demoting the Default promotes another configured row, or reverts when it is the only one.
- Editing a base URL propagates to every row with the same provider.
- Choosing a provider fills its default base URL when empty; choosing a known model fills its provider and maximum tokens.
- Provider and model are required; the URL must parse.
- The default scope keeps at least one row, and deletion asks for confirmation.

Credentials SHALL be write-only: rows show "Available" or "Missing" and never return a stored key. "Agents Config" SHALL list agents with a Custom or Inherited badge and a "Use default config" toggle. Turning it off copies the default rows into the agent's scope; turning it on returns to inheritance. Resolution SHALL return the Default row followed by Fallback rows in table order. Source: CENTER-065, CENTER-066, CENTER-067, CENTER-068, CENTER-070.

#### Scenario: Credential reference released
- **WHEN** rotation, deletion or inheritance removes a credential reference from its last model scope
- **THEN** the secret is retired only after a successful durable commit; a failed commit preserves live references and cleanup failures produce scrubbed diagnostics with pending retries

#### Scenario: Snapshot credential availability
- **WHEN** repeated views include several scopes sharing a credential reference
- **THEN** availability reads share a bounded boolean cache that expires within 30 seconds and invalidates on store and removal, without returning stored secrets

#### Scenario: Global inheritance or placeholder provider URL
- **WHEN** a command attempts inheritance on the default scope or saves a provider URL containing template placeholders
- **THEN** the service rejects it before model persistence or credential writes

#### Scenario: Second default
- **WHEN** row B is set to Default while row A is Default
- **THEN** A becomes None, B is Default, and both changes persist together

#### Scenario: Demote the only row
- **WHEN** the only configured row is changed from Default to None
- **THEN** the change reverts and the row stays Default

#### Scenario: Agent inherits
- **WHEN** agent `researcher` has "Use default config" on
- **THEN** resolving its models returns the default scope's rows, and editing the default table changes what it resolves

Audit regression coverage: CENTER-070.

#### Scenario: Suggested models and custom endpoints
- **WHEN** the user selects a catalog provider or known model and then supplies a custom endpoint
- **THEN** the table fills the provider, default endpoint and 4096 token suggestion while preserving an explicit custom endpoint and rejecting an unchanged Azure resource template

### Requirement: DK-Claw agent tiles
"Settings" SHALL show a DK-Claw panel section with four slots for keys `1,5`, `1,6`, `2,5` and `2,6` of the DK-Claw built-in profile, each set to a local agent. "Sync DK-Claw Panel" SHALL first check that the profile exists, that all four slots are `clawbot` keys and that every chosen agent exists (preflight, 5 %). It SHALL then write each key's `agentId` action and its title, set to the agent's display name, through a revision-checked profile save (40 %). Next it SHALL apply to the device (80 %), reporting "Synced to the DK-Claw panel." when the DK-Claw profile is active, or the deferred message otherwise, and finish at 100 %. A failure after the profile save SHALL restore the previous profile and the previous slot assignment, and a failed restore SHALL report its own message. Scene editions, which bundle vendor agent sets, are out of scope (decision 9); the slots take any local agent instead. Source: CENTER-103, CENTER-045, CENTER-046.

#### Scenario: Sync while another profile is active
- **WHEN** the user syncs while the strip shows Vivid
- **THEN** the DK-Claw profile's four keys hold the new agents and the deferred message is shown

#### Scenario: Device step fails
- **WHEN** applying to the device fails after the profile save
- **THEN** the DK-Claw profile is restored to its previous revision content and the previous assignment is kept

#### Scenario: Slot is not a clawbot key
- **WHEN** the user has replaced key `2,6` with a hotkey
- **THEN** sync stops at preflight with the invalid-slot error and nothing is written

### Requirement: Retired entry points reach local sessions

Saved ClawDashboard and ClawInstall entry points SHALL open the current local Sessions tab in the management workbench. Removed vendor installer and dashboard components SHALL remain retired. Evidence: CENTER-105.

#### Scenario: Open a retired saved entry point

- **WHEN** a management activation or saved URL names ClawDashboard or ClawInstall
- **THEN** the workbench selects Sessions and retains the management navigation and chrome

### Requirement: Runtime presentation and refresh
The Agents heading SHALL contain the runtime indicator, with Start, Stop and Restart always visible. All controls SHALL be disabled for an unavailable backend or an active transition; Start SHALL additionally be disabled when ready, and Stop/Restart unless ready. Sessions SHALL expose a refresh action, current local agent count, runtime status and detecting/offline/starting/stopping/error presentation. Local chat SHALL remain usable independently of runtime availability. Newer status snapshots SHALL win over delayed reads, and disposed listeners and replies SHALL not update a replacement bridge. A deprecated local-model diagnostic card SHALL appear only in development with explicit `VITE_ENABLE_CLAW_LOCAL_MODEL_TEST=true`, without inference controls. Sources: CENTER-012, CENTER-020, CENTER-022, CENTER-024, CENTER-025, CENTER-026, CENTER-028, CENTER-042.

#### Scenario: Runtime stops during Sessions
- **WHEN** a ready snapshot is followed by a stopped snapshot and an older read reply
- **THEN** Sessions shows offline, retains the newer count, and exposes disabled Stop/Restart with Start available only to an owned runtime

#### Scenario: Development diagnostic gate
- **WHEN** the explicit diagnostic flag is absent or the build is production
- **THEN** the deprecated card is absent and no legacy model request is dispatched

### Requirement: Local loadout administration
The roster SHALL stay visible alongside the Skills panel so a user can drag a mounted skill to an agent without switching tabs. The roster SHALL offer grid/list modes and four loading placeholders, with accessible direct skill transfer controls equivalent to skill drops. Skills SHALL have shared, selected-agent and all scope filters; moves between agents and shared storage SHALL use the existing atomic revision-checked transaction. Existing agent display names SHALL save independently of Markdown and reset SHALL require confirmation before replacing files with authored templates. Protected main SHALL reject rename/reset. AI Config SHALL show local loading/reload and save-result feedback, with retry after errors. Sources: CENTER-049, CENTER-050, CENTER-052, CENTER-055, CENTER-065.

#### Scenario: Transfer conflict
- **WHEN** a skill is transferred from agent A to B and B already owns its folder
- **THEN** both copies remain unchanged and the UI reports the conflict

#### Scenario: Cancel template reset
- **WHEN** the user cancels reset confirmation
- **THEN** no command is sent and unsaved Markdown remains intact

### Requirement: Meeting activation refresh
Management Center SHALL refresh meeting history on every Meetings activation, including selection of the already-active page (CENTER-009). Refresh SHALL preserve the mounted document and reject older snapshots.

#### Scenario: Reselect Meetings after history changes
- **WHEN** Meetings is activated again while already mounted
- **THEN** the real meeting bridge reads current history and renders the latest revision without replacing the page


#### Scenario: Drag a skill to a reachable roster target
- **WHEN** the user opens Skill management and drags a skill from its mounted list
- **THEN** the roster remains visible alongside the source and permits a drop on a non-main agent
- **AND** the move uses the existing revision-checked transaction with its distinct validation failures
