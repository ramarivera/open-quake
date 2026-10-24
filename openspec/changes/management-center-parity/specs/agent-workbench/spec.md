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

### Requirement: Local agent roster
"Agent management" SHALL list local agents with a count, search by display name and ID, the filter chips All and Local, and a four-row skeleton while loading. Each row SHALL show an emoji avatar, display name, ID, a badge (System for `main`, Local otherwise) and Edit and Delete actions. The `main` agent SHALL always exist, SHALL show a lock labelled as a protected agent, and SHALL offer neither edit nor delete. Deleting SHALL ask for confirmation naming the agent and remove its workspace. Empty states SHALL offer "Clear search" or "Create Agent". Selection SHALL persist and fall back to the first agent when the selected one is removed. Agent Market filters, share and install requests are out of scope (decision 9). Source: CENTER-049, CENTER-051, CENTER-054, CENTER-055, CENTER-059.

#### Scenario: Protect main
- **WHEN** a delete request names `main`
- **THEN** it is rejected as a protected agent and the catalog is unchanged

#### Scenario: Search with no match
- **WHEN** the user searches for `zzz`
- **THEN** the list shows the no-results state with Clear search

### Requirement: Two-step agent creation
"Create Agent" SHALL open a two-step wizard. Step 1 ("Basic info") SHALL take an agent ID, a display name and one of the 20 emoji presets (default 🤖). The ID SHALL be validated live against `^[a-z][a-z0-9-]*$`, at most 48 characters, not `main`, and unique; input SHALL be sanitised by dropping characters outside `[a-zA-Z0-9-]`, lowercasing and truncating to 48. "Next" SHALL create the agent and its workspace from open-quake-authored templates (`IDENTITY.md`, `SOUL.md`, `AGENTS.md`) and move to step 2 with no way back. Step 2 ("Role") SHALL offer a persona prompt with "Generate config", which drafts the workspace Markdown through the AI drafting adapter, and a tabbed editor for the workspace `*.md` files. "Save agent" SHALL save the active file and close. Editing an existing agent SHALL open step 2 directly. Source: CENTER-050, CENTER-057, CENTER-058.

#### Scenario: Reserved ID
- **WHEN** the user types `main` as the agent ID
- **THEN** step 1 shows the reserved-ID error and Next is disabled

#### Scenario: AI drafting unavailable
- **WHEN** no AI drafting adapter is configured and the user presses Generate config
- **THEN** the wizard explains that AI drafting needs a configured provider and the workspace files are unchanged

### Requirement: Skill library and equipping
Skills SHALL be folders holding a `SKILL.md` with `name` and `description` front matter, stored either in the shared library or in one agent's workspace. "Skill management" SHALL list every skill with search (name, folder, description, agent) and a location pill ("Public library" or the agent's name). A shared skill SHALL offer "Equip to agent", which lists agents other than `main` and its current owner. An agent skill SHALL offer "Move back to common". Moves SHALL be atomic and SHALL fail with distinct reasons: a skill of that folder name already at the target (conflict), an invalid workspace, a source that moved meanwhile, or an incomplete copy, which is rolled back. Creating or editing a skill SHALL take a name, an optional description prompt with "Generate skill" through the AI drafting adapter, and an 18-row Markdown editor; name and content are required. Deleting a skill SHALL ask for confirmation. Source: CENTER-052, CENTER-053, CENTER-060.

#### Scenario: Equip a shared skill
- **WHEN** the user equips the shared skill `web-search` to agent `researcher`
- **THEN** the skill now lives in `researcher`'s workspace, the shared library no longer lists it, and the success message names both

#### Scenario: Equip conflict
- **WHEN** `researcher` already has a skill folder `web-search`
- **THEN** the move fails as a conflict and both copies are unchanged

### Requirement: Model routing table
"AI Config" SHALL have "Default config" and "Agents config" sub-tabs. The default table SHALL show one row per model with role (None, Default, Fallback), provider (free text with suggestions from the bundled provider defaults), model (free text with that provider's common models), base URL, credentials, max tokens (an integer of at least 1, default 4096), and Save row / Delete. An "Add model" action SHALL add a row; DK fills rows only from its cloud, which is out of scope. The rules SHALL be DK's:
- At most one row is Default; if none is, the first configured row becomes Default.
- Demoting the Default promotes another configured row, or reverts when it is the only one.
- Editing a base URL propagates to every row with the same provider.
- Choosing a provider fills its default base URL when empty; choosing a known model fills its provider and maximum tokens.
- Provider and model are required; the URL must parse.
- The default scope keeps at least one row, and deletion asks for confirmation.

Credentials SHALL be write-only: rows show "Available" or "Missing" and never return a stored key. "Agents config" SHALL list agents with a Custom or Inherited badge and a "Use default config" toggle. Turning it off copies the default rows into the agent's scope; turning it on returns to inheritance. Resolution SHALL return the Default row followed by Fallback rows in table order. Source: CENTER-065, CENTER-066, CENTER-067, CENTER-068, CENTER-070.

#### Scenario: Second default
- **WHEN** row B is set to Default while row A is Default
- **THEN** A becomes None, B is Default, and both changes persist together

#### Scenario: Demote the only row
- **WHEN** the only configured row is changed from Default to None
- **THEN** the change reverts and the row stays Default

#### Scenario: Agent inherits
- **WHEN** agent `researcher` has "Use default config" on
- **THEN** resolving its models returns the default scope's rows, and editing the default table changes what it resolves

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
