# Hardware controls verification

Implemented on lane/hw-controls in /Volumes/ExtSSD/devplane/oq-hw-controls.
The base includes management redesign PR #18 and audit corrections PR #19.
No dependency was added. All transport verification uses fake HID. No real
QUAKE or touch-controller handle was opened, DK-Suite was never started, and
no firmware was flashed.

## Delivered behavior

- Protocol command/reply Schemas, semantic decoders and complete 33-byte HID
  report fixtures live in packages/protocol/src/hardware.ts and
  packages/protocol/test/hardware.test.ts.
- packages/device/src/hardware/ owns commands over the existing connection,
  serial preferences, mic acknowledgment, native luminance, tone playback,
  keyboard routing and LED lock policy. No second handle is opened.
- The desktop Controls page uses the existing grouped forms and theme tokens.
  It exposes firmware version, LED preference, alert volume, buzzer, mic,
  luminance and explicit hotkey output. It shows loading, disconnected,
  pending save and failure states. Labels reuse recovered English strings.
- IPC validates requests and binds mutations to the current session, exact
  renderer URL, current management window and top-level frame. OS lock
  subscriptions are removed on quit. Serial JSON writes validate, stage and
  rename atomically; raw serials never become filesystem paths.
- Related lighting/SDK specs now identify the recovered commands. The
  monitoring control is called monitoring override, using the correction
  already merged in PR #19. Its remaining game-mode wording is corrected.

## Audit coverage

| Rows | Implementation and proof |
|---|---|
| MAIN-015,018..020 | Typed version/mic/luminance replies, matching transactions, successful mic ack, 26-unit steps and minimum 25; protocol and device tests |
| MAIN-021..023; KNOB-066,067; SETTINGS-022,082 | Exact tone sequences, volume map/default, cancellation, 300 ms preview and serial persistence; TestClock and desktop tests |
| MAIN-024,025; SETTINGS-021,085 | Typed screen power, knob LED off/on and serial lock policy; golden fixtures, service/registration tests and mock UI smoke |
| MAIN-026,096 | Device keyboard default, explicit host route, action/modifier/usage bytes, cleanup on failure/cancellation and actual committed ActionService dispatch test |
| SETTINGS-077,078,080,081 | Firmware display/refresh, mic and native luminance settings; actual renderer/preload/IPC smoke |

SETTINGS-083 power-cycle orchestration stays with lifecycle/settings ownership.
This lane exposes the typed screen-power command. Firmware-upgrade, voice and
profile/knob runtime owners consume the small interfaces documented in
packages/device/src/hardware/README.md. Their complete workflows are not
implemented or qualified here.

## Verification results, 2026-10-24

| Gate | Result |
|---|---|
| pnpm biome check packages apps | Pass |
| pnpm typecheck | Pass, six tasks |
| pnpm test | Pass, 562 tests: protocol 47, device 316, desktop 172, edge 27 |
| pnpm build | Pass |
| pnpm --filter @open-quake/desktop test:bundle | Pass |
| openspec validate --all --strict | Pass, 29 changes after PR #19 integration |
| Hardware native mock smoke | Pass |
| Existing media native smoke | Pass, including runtime disposal |
| git diff --check | Pass |

All six gates passed on the integrated PR #18/#19 base after the shared
diagnostics refinement. The native smokes exercise the final UI and IPC code;
they ran before the diagnostics-only refinement. The consumer failure test
also asserts the exact hardware/HID error identities, retained private cause
and scrubbed serialized diagnostic chain.

The hardware native smoke builds its dedicated hidden-window entry, loads the
production preload and renderer, queries mocked firmware, changes the LED
preference, emits lock/unlock, toggles mic, decreases luminance by 26 and changes
volume to slider position 1. It checks the resulting settings and persisted
state, captures dark/light/narrow/offline UI and checks narrow overflow.
The media smoke exercises real native image decoding, IPC permissions,
per-serial media, theme/motion, clock synchronization and disposal.

Native builds/runs use OPEN_QUAKE_MOCK_DEVICE=1, unset ELECTRON_RUN_AS_NODE and
use lane scratch as TMPDIR. One hardware smoke emitted Chromium cache-directory
warnings; its assertions passed and the process exited. Owned Electron
processes are checked after the runs.

Evidence root:
/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/hw-controls/

- gate-1.log through gate-6.log hold the six gate outputs.
- hardware-smoke-build.log and hardware-smoke-run.log hold the native gate.
- media-smoke-build.log and media-smoke-run.log hold the required media gate.
- native/hardware-dark.png, hardware-light.png, hardware-narrow.png and
  hardware-offline.png were rendered and visually inspected.
- media-native/ contains the required panel and management screenshots.

Run commands are documented in apps/desktop/src/main/hardware/README.md and
apps/desktop/src/main/media/README.md. Pass the lane scratch screenshot paths,
set the mock environment and unset ELECTRON_RUN_AS_NODE for every Electron run.

## Reverse-engineering findings for the lead

Research root is the local-only
/Users/ramarivera/dev/dark-encyclopedia/dk-suite-introspeccion/v0.4.95/.
Inspected inputs are app-resources/background.js, recovered_sources/src/views/
Setting/DeviceSettings.vue, locales/locale-en.json and the cited audit rows.
Firmware paths below are relative to the root checkout's local-only
.context/decokee-quake-fw/.

1. background.js sendTriggerKeyBoard encodes [16, action, modifierMask, usage]
   after opcode 1, where 16 is hexadecimal command 0x10. Actions are 1 down,
   0 up and 2 tap. Firmware src/input/report.c:442..510 corroborates order and
   actions, with a 5 ms firmware tap. The atomic host adapter holds for 50 ms
   before release, matching the recovered host chord behavior.
2. DK-Suite isGamingMode defaults true each launch and is not persisted. It
   means device keyboard output. gameModeMonitorConfig is unused. Monitoring
   override is our separate proposed metric overlay and never selects the
   keyboard route.
3. Firmware docs/PROTOCOL.md labels cmd0x06 as buzzer, but host
   _sendLEDSettings and the reconstructed firmware show knob LED enable.
   Buzzer uses cmd0x02. These are distinct from QMK RGB controls.
4. src/protocol/quake_protocol.c:140..144 describes literal 0x900055 while
   assigning bytes 55,90,00. Little-endian 0x900055 is 55,00,90. The host handler
   agrees with the latter: op55/cmd00/sub90 means successful generic ack.
   The reconstructed C transposes cmd and sub. This implementation follows
   the demonstrated host contract; real-firmware acceptance remains open.
5. The reconstructed modifier loop uses i < 7 while the host maps
   right_command to 128. All eight wire bits are retained. Physical right
   Command behavior needs lead verification rather than changing the wire map.
6. Brightness uses native increments of 26, clamped to 25..255, and displays
   round(100*value/255). A recovered DK listener can report an unclamped
   intermediate number. Our snapshot reports the clamped value.
7. Volume slider positions are 0..96. Zero maps to silence; 1..96 maps to
   round(32+(position-1)*96/95). Default native volume 84 is position 52.
   The preview starts after 300 ms debounce, with steps [v,80],[0,80],[v,80].
8. Exact source patterns are start [80,100],[0,10],[80,100]; end
   [50,100],[0,1],[50,100],[0,1],[50,100]; error [90,200]; busy
   [60,60],[0,40],[60,60],[0,40],[60,60]. Every nonzero level is replaced by
   configured volume. Each step sends zero after its duration, then waits
   10 ms, including silent steps.

## Limits and handoff

Physical keyboard output/layout, modifier behavior, microphone switching,
panel luminance, buzzer acoustics/volume, knob LED effects, screen power,
real version replies and generic ack behavior remain unverified. Mock delivery
and a source-derived ack are not physical acceptance.

Hardware sessions consume every set ack and serialize queries. A timeout or
interrupted transaction disables the session until reconnect so a late generic
ack cannot confirm a later mic change. Keyboard cancellation attempts release
even after a lost press ack; tone cancellation attempts silence. There is no
automatic retry or silent host keyboard fallback.

Beads: cluster open-quake-lih.12, epic open-quake-lih.12.1, task issues
open-quake-lih.12.1.1 through .5. Lighting task open-quake-da4.6 is implemented
here. Tasks 1.1..1.4 and lighting 2.3 close with this source and mock evidence.
Task 1.5, the hardware epic and cluster close with the open, linked PR.
Hardware acceptance and other lanes' integration tasks remain open.

## PR handoff

PR: https://github.com/ramarivera/open-quake/pull/22, targeting main.
Implementation commit: 6b56ceb. The PR is registered with the T3 thread.
A separate documentation commit records this handoff without changing tested
runtime code. Cluster open-quake-lih.12, epic open-quake-lih.12.1, tasks
open-quake-lih.12.1.1 through .5 and lighting task open-quake-da4.6 are closed
with source and mock-verification evidence. The PR is not merged and no
review threads were resolved.


## PR #22 review round 1, 2026-10-24

Merged origin/main at 2ac4a2f, including strip-grid PR #23, in merge commit
a5612eb. Startup retains profile registration and the mock hardware bus;
preload exposes both bridges; the media smoke registers and disposes both
integrations.

Review fixes:

- Hardware writes hold a connection-owned permit until the native write
  settles. Teardown stops accepting writes and drains that permit before
  closing the handle. Tests cover cancellation followed by explicit disconnect
  and scope close. Ordinary reply waits remain cancellable, with the existing
  protection against reusing a late acknowledgment.
- Preference flushes serialize within HardwareControls and finish each started
  atomic write before a replacement debounce or teardown flush can proceed.
  Tests hold the real desktop adapter's rename for A, submit B, and assert the
  final JSON contains B, both after debounce and teardown. Both tests first
  failed with 32 on disk instead of the expected 128.
- The volume range keeps the desired value locally and coalesces queued
  adjustments during an active mutation. It stays enabled while the session
  is available. Native smoke holds the first configure request, drives
  53/60/70/80, sees position 80 before the reply, checks exactly two configure
  requests, and verifies only the final volume 112 produces the preview.
- A ready polling response clears transient request errors. The native smoke
  injects a failed refresh and proves the alert disappears on the next ready
  poll without another mutation. This check failed before the renderer fix.
- Preview replacement finishes each started buzzer exchange before cancelling
  subsequent tone steps. A delayed-ack regression proves the session remains
  usable, while a separate regression proves ordinary reply waits still cancel.
- Device keyboard usages 47/48 use ActionService's canonical leftbracket and
  rightbracket tokens. Tests execute committed actions through the real action
  consumer and assert exact press/release reports without host injection.

The serial-display security finding is declined. Showing the connected
serial in this local management window is intended, as in DK-Suite and the
existing per-serial Screen settings. Inspected node-hid discovery, hardware
session, desktop bus, renderer forwarding, IPC registration/controller and
preference adapter. Serial use stays in local memory, the authorized local
management IPC response, and local JSON with SHA-256 filenames. Hardware log
sites emit catalog codes only; diagnostic projection excludes user strings.
No network sink receives the serial in these paths.

All six lane gates passed on the integrated code:

- pnpm biome check packages apps, 234 files.
- pnpm typecheck, six tasks.
- pnpm test, 616 tests: protocol 47, device 324, desktop 218, edge 27.
- pnpm build.
- pnpm --filter @open-quake/desktop test:bundle.
- openspec validate --all --strict, 30 changes.

The hardware and media native smokes both passed with
OPEN_QUAKE_MOCK_DEVICE=1, ELECTRON_RUN_AS_NODE unset, and lane scratch as
TMPDIR. Hardware screenshots under review-1-native cover dark, light, narrow
and offline controls. Media screenshots under review-1-media cover the strip
profiles and management views. Inspected hardware dark/light/narrow/offline,
media panel and narrow Screen images. The media smoke also verifies runtime
disposal before quit. No owned Electron smoke process remained afterward.
Chromium emitted cache-directory diagnostics during the hardware smoke;
all assertions passed and it exited successfully.

Evidence root remains
/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/hw-controls/.
Logs for this round are review-1-gate-{biome,typecheck,tests,build,bundle,specs}.log,
review-1-hardware-smoke-{build,run}.log, and
review-1-media-smoke-{build,run}.log. Failing-before-fix evidence is in
review-1-red-device.log, review-1-red-preferences.log and review-1-native-red.log.

Bead open-quake-lih.12.1.6 tracks this review implementation. The epic was
reopened for it. Cluster open-quake-lih.12 remains open until PR #22 merges,
per the lead's instruction, superseding the earlier handoff's closure note.
Physical hardware remains unverified and was never opened. No new dependency,
firmware operation, DK-Suite launch or hook bypass was used. PR #22 remains
unmerged.

## PR #22 strip-touch merge round, 2026-10-24

Merged origin/main at 969d165, containing strip-touch PR #20, onto the reviewed
hardware head 66887b4. The three conflicts preserve both implementations:

- deviceBus.ts retains main's vendor-touch forwarding, explicit disconnect
  finalizer and stream-exit tracking. Hardware attachment, current session,
  internal HardwareReply handling and connect-time refresh remain intact.
  The stale comment about unsupported separate touch input is replaced with
  main's description of the bound vendor stream. Biome formats the function.
- device-service.ts retains main's touch source, readiness and connection
  controls alongside hardware sending. The review fix still rejects writes
  after shutdown starts and drains started native writes before handle close.
- media/smoke.ts retains main's complete synthetic touch, grid gap, span swap
  and dynamic sub-touch checks, plus hardware registration and unregistration
  after the touch section.

All required gates passed on the combined code:

- pnpm biome check packages apps, 255 files.
- pnpm typecheck, six successful tasks.
- pnpm test, 655 tests: protocol 47, device 345, desktop 236, edge 27.
- pnpm build.
- pnpm --filter @open-quake/desktop test:bundle, both default and mock paths.
- openspec validate --all --strict, 31 changes.
- Native media smoke, including raw synthetic touch through the production
  preload and mounted panel, profile span swap and runtime disposal.
- Native hardware smoke, including firmware query, LED lock policy, mic,
  brightness, coalesced volume changes, persistence and polling recovery.
- git diff --check.

Both native runs used OPEN_QUAKE_MOCK_DEVICE=1 with ELECTRON_RUN_AS_NODE unset
and TMPDIR under lane scratch. Both exited successfully; a process check found
no remaining owned Electron process or DK-Suite. Chromium cache-directory
diagnostics appeared during the hardware smoke without assertion failures.

Evidence is under
/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/hw-controls/merge-969d165/.
Gate logs are gate-{biome,typecheck,test,build,bundle,openspec}.log. Native logs
are {media,hardware}-smoke-{build,run}.log. Screenshots are in media-native/
and native/. Bead open-quake-lih.12.1.7 tracks OpenSpec task 1.7. Cluster
open-quake-lih.12 remains open until the lead merges PR #22. No additional
behavior or audit coverage is introduced; physical hardware remains unverified
and was never opened.
