## ADDED Requirements

### Requirement: Emoji packages
The Emoji page SHALL manage emoji packages in a right-hand Package Library: create ("New Package", which enters inline rename), rename (Enter commits, Escape cancels, blur commits), and delete with a confirmation naming the package. Names SHALL be trimmed, non-empty and at most 20 weighted units, where U+4E00–U+9FA5 count two and every other UTF-16 unit counts one. A blank name SHALL fall back to "Unnamed Pack". A package SHALL hold at most 16 emoji, one full strip page, instead of DK's inconsistent "/24" studio cap and 15-slot legacy cap. The current package preview SHALL show "n / 16", its thumbnails, and dashed empty slots. All changes SHALL persist atomically, and a failed write SHALL leave the previous library intact. Source: CENTER-085, CENTER-086.

#### Scenario: Name too long
- **WHEN** the user renames a package to eleven CJK characters
- **THEN** the rename is rejected as longer than 20 units and the stored name is unchanged

#### Scenario: Full package
- **WHEN** a package already holds 16 emoji and the user adds another draft to it
- **THEN** the add fails as a full package and no draft is lost

### Requirement: Static assets and motion sources
Step 1 ("Add Static Asset") SHALL import PNG or JPEG images through the main-process picker, with multiple selection, signature checks, a native decode, an 8 MiB limit and a 64-megapixel limit. Duplicates SHALL be detected by content hash and skipped with a notice naming them, rather than by file name. Step 2 ("Generate Motion Emoji") SHALL offer the name (≤ 30), caption (≤ 50 weighted units) and motion description (≤ 180) fields with counters, the six quick-action chips, and the default motion text. Motion generation SHALL run only through an explicit generation adapter. When none is configured, Generate SHALL say generation is unavailable and SHALL contact no vendor proxy. The page SHALL also accept an animated GIF (≤ 8 MiB, ≤ 1024×1024, ≤ 300 frames, decoded before acceptance) as a motion result, and a still image as a one-frame emoji. Source: CENTER-081, CENTER-082, CENTER-083.

#### Scenario: Not an image
- **WHEN** the user picks a text file renamed to `cat.png`
- **THEN** the import is rejected as an unsupported image and no asset is stored

#### Scenario: Generation unavailable
- **WHEN** no generation adapter is configured and the user presses Generate with a selected asset and a description
- **THEN** the page reports that motion generation is unavailable and no network request is made

### Requirement: Results stash and composing a pack
Imported or generated results SHALL land at the head of a results stash, pre-selected, as 112×112 animated previews. Clicking a tile SHALL toggle its selection. "Add to Pack" SHALL be disabled with nothing selected; it SHALL add each selected draft to the first empty slot of the chosen package, in order. With no package it SHALL offer "Create Package". A draft SHALL NOT become a key until it is added to a package. Source: CENTER-084.

#### Scenario: No package yet
- **WHEN** the user presses Add to Pack before creating any package
- **THEN** a dialog titled "Create a package first" offers Cancel and Create Package, and the drafts stay in the stash

### Requirement: Caption rendering without ffmpeg
Each emoji SHALL keep its original motion source and a rendered GIF. The caption SHALL be burned into every frame of the rendered GIF, re-rendered from the original each time so edits never compound. Caption options SHALL be: text up to 50 weighted units; font size 12–100 px, default 48; colour as `0xRRGGBBAA`, default `0xffffffff`, with 16 swatches and a hex field; position top, middle or bottom, default bottom. The renderer SHALL use an in-repo GIF decoder and encoder with per-frame palette quantisation. It SHALL preserve frame delays, loop count and canvas size, and main SHALL decode the result before storing it. Source: CENTER-087, CENTER-018.

#### Scenario: Edit a caption twice
- **WHEN** the user changes the caption from "Hi" to "Bye"
- **THEN** the stored GIF shows only "Bye", rendered from the original frames

#### Scenario: Corrupt render
- **WHEN** a renderer sends bytes that fail to decode as a GIF
- **THEN** main rejects the update and the previous rendered GIF stays in place

### Requirement: Emoji key press behaviour
An emoji key SHALL be `{type: "emoji", size: [1,1], supportKnob: false}` with actions `emojiAction` (0 copy, 1 copy and paste, 2 copy, paste and Enter) and `emojiConfig` (package ID, emoji ID and the rendered GIF's content hash). It SHALL act on release; press-down and hold SHALL do nothing. Main SHALL resolve the key from the committed active profile, never from renderer-supplied paths. When app matching is on and the app list is non-empty, the foreground application SHALL match a listed path or identifier, or the press SHALL do nothing. Main SHALL then copy the rendered GIF file to the clipboard: on macOS through `osascript` with the path as an argument, on Windows through PowerShell `Set-Clipboard -LiteralPath` with the path in the environment, with no shell interpolation. Linux SHALL report unsupported. After 100 ms the mode SHALL apply: the global mode when set, otherwise the key's. Mode 1 sends Command+V on macOS and Control+V elsewhere; mode 2 also sends Enter 100 ms later. Keystrokes SHALL go through the device keyboard route. A missing GIF, unsupported platform, clipboard failure or unavailable keyboard SHALL raise the invalid alert on that key and send no keystroke. The default global mode SHALL be 1. Source: CENTER-090, CENTER-018, MGMT-284.

#### Scenario: Copy, paste and send
- **WHEN** a mode-2 emoji key is released on macOS with app matching off
- **THEN** the GIF file is on the clipboard, Command+V follows 100 ms later, and Enter follows 100 ms after that

#### Scenario: Foreground app not listed
- **WHEN** app matching is on, the list contains only Slack, and Finder is in front
- **THEN** the press does nothing: the clipboard is untouched and no keystroke is sent

#### Scenario: Missing GIF
- **WHEN** the key's GIF asset is missing from the emoji store
- **THEN** the key shows the invalid alert and no keystroke is sent

### Requirement: App match settings
"App Match Settings" SHALL open a dialog with an enable toggle (default on), the three match rules, and the app list with a count. "Add App" SHALL pick from installed applications (deduplicated, searchable by identifier, path or name) or from a file: a macOS `.app` or a Windows `.exe`. Entries SHALL be deduplicated by identifier or path. Deleting an app SHALL need no confirmation. The settings SHALL persist with the global emoji mode. Source: CENTER-089.

#### Scenario: Duplicate app
- **WHEN** the user adds Slack twice, once from the list and once from its `.app` file
- **THEN** the list keeps one Slack entry and the second add says it already exists

### Requirement: Add to main screen and export
"Add to Main Settings Screen" SHALL write the current package to a custom profile named after the package: one page of emoji keys in row-major order across the 2×8 grid. It SHALL then select that profile so the strip shows it. Adding the same package again SHALL update that profile rather than create another. The profile manager's capacity and naming rules SHALL apply. A failure SHALL leave every profile unchanged and report why. "Export Emoji Pack" SHALL copy the package's rendered GIFs, named after each emoji, into a folder the user picks; DK only shows a toast. Source: CENTER-085, CENTER-086, CENTER-088.

#### Scenario: Re-add after editing
- **WHEN** the user adds a package, edits one caption, and adds it again
- **THEN** the same profile now references the new rendering and the profile count is unchanged

#### Scenario: Profile limit reached
- **WHEN** 30 profiles are visible and the package has never been added
- **THEN** the add fails with the profile limit message and nothing is written

### Requirement: Deleting emoji
Deleting an emoji SHALL clear its slot. Its stored assets SHALL be removed only once no saved profile key references them; a referenced asset SHALL be kept until that reference is gone. Source: CENTER-088; artwork-library "Resource deletion and ownership".

#### Scenario: Delete a placed emoji
- **WHEN** an emoji on the active profile is deleted from its package
- **THEN** its slot is empty in the package, and its GIF stays on disk and keeps working from that key until no saved profile references it
