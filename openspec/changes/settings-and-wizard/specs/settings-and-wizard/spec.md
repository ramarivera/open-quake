# Spec Delta

## Purpose

The desktop needs a usable local first-run path and one validated settings model. The recovered app mixes QUAKE, ARIS-68 and account/runtime setup, so parity boundaries must be explicit.

## ADDED Requirements

### Requirement: Resumable local first run

The system SHALL present first-run setup until a local completion record is durably saved. Closing an incomplete wizard SHALL leave it eligible to resume; replaying a completed wizard SHALL require an explicit action and preserve existing configuration.

#### Scenario: First launch

- **WHEN** the application has no completion record
- **THEN** the wizard opens and displays Welcome, locale/region, display, profiles and completion with runtime steps included only when supported

#### Scenario: Close before completion

- **WHEN** the user closes setup after locale selection
- **THEN** the selected locale is retained and the next launch resumes incomplete setup without a completion marker

#### Scenario: Completed replay

- **WHEN** a user reopens setup after completion
- **THEN** existing profiles/settings are loaded and no duplicate profiles are created

Audit regression coverage: MGMT-026.

#### Scenario: Late startup read preserves explicit preview
- **WHEN** the user explicitly opens Screen before an unfinished setup read completes
- **THEN** the explicit preview remains selected without requiring a connected device

### Requirement: Wizard prerequisite handling

The wizard SHALL validate locale, display selection and at least one usable profile before completion, support an explicit desktop-preview choice when QUAKE is absent, and permit supported optional runtime steps to be skipped without blocking local use.

#### Scenario: No device

- **WHEN** no QUAKE is connected during the display step
- **THEN** the user can select desktop preview and continue with a visible hardware-unverified status

#### Scenario: Runtime skipped

- **WHEN** a supported runtime step is skipped
- **THEN** setup continues and completion records that runtime as skipped without installing it

#### Scenario: Completion write fails

- **WHEN** the settings repository cannot save the completion record
- **THEN** the wizard reports persistence failure and stays incomplete

### Requirement: Locale and region choices

The system SHALL bundle the eight UI locales zh, en, es, fr, ko, de, it and ja, normalize trimmed primary subtags case-insensitively across hyphens and underscores, seed the initial locale once from OS metadata, and fall back to English for unsupported values. Locale changes SHALL update mounted management, profile manager, panel, voice, picker, clock and native prompt/background-menu consumers without restart and SHALL survive restart. The macOS Dock menu SHALL provide the localized native background-menu equivalent with working Resume, Settings and Exit actions. Settings language labels SHALL use fixed endonyms, with 中文 in settings and 简体中文 in setup. Existing English/German product namespaces SHALL retain their conventions; recovered strings SHALL be copied verbatim, with English fallback for app-specific untranslated copy. Evidence: CENTER-006, MGMT-327, SCREEN-011, SCREEN-099, SETTINGS-007, SETTINGS-063, SETTINGS-064, SETTINGS-065.

#### Scenario: Unsupported OS locale

- **WHEN** first launch reports an untranslated OS locale
- **THEN** English is selected as a fallback and the user can choose another available translation

#### Scenario: User choice survives reseed

- **WHEN** the user selects German and a provider, then region metadata changes
- **THEN** the chosen locale/provider remain and no network geo lookup is required

#### Scenario: Change language

- **WHEN** the user saves an available language
- **THEN** management and panel labels update and restart retains the selection

Audit regression coverage: MGMT-003.

#### Scenario: Bootstrap and cross-window language race
- **WHEN** a locale event arrives while the saved locale read is pending
- **THEN** all subscribed windows show the newer revision, and a late older read cannot revert their language or mounted drafts

#### Scenario: Language changes during city verification
- **WHEN** the user changes app language while an edited weather city is debouncing or its verification is in flight
- **THEN** the mounted draft and pending verification survive, the result is saved, and a lookup started after the language change uses the current locale

#### Scenario: Non-English profile thumbnail
- **WHEN** a profile capture requests a supported non-English locale
- **THEN** its validated capture locale reaches the passive clock before the preview becomes ready, including weekday, date and theme text

### Requirement: General preferences

The system SHALL persist launch-at-login, start-hidden and window-size preferences as separate validated values, report unsupported/denied OS changes, and keep a reachable management entry when starting hidden.

#### Scenario: OS rejects login item

- **WHEN** the user enables launch-at-login but the OS adapter refuses
- **THEN** the control reports failure and does not claim the OS setting was enabled

#### Scenario: Stored window off-screen

- **WHEN** a saved window rectangle no longer intersects a connected display
- **THEN** the management window is clamped to a visible display

#### Scenario: Hidden startup

- **WHEN** start-hidden is enabled and the app starts
- **THEN** the management entry remains reachable through its available tray/menu or equivalent application action

### Requirement: Provider configuration

Settings SHALL store provider ID, endpoint, model, temperature and topP with a protected secret reference; validate temperature within 0–2 and topP within 0–1 plus advertised provider constraints; and preserve credentials for other providers when switching.

#### Scenario: Invalid sampling

- **WHEN** the user saves temperature 2.1 or topP below zero
- **THEN** the save identifies the invalid field and preserves the last valid provider configuration

#### Scenario: Provider sampling policy

- **WHEN** a saved GPT-4o or GPT-4.1 text model has valid explicit sampling overrides
- **THEN** direct inference forwards them through the real RPC and SDK path
- **WHEN** a model requires defaults or supplied Kimi values conflict with its mandatory values
- **THEN** the editor explains the restriction and blocks saving, and backend validation preserves stored configuration and credentials
- **AND** clearing both overrides allows saving provider defaults

#### Scenario: Provider switch

- **WHEN** a user switches from configured provider A to B and back
- **THEN** A's model/secret reference remain available and no secret value appears in ordinary settings responses

#### Scenario: Unavailable provider

- **WHEN** a saved provider adapter is absent
- **THEN** settings show that configuration as unavailable and require explicit selection rather than silently sending to another provider

### Requirement: Selected-device settings

Device settings SHALL show selected device identity, firmware information and supported controls, apply brightness/backlight/LED changes only through advertised capabilities, and reject invalid values before hardware writes. Read-only, disconnected and pending-confirmation states SHALL be distinct.

#### Scenario: Target changes during save

- **WHEN** device A disconnects and device B becomes selected before A's brightness save completes
- **THEN** the pending write is not redirected to B and A's result is shown as interrupted or unverified

#### Scenario: Unsupported LED mode

- **WHEN** the selected device does not advertise a requested lighting mode
- **THEN** the control reports unsupported and no guessed command is sent

#### Scenario: Write succeeds without readback

- **WHEN** a supported brightness write is accepted but its readback is unavailable
- **THEN** the UI reports requested/unverified rather than confirmed hardware state

### Requirement: Device-specific calibration gate

The system SHALL expose a calibration write only for a selected device with a verified device-specific calibration capability; generic calibration IPC names SHALL NOT authorize a QUAKE calibration operation.

#### Scenario: QUAKE without verified calibration

- **WHEN** QUAKE is selected and no QUAKE-specific calibration contract exists
- **THEN** calibration is unavailable with an explanation and no ARIS-68 command is sent

#### Scenario: Unsupported device family

- **WHEN** an ARIS-68 device is discovered under the proposed QUAKE-only scope
- **THEN** it is shown as unsupported and QUAKE configuration is not applied to it

### Requirement: Settings delegation and local guide

Settings SHALL route wallpaper interval/fill/play controls, monitoring, artwork selection and firmware actions to their owning capabilities and SHALL provide a reopenable local QUAKE guide. Unavailable capabilities SHALL have explicit unavailable states.

#### Scenario: Colorful-screen settings

- **WHEN** the user saves wallpaper fill mode and interval for the selected serial number
- **THEN** the wallpaper capability validates and persists that device's settings without changing another device

#### Scenario: Offline guide

- **WHEN** the user opens the QUAKE guide without network access
- **THEN** bundled usage guidance is readable and can be reopened after closing

#### Scenario: Firmware entry unavailable

- **WHEN** firmware support has not passed its verification gate
- **THEN** settings show an unavailable update action and start no DFU operation

Audit regression coverage: MGMT-020.

#### Scenario: Visible settings navigation preserves the device
- **WHEN** the user opens Settings from management
- **THEN** general and maintenance settings render without changing the selected device

### Requirement: Compatible authenticated backups

The system SHALL export and import WinZip AES-256 encrypted ZIP backups compatible with DK-Suite's account-derived format, preserving export_index.json and account_config.json. Import SHALL authenticate before mutation, reject traversal/symlinks/duplicates/oversized archives, skip built-in and deleted resources, deduplicate configurations, renumber new profiles and remap resource IDs and original-platform paths. Only app-owned data and explicitly referenced clock media SHALL be exported; credentials SHALL be excluded. Evidence: SETTINGS-014.

#### Scenario: Legacy import

- **WHEN** a valid independently generated DK-Suite archive is selected
- **THEN** its resources and profiles are merged once with imported/skipped counts and cross-platform paths rewritten

#### Scenario: Invalid archive

- **WHEN** an archive has failed authentication, invalid index or unsafe paths
- **THEN** existing data remains intact and no extracted path escapes staging

#### Scenario: Merge into edited imports

- **WHEN** a native profile was edited after import or another backup reuses a legacy asset path with different bytes
- **THEN** imported profiles receive collision-free IDs and content-based asset destinations while retained profiles and their assets remain intact

#### Scenario: Complete multi-page identity

- **WHEN** an imported legacy profile contains a retained page, repeated identical pages or a later changed page
- **THEN** import deduplicates only complete profiles, preserves every page in order, and imports changed complete profiles without truncation

#### Scenario: Referenced content changes

- **WHEN** another archive retains resource IDs, raw configuration and archive-relative paths but changes referenced file, folder or registered image bytes
- **THEN** the changed resolved profile, including legacy-only configuration fields, is imported with distinct content-addressed assets, retained assets remain intact, and unchanged reimports deduplicate

#### Scenario: Appearance and confirmed replacement

- **WHEN** a backup is exported to an existing destination confirmed in the native save dialog
- **THEN** export reads the validated actual appearance localStorage record including custom theme and motion, replaces the destination atomically, and restore delivers that record to the real appearance consumer with a persistence acknowledgement

#### Scenario: Restore fails after shutdown begins

- **WHEN** restore cannot complete after stopping app writers
- **THEN** main reports a scrubbed failure and exits even if management windows are gone; merge validation runs before shutdown and repeats against stopped data before commit

#### Scenario: Portable clock media

- **WHEN** the clock references selected external images or videos and its backup is restored into a different installation after the originals are removed
- **THEN** only those referenced files are archived within bounded file/archive limits, restored clock consumers use managed copies, and missing, unreadable or symlink references fail export without claiming a complete backup

#### Scenario: Export exceeds a cumulative budget

- **WHEN** retained nested import trees or explicitly selected external clock media would exceed the shared raw read byte/count budget
- **THEN** export fails through BackupFailed before reading the first disallowed file or subsequent files; normalized/replaced/deduplicated entries and generated projection/index additions also remain within shared retained archive limits, and boundary-sized exports succeed

#### Scenario: Native app-linked profile restore

- **WHEN** a same-platform app-linked native profile is exported, reset and imported, including a profile deduplicated against an existing profile or assigned a collision-free ID
- **THEN** the app link targets the actual final profile and automatic switching can select it; existing destination links and manager settings win conflicts, unrelated transient source manager state is not imported, dangling or incompatible-platform links are skipped, and repeated import is idempotent

### Requirement: Clear data with optional bounded backup

The system SHALL offer Cancel, Backup and Continue, Continue Without Backup in a 520px confirmation. Backup SHALL stop waiting after 60000ms; failure SHALL require a second confirmation. Writers SHALL stop before clearing only app-owned data and exiting. Evidence: SETTINGS-016.

#### Scenario: Backup timeout declined

- **WHEN** backup times out and the second confirmation is declined
- **THEN** no data is deleted and the app stays running

#### Scenario: Confirmed reset

- **WHEN** backup succeeds or clearing without backup is explicitly confirmed
- **THEN** writers stop, app-owned data is cleared and the application exits

#### Scenario: Reset fails after shutdown begins

- **WHEN** stopping writers or staging, renaming or deleting reset data fails after reset is confirmed
- **THEN** main reports only the catalog failure code and fixed recovery guidance and guarantees process exit even if reporting fails, without clearing data after writer shutdown failure

#### Scenario: Initialization failure during quit

- **WHEN** maintenance runtime initialization fails after session-load recovery
- **THEN** the failure stays visible, runtime disposal and scoped resource release still complete, and the awaited application quit chain stops writers and exits

### Requirement: Live macOS permission dashboard

The system SHALL display Accessibility, Input Monitoring, Microphone, Screen Recording and System Audio Recording on macOS, refresh on mount/focus/every 2000ms, and expose their fixed System Settings privacy deep links. A missing API or failed probe SHALL be unknown rather than granted. Status reads SHALL not request permission. Evidence: SETTINGS-015.

#### Scenario: Permission changes externally

- **WHEN** a permission is changed in System Settings
- **THEN** focus or the next poll updates its live status

#### Scenario: Unavailable system-audio probe

- **WHEN** the private preflight API is unavailable
- **THEN** System Audio Recording shows unknown and its settings action remains usable

### Requirement: App-owned self-update scheduling

The system SHALL check at 5000ms after launch and every 12 hours, support manual Check Update, and download background updates before offering installation. Checks/downloads SHALL be single-flight and failures recoverable. Production SHALL use a disabled open-quake feed until an owned release manifest and artifact trust policy exist; tests SHALL inject a fake feed and installer. No vendor feed SHALL be called. Evidence: SETTINGS-049, SETTINGS-050.

#### Scenario: Background update

- **WHEN** the fake feed reports a newer matching-platform release
- **THEN** the main-owned state progresses checking, downloading, ready, and installation requires an explicit user action

#### Scenario: Quit or duplicate check

- **WHEN** another check arrives during download or the app quits
- **THEN** no duplicate transfer starts and disposal interrupts scheduled work


### Requirement: Maintenance safety at filesystem and IPC boundaries

Backup completion SHALL sync the staged file before rename and the parent directory on POSIX before reporting success. Session-load corruption or read failure SHALL preserve evidence, emit scrubbed diagnostics and permit nonflashing settings/export/reset access. Remaining initialization rejection SHALL return a catalog MaintenanceReply failure and retain awaited disposal. Security-scoped access SHALL release exactly once on hint/write failure, terminal completion or disposal. Smoke runs SHALL explicitly opt into a portable owned scratch root, with containment and real-userData rejection.

#### Scenario: Backup sync fails

- **WHEN** staging sync or directory sync fails during backup-before-reset
- **THEN** backup reports failure, reset requires the existing fresh failure confirmation, and no automatic data clear occurs

#### Scenario: Unreadable or malformed session

- **WHEN** persisted firmware session data cannot be parsed or read
- **THEN** settings, permissions and export remain accessible, reset retains its confirmations, no automatic firmware operation starts, and original evidence is preserved

#### Scenario: Bookmark setup fails

- **WHEN** scoped bookmark access succeeds but persisting its hint or starting the firmware write fails
- **THEN** the access is released once immediately and subsequent requests or disposal do not release it again

#### Scenario: Reset backup choice

- **WHEN** the user chooses backup-and-continue or continue-without-backup
- **THEN** the native final confirmation states that exact choice and cancellation starts neither backup nor clear

#### Scenario: Portable smoke scratch

- **WHEN** a mock smoke supplies an absolute explicit scratch root with contained temporary and artifact paths
- **THEN** it can run without author-specific directory names, while absent opt-in, escaping paths and real-userData overlap are rejected


### Requirement: Local advisory region defaults and legacy migration

Region suggestions SHALL use only the explicitly selected ISO country, independently of UI locale, credentials and vendor catalogs. China SHALL suggest DeepSeek with deepseek-v4-flash and Qwen speech with qwen-audio-3.1-asr-flash-streaming, qwen-audio-3.1-tts-flash and qwen3.5-livetranslate-flash-realtime. Other valid countries SHALL suggest OpenAI with gpt-5.1, gpt-4o-transcribe and gpt-4o-mini-tts. Unknown region SHALL yield no suggestion. Suggestions SHALL remain visible advisory values, never create credentials, choose a configured model profile, enable speech or perform geographic lookup. A versioned local legacy-settings migration SHALL replace only a China QWen default explicitly marked seeded and not user-chosen with the DeepSeek suggestion. Explicit and unmarked existing choices SHALL survive migration, region changes and restart. Evidence: AI-015, SETTINGS-065, SETTINGS-098, SETTINGS-099.

#### Scenario: Region changes with configured providers

- **WHEN** China and international region choices are saved and settings are reloaded
- **THEN** the real wizard owner returns the corresponding chat and independent speech model suggestions, while existing provider and speech settings stay byte-equivalent

#### Scenario: Legacy default and failed region lookup

- **WHEN** a seeded non-user-chosen China QWen legacy default is loaded
- **THEN** it migrates once to DeepSeek; manual QWen, other providers, unknown origin and unknown region remain unchanged without network requests

### Requirement: Independent translation language catalog

Translation controls SHALL offer the localized eighteen-code catalog en, zh, ru, fr, de, pt, es, it, id, ko, ja, vi, th, ar, yue, hi, el and tr, independently of UI locale and adapter availability. Selecting UI language SHALL NOT replace saved speech or translation target languages. Evidence: SETTINGS-067.

#### Scenario: Translation options in every UI locale

- **WHEN** translation controls render in each supported UI locale
- **THEN** all eighteen codes have the recovered localized labels, and a UI language change keeps the selected target language

### Requirement: Selective versioned bootstrap migration

The desktop settings owner SHALL seed start-hidden false and the missing legacy global wake accelerator CommandOrControl+Shift+D, preserve explicit values and durable unknown fields, and remove only legacy currentSelectedDevice, mainscreen.deviceName, plugin/via/web port fields and system.upgradeInfo during the versioned local legacy import. Migration SHALL be idempotent, persist atomically and leave invalid/future-version documents untouched. It SHALL NOT register a native hotkey merely by migrating a preference. Evidence: SETTINGS-111.

#### Scenario: Restart after legacy bootstrap

- **WHEN** a valid legacy-containing settings document is read twice across restarts
- **THEN** transient keys disappear once, missing defaults appear, explicit wake/startup and provider/speech preferences survive, and the second read performs no migration write

### Requirement: Localized strip titles and enrichment copy

The six AI role titles SHALL resolve explicit user edits first, then multilingual i18n keys, then legacy role labels, then raw text, across all eight locales without persisting translated titles. The profile picker SHALL localize title, current prefix/badge and knob/page hints from the saved locale. Clock settings and weather/media cards SHALL localize visible settings, seconds, cached, loading/error, button and interpolation copy from the same saved locale; weather locale routing and spoken/translation language selections SHALL remain independent. Evidence: AI-149, SCREEN-099, WIDGETS-063.

#### Scenario: Live relocalization preserves data

- **WHEN** the app language changes with the strip, voice, picker, profile manager and clock mounted
- **THEN** their labels update for all eight locales, an unsupported value renders English, drafts and user-edited titles survive, and no translated title is written to a profile

### Requirement: Setup diagnostic and installation recovery

The app SHALL provide the setup lane recovery paths for MGMT-029, MGMT-030,
MGMT-037, MGMT-038, MGMT-039, SETTINGS-068, SETTINGS-069 and SETTINGS-070.
Connection detection SHALL use the lifecycle owner's bounded discovery and
single-flight redetect instead of adding renderer delays. During a request,
Re-detect SHALL be disabled and both channels SHALL announce Checking.
User-triggered notices SHALL last 2600 ms; persistent channel results SHALL
remain after the notice expires. Mounting and background snapshots SHALL be
silent. A failed request SHALL leave the last results readable and retryable.

#### Scenario: Retry and recover without hardware
- **WHEN** a user clicks Re-detect and IPC succeeds, fails or rejects
- **THEN** only one request runs, Checking appears until settlement, and the
  outcome notice expires after 2600 ms without deleting the diagnostic result

#### Scenario: Installation help from entrance, setup and connection
- **WHEN** the user opens Installation Guide from setup, the entrance or Connection
- **THEN** a bundled modal works even if settings services are unavailable,
  with three illustrated steps, independent English/Chinese selection, left/right
  keyboard navigation and reset to English/step one after close
- **AND** it describes left USB-C and Mini HDMI ports, latch engagement and box
  contents, desktop USB-A plus HDMI, and a laptop hub on a DP-capable USB-C port
- **AND** a DisplayPort source requires a DP-source-to-HDMI-display adapter,
  correcting the recovered guide's reversed HDMI-to-DP advice

#### Scenario: Project support
- **WHEN** the user follows Contact Support
- **THEN** the app opens only the fixed project GitHub issues URL through the
  native external-link handler, never a vendor account or arbitrary URL

### Requirement: Setup first-run ownership and welcome

MAIN-055, MAIN-056, MAIN-125, SETTINGS-011, SETTINGS-051, SETTINGS-053,
SETTINGS-054 and SETTINGS-055 SHALL retain resumable offline setup and the
approved desktop-preview path. Explicit navigation SHALL win over a late
startup read. Automatic setup SHALL open at most once per renderer run;
completion SHALL persist through the existing wizard owner, while leaving
setup SHALL not complete it. Development controls SHALL expose a debug override
and explicit reset of first-run state, hidden in packaged production builds.
All eight supported language choices SHALL apply immediately, persist and
refresh localized profile titles. The welcome step SHALL hide progress and
use Get Started. Welcome SHALL include project-owned privacy and
software-notice reading, never imply agreement to vendor terms. For SETTINGS-054,
Ramiro approved the MIT project license with the owner's copyright and local
privacy/software notices on 2026-10-26. Welcome SHALL bundle those documents and
state that selecting Get Started agrees to MIT and acknowledges the notices.
Only that explicit action SHALL advance saved progress. It SHALL not request
permissions or accept vendor terms. Reduced motion
SHALL suppress welcome motion. Lifecycle orientation snapshots SHALL be consumed
for the selected serial, and setup ownership SHALL suppress automatic display
prompts until it closes, reloads or its owner is destroyed.

#### Scenario: First run and explicit navigation
- **WHEN** the startup wizard read returns unfinished state with no hardware
- **THEN** setup opens once unless the user already explicitly chose a page
- **AND** completed state stays closed, leaving preserves progress and replay
  returns to welcome without changing existing device or profile preferences

#### Scenario: Welcome and local project information
- **WHEN** Welcome renders
- **THEN** Get Started and the complete MIT license plus local privacy/software reading
  are available offline, progress is hidden and leaving does not complete setup
- **AND** reading or closing a notice doesn't save progress; selecting Get Started
  acknowledges the displayed documents and persists the next step

#### Scenario: Language and display ownership
- **WHEN** a language changes or lifecycle reports a selected serial's orientation
- **THEN** the mounted wizard refreshes labels/profile names and the matching
  display readiness, ignores stale reads, and releases display-prompt ownership
  on unmount/reload/destruction

### Requirement: Explicit local service region confirmation

SETTINGS-056 SHALL project country CN as China and other country choices as
International, offer explicit China/International choices, and confirm the
region before advancing. Cancelling SHALL retain the draft on the locale step.
Confirming SHALL persist through the existing country-based wizard owner.
No IP lookup or vendor host, OTA, legal or credential routing SHALL run.

#### Scenario: Confirm or cancel region
- **WHEN** Continue is selected on Locale and region
- **THEN** a confirmation names China or International, Cancel stays on the step
  without saving region, and Confirm persists CN or the selected international
  country and advances only after successful save

### Requirement: Permission guidance without automatic requests

MAIN-128 and SETTINGS-015 SHALL show once-only first-run permission guidance
1500 ms after initial setup is ready on macOS. Guidance and reads SHALL never
request global input, microphone or screen access. Permission actions SHALL
require a user gesture, pin the management window through the existing shell
permission-flow owner, refresh on focus and every 2000 ms, and keep denied,
unknown and unsupported states truthful. Accessibility recovery SHALL offer
Restart Now and Later through the shell's existing restart action. All automated
verification SHALL inject permission probes, never change host permissions.

#### Scenario: Guidance is read-only and refreshable
- **WHEN** macOS setup opens for the first time
- **THEN** guidance appears after 1500 ms at most once, no permission mutation
  occurs, and a user can inspect denied and subsequently granted states

#### Scenario: Explicit permission flow
- **WHEN** a user selects a permission action
- **THEN** its bounded request runs only from that gesture, status comes from a
  fresh probe, and closing or hiding cannot discard the active flow

### Requirement: QUAKE help and calibration boundaries

SETTINGS-071 is explicitly excluded from QUAKE parity by Ramiro on 2026-10-26.
It is an ARIS-only hover popover with placeholder text and no recovered QUAKE
behavior. SETTINGS-072 SHALL keep QUAKE calibration unavailable and reject
unrecognized generic/ARIS calibration requests before device writes.

#### Scenario: ARIS placeholder is excluded
- **WHEN** QUAKE settings render
- **THEN** they do not expose the ARIS HelpTips placeholder

#### Scenario: Unsupported calibration
- **WHEN** a caller attempts generic or ARIS calibration for selected QUAKE
- **THEN** schema/authorization rejects it and no hardware write occurs

### Requirement: Management-owned setup window equivalent

For SETTINGS-052, Ramiro approved on 2026-10-26 the existing setup page inside
Management Center as the equivalent to the recovered fixed 920×680 native child.
The management window SHALL own the page and its loading/error/retry state.
Finish later SHALL return to Overview without completing setup. Reload SHALL
read persisted progress and release stale lifecycle suppression. Explicit
navigation SHALL remain available while a failed or pending setup read recovers.
There is no second native window, so no empty child-window URL to recreate.

#### Scenario: Leave and recover setup in its parent
- **WHEN** the user selects Finish later and reloads the management renderer
- **THEN** Overview is reachable, saved progress is unchanged, and a fresh startup
  read can resume unfinished setup without a stale native child or prompt owner

### Requirement: Selected-device setup handoff

MGMT-042 and MGMT-044 SHALL use the canonical profile and selected-hardware
owners. Connecting a serial SHALL resolve an existing visible profile using the
owner's startup/reported/saved/fallback policy, deliver it before publishing its
selection and return the same serial selection to the editor. Missing or invalid
active references SHALL not publish a nonexistent profile. Switching settings
devices SHALL use the shell's serial/session picker and remount device drafts;
in-flight edits SHALL retain their original session and never write to the newly
selected device. A user SHALL be able to return to the entrance while a save is
pending. The selected-device settings picker is the existing independent design,
not a second picker inside the strip/key editor.

#### Scenario: Missing active selection at connection
- **WHEN** a serial connects with a missing or invalid saved profile reference
- **THEN** a valid visible fallback is delivered, its serial selection is
  published and the profile editor reads the same active profile

#### Scenario: Switch with an old device draft pending
- **WHEN** a user leaves device settings and chooses a different serial/session
- **THEN** the new device's saved state replaces the old draft, and settling the
  old device request cannot mutate or overwrite the new device
