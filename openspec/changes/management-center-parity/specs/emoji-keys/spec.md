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

#### Scenario: Moved contact release and cancellation
- **WHEN** a held emoji contact moves beyond tap slop and releases normally
- **THEN** the original emoji copies exactly once on release, with no slide-off cancellation or swipe navigation, as required by SCREEN-057 and SCREEN-069
- **AND** if the mounted gesture resets after movement before lift, the pending emoji is discarded and the late lift never copies or sends keystrokes

### Requirement: App match settings
"App Match Settings" SHALL open a dialog with an enable toggle (default on), the three match rules, and the app list with a count. "Add App" SHALL pick from installed applications (deduplicated, searchable by identifier, path or name) or from a file: a macOS `.app` or a Windows `.exe`. Entries SHALL be deduplicated by identifier or path. Deleting an app SHALL need no confirmation. The settings SHALL persist with the global emoji mode. Source: CENTER-089.

#### Scenario: Duplicate app
- **WHEN** the user adds Slack twice, once from the list and once from its `.app` file
- **THEN** the list keeps one Slack entry and the second add says it already exists

Audit regression coverage: CENTER-089.

#### Scenario: Native picker cancellation and duplicate applications
- **WHEN** the same application is selected through installed-app and file pickers or a picker is canceled
- **THEN** only one identifier or path is saved, invalid app extensions are rejected, canceled selection changes nothing, and removal survives reload and changes foreground matching

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

### Requirement: Retained composer and legacy interactions
The active composer SHALL replace the legacy emoji pane while retaining package context-menu and double-click rename, a horizontally scrollable template selector, and an explicit legacy generation dialog with a 1000-byte UTF-8 prompt limit and warning at 900 bytes. The modern motion field SHALL retain its 180-character limit. Untouched default motion text SHALL follow the app locale; user edits and preset selections SHALL survive locale changes. Six localized presets SHALL remain available with required-image and nonblank-prompt validation. Source: CENTER-082, CENTER-091.

#### Scenario: Locale changes after editing
- **WHEN** the locale changes from English to German
- **THEN** the untouched default changes language, while an edited motion prompt remains unchanged, and all six preset buttons and field counters remain available

#### Scenario: Legacy prompt byte boundary
- **WHEN** a selected template has a 1000-byte prompt and another multibyte character is entered
- **THEN** generation is rejected without truncating the text, and cancelling the dialog leaves drafts and packages unchanged

### Requirement: Direct generated motion and caption suggestions
Production composition SHALL supply direct BYO-key Qwen image-to-video generation, using the saved Qwen credential, 480P, five seconds, prompt extension and no watermark. It SHALL create and poll the task, download the result without forwarding credentials to the asset origin, and decode it into a bounded animated GIF in a hidden muted worker. Downloads SHALL use HTTPS only and an exact allowlist of documented DashScope result origins. Connection-time DNS resolution SHALL reject non-public IPv4/IPv6 answers and pin the socket to validated addresses. Redirects SHALL be rejected, with a 32 MiB download limit and a 30-second download deadline. The full job SHALL abort after 300 seconds, explicit cancellation or shutdown. No vendor proxy SHALL be used. Failed or cancelled jobs SHALL preserve the static source, user caption, drafts and saved renderings. An explicit caption suggestion SHALL use the saved daily/default text model, temperature 0.1, at most 2048 tokens and no thinking, and SHALL validate at most ten Unicode characters in zh/en/ja/ko/de/fr/es/it. Suggestions SHALL be shown separately until accepted. Source: AI-134, AI-135, CENTER-083, CENTER-087.

#### Scenario: Provider creates and completes a task
- **WHEN** fake HTTP returns a task id, pending status, success and video bytes
- **THEN** the production adapter returns a validated GIF candidate while preserving the entered caption and original asset

#### Scenario: Provider failure or cancellation
- **WHEN** creation, polling, download or decoding fails, the deadline expires, or the user cancels
- **THEN** provider work stops and saved media is unchanged, and public errors expose no credentials or provider response body

#### Scenario: Eight caption languages
- **WHEN** caption suggestion is requested in each supported locale
- **THEN** the model instruction names that language and output beyond ten Unicode characters is rejected without replacing entered text

### Requirement: Draft editing and emoji metadata
Every draft and packaged emoji SHALL open the same caption editor with a name field of at most 30 characters and an explicit 0/1/2 key mode. Saving SHALL atomically update name, mode, caption and rendered hash while retaining the immutable original. Cancel and failure SHALL preserve all saved fields. Creating a package from the no-package dialog SHALL retain selected drafts for first-vacant-slot insertion. Source: CENTER-084, CENTER-087, MGMT-284.

#### Scenario: Edit and reload a draft
- **WHEN** a draft is renamed, captioned and assigned copy-only mode before any package exists
- **THEN** reload retains those edits and creating a package preserves the draft and its selection

### Requirement: Reference-aware reclamation
Collection SHALL retain every static asset, package/draft item and saved-profile emoji id/hash, including old renderings pinned by profiles. It SHALL delete unreferenced item metadata and asset files only after the last package, draft or profile reference disappears. Published clipboard GIF files SHALL remain outside normal asset collection because the system clipboard can still refer to them after library references disappear or the app restarts. Their collection SHALL be deferred until native clipboard ownership can be observed. Collection failure SHALL preserve committed library state and report a retryable notice. Source: CENTER-088.

#### Scenario: Last placed reference disappears
- **WHEN** a package is deleted while a saved profile pins one of its GIFs
- **THEN** the pinned item and hash survive, and a later collection after deleting that profile reclaims them

### Requirement: Linked package title updates
Renaming an emoji package SHALL rename its linked profile and publish a profile refresh only after the emoji library save succeeds. It SHALL roll back the profile update if the emoji library save fails. Duplicate profile names or invalid profile names SHALL reject before either store changes, preserving the catalog validation code `QUAKE.EMOJI.INVALID` and its actionable reason across the profile runtime boundary. Unexpected storage failures SHALL retain their private original cause under `QUAKE.EMOJI.LIBRARY_FAILED`. A deleted linked profile SHALL leave an independent package whose name can still be saved under the package limit without recreating, writing or refreshing a profile. Saving an emoji-folder tile title SHALL also rename its referenced package and publish the title-sync change only after both writes succeed. Source: MGMT-101.

#### Scenario: Linked rename save failure
- **WHEN** the linked profile rename succeeds but the emoji library save fails
- **THEN** the previous package and profile titles remain, and a conflicting existing profile name never changes either store

#### Scenario: Folder title drives package rename
- **WHEN** a saved emoji-folder title changes and its package exists
- **THEN** the package title follows and the title-sync change publishes after successful persistence; failure or an existing-name conflict leaves both saved titles unchanged

### Requirement: Emoji strip artwork
Emoji tiles SHALL use app-owned flat artwork sizing: a contained square at 80 percent of the shorter tile edge, centered with the saved label retained. The tile SHALL load the saved immutable hash and display a stable unavailable fallback for missing/deleted assets. It SHALL never activate on down or hold; release SHALL reach EmojiPress with the committed key mode, overridden by a non-null global default. Source: WIDGETS-106, MGMT-284.

#### Scenario: Missing pinned artwork
- **WHEN** a mounted tile cannot load its pinned hash
- **THEN** it shows unavailable artwork without requesting a replacement hash or changing its saved key

#### Scenario: Three release modes
- **WHEN** committed mode 0, 1 or 2 keys are pressed down, held and released with no global override
- **THEN** only release copies, mode 1 also pastes after 100 ms, and mode 2 also sends Enter after another 100 ms

#### Scenario: Untrusted provider media URL
- **WHEN** a provider returns an internal URL, an approved hostname resolving to private addresses, or a redirect to internal metadata
- **THEN** the adapter rejects it before contacting the internal destination or decoding any video

#### Scenario: Clipboard still references a removed emoji
- **WHEN** a copied emoji loses its last library/profile reference and the library reopens
- **THEN** its source assets are collected but the published clipboard GIF remains readable, including after reopening the file store

#### Scenario: Rename after generated profile deletion
- **WHEN** the user deletes a generated profile and then renames its package to a valid independent package name
- **THEN** the package save succeeds without a profile write or refresh, and a package save failure preserves the original library failure
