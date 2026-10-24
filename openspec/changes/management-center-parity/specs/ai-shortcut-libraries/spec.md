## ADDED Requirements

### Requirement: App-targeted shortcut generation
The Shortcuts page SHALL offer the five sample chips (Photoshop, Illustrator, Figma, Premiere Pro, Office). Each chip sets the target app and its recovered prompt; clicking it again clears them. The page SHALL also have an app selector, which DK lacks, offering Adobe Photoshop (default), every chip's app, DK's other targets (Microsoft Excel, Visual Studio Code) and "Other apps" with a custom name. The prompt SHALL be at most 180 characters; Enter or "Generate Shortcuts" submits. The request SHALL be `<app>：<prompt>` and SHALL go through the AI drafting adapter. An empty prompt SHALL show "Please describe the shortcuts to generate". With no adapter, the page SHALL say AI is unavailable. Source: CENTER-092, CENTER-093.

#### Scenario: Chip toggles
- **WHEN** the user clicks the Figma chip twice
- **THEN** the first click fills the app and prompt and the second clears them

### Requirement: Schema-decoded generation results
Model output SHALL be parsed by taking the text from its first `{` to its last `}`, running `JSON.parse`, and decoding the result with a Schema of `{ConfigTitle, ConfigData: [{title, config: {functionType, actions}}]}`. It SHALL never be evaluated. Only `hotkey` entries whose chord passes the key-function-library hotkey token rules SHALL become rows. Other function types, including command lines, application launches and multi-actions, SHALL be dropped and counted, and nothing from the output SHALL execute. Output that fails decoding SHALL report an invalid configuration and leave the table as it was. Source: CENTER-094; GAP-MAP "Don't copy" (`eval` on AI shortcut output).

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
"Add to shortcut pack" SHALL store the selected rows as a library named after the generated title, or "{name} Shortcut Pack" when there is none, with its app and creation date. Libraries SHALL be persisted by main in a versioned store, not renderer `localStorage`. The library aside SHALL list each library with its app icon, name, count and date. Rename SHALL require a non-empty name matching `^[一-龥a-zA-Z0-9\s\-_]+$`; delete SHALL confirm. Selecting a library SHALL load it into the table, where edits persist immediately. Source: CENTER-096.

#### Scenario: Rename with punctuation
- **WHEN** a library is renamed to `Cut/Paste`
- **THEN** the rename is rejected as an invalid name and the stored name is unchanged

### Requirement: Sync to the device
"Sync to main screen library" SHALL write the library's shortcuts to a custom profile named after the library: up to 16 hotkey keys per page, row-major. Syncing the same library again SHALL update that profile. Profile capacity and naming rules SHALL apply. A failure SHALL leave every profile unchanged. A library with no shortcuts SHALL report that it is empty and write nothing. Source: CENTER-096, CENTER-092.

#### Scenario: Seventeen shortcuts
- **WHEN** a library with 17 shortcuts is synced
- **THEN** the profile has two pages, with 16 keys on the first and 1 on the second
