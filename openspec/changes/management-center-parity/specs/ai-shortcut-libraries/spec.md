## ADDED Requirements

### Requirement: App-targeted shortcut generation
The Shortcuts page SHALL offer the five sample chips (Photoshop, Illustrator, Figma, Premiere Pro, Office). Each chip sets the target app and its recovered prompt; clicking it again clears them. The page SHALL also have an app selector, which DK lacks, offering Adobe Photoshop (default), every chip's app, DK's other targets (Microsoft Excel, Visual Studio Code) and "Other apps" with a custom name. The prompt SHALL be at most 180 characters; Enter or "Generate Shortcuts" submits. The request SHALL be `<app>：<prompt>` and SHALL go through the AI drafting adapter. An empty prompt SHALL show "Please describe the shortcuts to generate". With no adapter, the page SHALL say AI is unavailable. Source: CENTER-092, CENTER-093.

#### Scenario: Chip toggles
- **WHEN** the user clicks the Figma chip twice
- **THEN** the first click fills the app and prompt and the second clears them

#### Scenario: Saved production model
- **WHEN** Generate Shortcuts runs with a saved default-role model in the default scope
- **THEN** the adapter pins that model and resolves its native credential through the existing AI facade, without creating a chat session, enabling tools, saving a library or syncing a profile
- **AND** a missing model or unavailable credential returns the existing AI-unavailable failure before inference

#### Scenario: Generation bounds and shutdown
- **WHEN** a generation exceeds 300 seconds or 32 KiB of UTF-8 text, overlaps another generation, or the app shuts down
- **THEN** it fails without changing stored libraries or profiles, aborts its provider work and joins pending generation before inference disposal
- **AND** generation uses at most the saved output-token budget or 16384 tokens, whichever is lower

### Requirement: Schema-decoded generation results
Model output SHALL be parsed by taking the text from its first `{` to its last `}`, running `JSON.parse`, and decoding the result with a Schema of `{ConfigTitle, ConfigData: [{title, config: {functionType, actions}}]}`. It SHALL never be evaluated. Canonical registry-validated hotkey, hotkeySwitch, website, text, timer, panelBrightness and media action types SHALL become editable inert rows. Each SHALL preserve its validated actions and localized label for explicit library save and profile sync. Unsupported function types, command lines, model-supplied local application paths and multi-actions SHALL be dropped and counted. Nothing from the output SHALL execute during generation or save. These retained types implement part of AI-121; its remaining recovered types are still required and this subset does not retire them. Generation SHALL select the saved daily/default model and use temperature 0.1, top-p 0.2, thinking and optional search through the existing provider quirk adapter. Output that fails decoding SHALL report an invalid configuration and leave the table as it was. Source: CENTER-094; GAP-MAP "Don't copy" (`eval` on AI shortcut output).

#### Scenario: Output tries to run code
- **WHEN** the model returns `{"ConfigTitle":"x","ConfigData":[{"title":"t","config":{"functionType":"cmd","actions":[{"operationName":"cmdLine","operationValue":"rm -rf ~"}]}}]}`
- **THEN** no row is created, the result reports one dropped entry, and nothing executes

#### Scenario: Not JSON
- **WHEN** the model returns `({a: alert(1)})`
- **THEN** decoding fails with the invalid-configuration result and no code runs

### Requirement: Editable results table
Results SHALL appear in a table with columns: select (select all is indeterminate when partial), Name, App, Shortcut, Status and Reset. Shortcuts SHALL display as key chips: control → Ctrl, shift → Shift, alt → Alt, meta → Win, command → Cmd. They SHALL serialise back to lowercase `control+shift+k`, mapping Win back to `meta` and Cmd to `command`. Clicking a shortcut SHALL edit it inline; blur or Enter commits. Rows SHALL show Saved, Unsaved or Conflict, where Conflict means another row in the same list has the same normalised chord. Reset SHALL restore the row's original values. A fresh draft SHALL pre-select its first three rows. "Delete selected" SHALL confirm with the selected count. Unnamed rows SHALL be titled "Shortcut {index}"; unset chords SHALL read "Not set". Source: CENTER-095.

#### Scenario: Conflict appears and clears
- **WHEN** two rows are edited to `Ctrl + Shift + K` and one is then changed to `Ctrl + K`
- **THEN** both rows show Conflict after the first edit and neither does after the second

#### Scenario: Invalid chord
- **WHEN** a row is edited to `Ctrl + Banana`
- **THEN** the edit is rejected with the unsupported key named, and the row keeps its previous chord

### Requirement: Persisted shortcut libraries
"Add to shortcut pack" SHALL store the selected rows as a library named after the generated title, or the application label truncated by the canonical weighted profile-name limit when there is none; the full application identity SHALL remain in the library and its rows, with its app and creation date. Libraries SHALL be persisted by main in a versioned store, not renderer `localStorage`. The library aside SHALL list each library with its app icon, name, count and date. Rename SHALL require a non-empty name matching `^[一-龥a-zA-Z0-9\s\-_]+$`; delete SHALL confirm. Selecting a library SHALL load it into the table, where edits persist immediately. Source: CENTER-096.

#### Scenario: Rename with punctuation
- **WHEN** a library is renamed to `Cut/Paste`
- **THEN** the rename is rejected as an invalid name and the stored name is unchanged

### Requirement: Sync to the device
"Sync to main screen library" SHALL write the library's shortcuts to a custom profile named after the library: up to 16 hotkey keys per page, row-major. Syncing the same library again SHALL update that profile. Profile capacity and naming rules SHALL apply. A failure SHALL leave every profile unchanged. A library with no shortcuts SHALL report that it is empty and write nothing. Source: CENTER-096, CENTER-092.

#### Scenario: Default title syncs
- **WHEN** the user leaves the shortcut pack title empty, saves selected Adobe Photoshop shortcuts and syncs the library
- **THEN** the generated profile name fits the canonical weighted limit and the full application identity remains Adobe Photoshop

#### Scenario: Seventeen shortcuts
- **WHEN** a library with 17 shortcuts is synced
- **THEN** the profile has two pages, with 16 keys on the first and 1 on the second

### Requirement: Retained legacy library editing
The current Shortcuts page SHALL retain double-click and context-menu rename and an explicit legacy generation dialog with a 100-byte UTF-8 prompt limit. Cancel SHALL retain the current table and libraries. The results table SHALL resolve installed-app artwork through the existing app-library lookup and use a neutral fallback when lookup fails. Saved-library rename SHALL update the active table title only after persistence succeeds. Failed edits SHALL restore the prior table. Source: CENTER-095, CENTER-097, MGMT-108.

#### Scenario: Rename the displayed library
- **WHEN** a saved library is renamed from its context menu
- **THEN** reload and the active results title show the new name; a failed save keeps the old name in both places

#### Scenario: Multibyte legacy prompt
- **WHEN** a legacy prompt is 100 UTF-8 bytes and another character exceeds it
- **THEN** generation is enabled at 100 bytes and disabled above it without truncating the entered text, and Cancel sends no generation request

#### Scenario: Table selection and rollback
- **WHEN** a four-row draft arrives, select-all is toggled, two chords conflict, one is reset, and selected deletion is cancelled then accepted
- **THEN** the first three rows start selected, partial selection is indeterminate, reset restores originals and only accepted deletion changes rows; a failed saved-library edit rolls back

### Requirement: Retained ConfigDetail generation
The retained ConfigDetail types SHALL be validated against the canonical action registry, retain labels and icons, and remain inert through generation and persistence. Explicit profile sync SHALL preserve their action types. Model-generated application paths, shell commands, nested multi-actions and unavailable owning-domain actions SHALL be counted as unsupported instead of being executed. Source: AI-121.

#### Scenario: Mixed configuration draft
- **WHEN** output contains a hotkey, website, text, timer, switch, media key and shell command
- **THEN** supported entries retain their action types and labels through save and sync, the shell command is counted as dropped, and inference aborts at the 300-second deadline without changing libraries
