# Sound, GIF, Home Assistant and sidebar acceptance

Verified on the real Mac and a single QUAKE owner on 2026-10-25. Production source: `f77d91d2a2ab6b399543d5d3ba3be70c6c3db150`, including the previously verified CoreGraphics correction at `a886ec5416166d875815d30f27e13b32c72a8e56`. PR: https://github.com/ramarivera/open-quake/pull/38.

Local evidence root: `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/live-quiet-2026-10-24/sound-gif-ha`. Raw session files remain outside git. `evidence-sha256.json` records 97 verified file hashes, including 11 PNGs, excluding temporary caches and the manifest itself. Paths below are relative to that root.

## One curator round

Used the comment-curator skill and its bundled `gh_comments.py` against PR38 at `a886ec5`. The bounded snapshot had zero review threads and zero inline comments. CodeRabbit reported no actionable findings, Devin reported no issues, and Codex completed without inline findings. Copilot failed and suggested retry; no retry was requested. No review reply, resolution, merge or repeated review loop was needed. This review predates the Home Assistant/sidebar changes and does not constitute independent review of `f77d91d`. Snapshot: `pr38-before.json`.

## Audible timer output

The isolated profile's one-second file timer opened the production hidden audio window. It emitted started, paused and closed receipts and the window was destroyed. A USB microphone captured the generated 1.5-second WAV. Analysis detected the expected 523.25, 783.99 and 1046.5 Hz tones in order, with strongest-band/median ratios 11.11, 11.89 and 33.74. Evidence: `results/003-file-alarm.json`, `alarm-microphone.wav`, `tone-detection.json` and `alarm-acoustic-analysis.json`.

The separate system-beep key reached alarm completion. There is no separate acoustic qualification of that beep or the hardware buzzer. Cancelling a three-second timer after 500 ms produced zero audio receipts, countdown -1 and alert 0. Evidence: `results/004-cancel-alarm.json` and `results/005-beep-ha-read.json`. Soundboard remains a separate unimplemented effort.

Host output was temporarily 35, alert volume 25 and unmuted for the authorized test. Original output 0, input 57, alert 0 and muted true were restored and read back.

## Native GIF receiver and animation

The production emoji press and actual QUAKE Command+V pasted into a dedicated Finder folder. Finder was explicitly allowed in the isolated fixture's application match list. The received file was `finder-receiver/a25e3a01f87a652231bb9b24c2ea731a0e7af8156dc43dee19e1930298387ec2.gif`. Pillow confirmed GIF format, two frames and a SHA256 matching the filename stem. Evidence: `results/009-finder-paste.json` and `gif-received-validation.json`.

Quick Look opened that received file. Viewed captures `quicklook-1.png` and `quicklook-2.png` show blue and orange frames; `quicklook-3.png` also shows orange. This proves native animation of the received GIF and preserves its .gif filename. It does not prove animation inside a sent messaging attachment. Earlier Messages draft acceptance remains partial, and Windows acceptance remains open. Management task 7.3 / `open-quake-lih.17.1.26` stays unchecked.

## Home Assistant discovery and encrypted credentials

The authorized Arch/Cachy investigation found the running `home-assistant` HAOS VM, whose Core listens on port 80. The working HTTPS origin is `https://home.auto.roxasroot.net`. No household entity was changed.

With the user's explicit authorization, created the 365-day long-lived token named `open-quake macmini acceptance`. Saved it under fnox secret `HOME_ASSISTANT_OPEN_QUAKE_TOKEN` in the toolbox's encrypted source `/home/ramarivera/dev/toolbox/home/.chezmoitemplates/fnox-encrypted-secrets.toml`, then applied the targeted deployed fnox config. Source/deployed decryption matched and authenticated successfully. No plaintext token is included in this report, command arguments or evidence. Toolbox secret commit `c107cb7f3` reached remote master through normal merge/push at `fffe85ca7`.

Delivered the token to the test app through a mode-0600 FIFO, removed after consumption. The app retains its native safeStorage encrypted credential. The long-lived token remains encrypted as requested.

## Saved-key execution fix and live proof

Initial connection loaded 101 entities and 265 services, but the production panel activation rejected a saved Home Assistant key in the generic key runtime before integration dispatch. `f77d91d` adds an optional host-owned execution port behind existing committed selection, revision, visibility, quarantine and held-input guards. The desktop adapter decodes saved configuration and calls the existing direct Home Assistant executor. This direct user key is independent of the AI allowlist. Mock-device runs cannot call the external integration. Typed host failures retain the cause without exposing it in the public failure message.

Tests cover direct execution, guarded rejection, duplicate held presses, mock isolation, typed failure and app-root wiring. The rebuilt real app restarted with saved encrypted credentials. One initial reconnect failed transiently; a bounded ordinary retry succeeded. Evidence: `fixed-ha/results/002-reconnect.json`, `004-reconnect-diagnostic.json` and `005-reconnect.json`.

Created only the temporary helper `input_boolean.open_quake_acceptance_temporary` through the official websocket API. Real production panel activation toggled off → on → off. Two press events before release produced one toggle. Independent authenticated HTTPS reads confirmed both state changes. Evidence: `fixed-ha/results/006-toggle-on.json`, `007-toggle-off-dedup.json`, `fixed-ha/external-toggle-on-final.json` and `external-toggle-off-final.json`.

Viewed the actual mounted strip in `fixed-ha/ha-mounted-on.png` and `ha-mounted-off.png`; the tile displays on and off. The fixture wallpaper uses desktop-preview because it has no device serial, so its selection was set separately for these captures. Earlier `ha-tile-*.png` captures retained the old GIF selection and are superseded. Runtime activation targeted the actual device's committed profile throughout.

Removed the helper afterward. An independent authenticated GET returned HTTP 404, recorded in `ha-cleanup.json`.

## Sidebar and Linux scope

The management sidebar's boxed native scrollbar squeezed the compact navigation. The new CSS uses a 4px theme-matched thumb, transparent track and a stronger hover state. Viewed `main-before.png`, `sidebar-after-640.png` and `sidebar-after-1100.png`. Scrolling reached scrollTop 593 with scrollHeight 899 and clientHeight 306; all 13 navigation buttons remained reachable. Rebuilt production CSS reported 4px in `results/011-built-css.json`.

Linux has partial source support, not full acceptance. The Electron UI, Linux profile/application discovery and node-hid keyboard output have implementation paths, with suitable HID permissions required. GIF file-reference clipboard publication explicitly rejects Linux. Automatic display arrangement is macOS-specific, so Linux needs manual setup. CPU/memory monitoring is portable; other native monitor values remain unsupported outside macOS. Linux audio, focus, microphone and full app acceptance were not exercised here.

## Validation and cleanup

Biome checked 813 files. Forced typecheck/build and both bundle modes passed. Strict OpenSpec passed 40 items. Aggregate tests passed 1,793 tests across 190 files: protocol 60/4, device 424/36, edge 233/23 and desktop 1,076/127. The first concurrent Turbo run had one existing five-second timeout in profiles/registration.test.ts. The entire desktop suite then passed with `--maxWorkers=4`; the focused nine integration/runtime tests also passed after strengthening a privacy assertion. App composition/runtime focused checks passed 51 tests. See `full-gates.log`, `desktop-tests-final.log`, `bundle-final.log`, `lint-final.log` and `openspec-final.log`.

Full gates used an absolute nonsymlink TMPDIR with Turbo `--env-mode=loose`; backup symlink guards were preserved. These results combine the successful package runs and desktop rerun, rather than claiming the initial concurrent command exited successfully.

Both real app sessions ran sequentially and quit. Restored the fixture's Quiet GIF selection for device and desktop-preview, the empty clipboard, and original hardware preferences: knob LED always on true, buzzer enabled true, alert volume 84. Evidence: `fixed-ha/results/011-restore-stop.json`. Microphone recording ended, Quick Look was terminated and the dedicated Finder window closed. No task-owned app or DK-Suite process remained.

Tasks 8.8, 8.9 and 8.10 / beads `.10.2.26`, `.10.2.27` and `.10.2.28` close with this finite acceptance round. Physical controls/cables, hardware-buzzer acoustic qualification, Windows, messaging-app animation, voice, soundboard and the broader parity parents remain open.


## PR38 review follow-up: slow integration requests

Codex found that Home Assistant execution awaited its HTTP response while holding the shared runtime semaphore. The renderer's IPC handler also held its editor/icon request semaphore around activation. Either lock could stall unrelated input.

Activation now reserves the committed press under the existing guards and returns an awaitable completion. Home Assistant work runs in a service-scoped fiber; both the runtime entry point and registered IPC handler await completion after releasing their locks. Reset interrupts owned fibers for the requested device, without waiting for a network response. Original typed failures still reach callers. This interrupts the local wait, not a service action already received by Home Assistant.

The production IPC regression stalled the integration and reproduced a blocked duplicate press before the IPC change. The complete regression then proved duplicate suppression, release, unrelated shortcut execution, running-timer cancellation, navigation and reset interruption before releasing the fake network response. An initial broad lock bypass failed the existing queued-panel authorization test; the final two-phase approach preserves that test and the request authorization boundary. Early malformed test fixtures were corrected before the valid red/green run.

Verification on the source in the commit containing this section: all 424 device tests across 36 files and 67 focused desktop tests across five files passed. Both affected package typechecks, the production desktop build, both bundle modes, Biome 813 files, strict change validation and diff checks passed. The earlier 1,793-test aggregate belongs to the preceding source and was not rerun for this focused review fix. No further live device, sound or Home Assistant action was performed.

Reproduction: `pnpm --filter @open-quake/device test`; desktop `vitest run` for `src/main/key-library/registration.test.ts`, `src/main/integrations/key-action.test.ts`, `src/main/key-library/runtime-port.test.ts`, `src/main/index.test.ts` and `src/main/profiles/registration.test.ts`, using the absolute nonsymlink TMPDIR noted above. Task 8.11 / `open-quake-lih.10.2.29` closes for this finding; broader acceptance remains open.

## PR38 production-boundary follow-up

The review of `a698ba9a17e4528b54676d3815d5ab829de02dbf` found two remaining paths missed by the preceding lock tests. The renderer's single tap queue still awaited Home Assistant completion, and cancellation stopped at a desktop Promise callback while an independent integration runtime retained queued work. Ramiro authorized goal-driven continuation on 2026-10-25. Task 8.12 / `open-quake-lih.10.2.30` owns these fixes; published-head review and checks remain goal-owned until reconciled.

The panel dispatcher now queues by device and key. Each key retains press/release ordering and cancellation generations, while unrelated keys can proceed. Completed queues remove themselves. Existing main-process authorization and committed-key validation still apply to every request. The integration callback now carries the Effect AbortSignal from the desktop port through the saved-key decoder and production app wiring into the integration ManagedRuntime.

Both bugs reproduced before their production fixes. The renderer regression observed only the stalled press instead of the unrelated tap pairs. The cancellation regression ran the real desktop port, saved-key decoder, registered integration runtime and Home Assistant service with a synthetic connection. An action queued behind an occupied service semaphore still executed after reset, producing three outbound calls instead of two. Both regressions now pass. The registered key IPC regression also drives the real panel dispatcher and proves shortcut execution and timer cancellation while HA remains blocked. Device-specific and global reset each prevent the queued action from executing, and a subsequent key press succeeds. The startup wiring test checks that the exact signal reaches the integration entry point.

Verification on the source in this section's commit: 92 focused desktop tests across eight files, desktop typecheck, Biome 813 files, production build, both bundle smoke modes, strict `key-library-parity` validation and diff checks passed. The focused files are the prior five plus `integrations/controller.test.ts`, `integrations/review-regressions.test.ts` and `renderer/src/keys/panel-key-dispatch.test.ts`. Typecheck initially identified old single-argument calls in the startup test and native fixture; those callers now provide a signal, and the startup assertion checks its identity. No type assertions were weakened to pass.

Builds, logs and the smoke harness copy remain under `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake/pr38-round2`. Electron-vite used an external `--outDir`. The scratch copy of the existing bundle smoke changes only its import target to that build, uses the checkout's installed dependencies and runs both normal and mock modes. The existing checkout build remains untouched. No physical device, live HA entity, clipboard, audio, display or GUI action ran in this follow-up. Interruption prevents queued local work; it cannot undo an action already received by Home Assistant. The earlier aggregate and live-acceptance results remain historical, and broader physical and messaging/Windows acceptance remains open.
