## Context

Evidence root: `~/dev/dark-encyclopedia/dk-suite-introspeccion/v0.4.95/`. Read `audit/GAP-MAP.md` cluster 17, `audit/AUDIT_WIDGETS.md` WIDGETS-122..127 and `audit/AUDIT_MGMT.md` MGMT-072,173..193,219,282. Recovered `src/views/Components/OBSConnectionConfig.vue:1-385`, `OBSConnectDialog.vue:1-120`, key catalog KC:1102-1366 and KC:3986-4031, and `app-resources/background.js` offsets 1019750,1035263,1054500-1061000,6163700-6183000 supply the behavior. These proprietary sources are evidence only; implementation is original.

## Recovered command enumeration, before implementation

All key configurations store one `{type: "configData", value: JSON-string}` action. Optional names accompany UUIDs for display. No command contains credentials.

| Row | Recovered id | Parameters and behavior |
| --- | --- | --- |
| MGMT-173 | obsScene | sceneUuid, sceneName; SetCurrentProgramScene |
| MGMT-174 | obsPreviewScene | sceneUuid, sceneName; SetCurrentPreviewScene |
| MGMT-175 | obsTransition | {}; TriggerStudioModeTransition |
| MGMT-176 | obsStudioMode | {}; invert GetStudioModeEnabled, SetStudioModeEnabled |
| MGMT-177 | obsStream | mode=toggle; ToggleStream |
| MGMT-178 | obsRecord | mode=toggle or pause; ToggleRecord or PauseRecord |
| MGMT-179 | obsSource | sceneUuid, sceneName, sceneItemId, sourceName; invert current sceneItemEnabled |
| MGMT-180 | obsMute | inputUuid, inputName; ToggleInputMute |
| MGMT-181 | obsVolume | inputUuid, inputName, step=0.01..0.20 default 0.05, allowGain=false, pressAction=mute; press toggles mute, turn reads and clamps inputVolumeMul then SetInputVolume |
| MGMT-182 | obsCut | {}; SetCurrentSceneTransition Cut then TriggerStudioModeTransition |
| MGMT-183 | obsTransitionSet | transitionName, durationMs=50..20000 default 300; set transition then duration |
| MGMT-184 | obsAudioMonitor | inputUuid, inputName, monitorType=monitorOff/monitorOnly/monitorAndOutput |
| MGMT-185 | obsReplayBuffer | action=toggle/save/start/stop; corresponding ReplayBuffer request |
| MGMT-186 | obsVirtualCam | {}; ToggleVirtualCam |
| MGMT-187 | obsMedia | inputUuid, inputName, mediaAction=OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY/PAUSE/STOP/RESTART/NEXT/PREVIOUS |
| MGMT-188 | obsFilter | sourceName, filterName, filterEnabled=true/false; SetSourceFilterEnabled |
| MGMT-189 | obsProfile | kind=profile/sceneCollection, name; SetCurrentProfile or SetCurrentSceneCollection |
| MGMT-190 | obsRecordSplit | {}; SplitRecordFile |
| MGMT-191 | obsSceneTransitionOverride | sceneUuid, transitionName, durationMs; SetSceneSceneTransitionOverride |
| MGMT-192 | obsStats | {}; display-only 2x1, GetStats every 2000 ms |
| MGMT-193 | obsScreenshot | sceneUuid, sourceName; display-only 2x2, GetSourceScreenshot jpeg 128x128 every 2000 ms |

MGMT-219 adds the same obsVolume config to knob control. MGMT-282 edits configData with Save/preview semantics. MGMT-072 attempts a connection on selection and shows connection help after 2000 ms if still disconnected.

## Decisions

The device package owns portable command contracts and registry declarations. The edge package owns the Effect conductor, repository and bounded websocket transport. The desktop owns filesystem detection, OS safeStorage credentials, authorized IPC and views. Native WebSocket and crypto handle production IO; a pinned ws development dependency supplies the in-process fake server only.

Only loopback or the explicitly saved host is contacted. Host input rejects credentials, URL paths, fragments, query strings and wildcard bind addresses. Manual configuration prevents automatic detection from overwriting it. Detection reads local OBS config only, never launches OBS, and returns no password to the renderer. Passwords use the existing CredentialVault and an opaque reference in JSON, fail closed without OS encryption and never enter logs or public errors.

Each connection has bounded handshake/request deadlines, correlated request ids, bounded incoming messages and scoped close. RPC/auth failures have distinct catalog identities and stop automatic retry until explicit connect/configuration. Connection loss retries without replaying commands. Visible tile ownership controls the 2000 ms polling fiber. Profile/page replacement and renderer destruction clear leases and reject stale updates. Missing values show unavailable, never fake zero.

Original bugs corrected for interoperability: special desktop/microphone names from GetSpecialInputs use v5 inputName rather than treating their names as UUIDs; monitor shorthand maps to v5 OBS_MONITORING_TYPE_* constants; media actions always use the full v5 enum, profile editor reads the saved `name`, screenshot strips the data URL prefix correctly, and stats labels use the selected language instead of hard-coded Chinese. Request error comments and remote close reasons never reach diagnostics.

## Risks and verification

Fake-server tests establish protocol framing, auth, command mapping, lifecycle and refresh behavior. Hidden mock Electron smoke establishes renderer/preload wiring and layout. Real OBS interoperability and physical QUAKE appearance/input remain unverified and are not prerequisites for this lane. No real OBS process will be launched.

## Shared interfaces

The key runtime delegates validated OBS commands through its existing executeOwned port, with the same cancellation and held-press deduplication as Home Assistant. The knob model adds an optional focusedPress port and recognizes obsVolume as a focusable kind. DesktopKnobBindings adds one OBS callback with a beforeWrite guard, so asynchronous volume reads recheck the committed profile before writing. Profile footprints add the two fixed OBS sizes. These are the only shared runtime interfaces extended by this change.

## Implementation and verification record

Tracking epic: open-quake-lih.18.1, child of open-quake-lih.18. Tasks map in order to open-quake-lih.18.1.1 through open-quake-lih.18.1.7.

The native smoke uses the production preload, IPC and mounted strip/editor with hidden windows and a loopback fake OBS server. It asserts decoded JPEG, centered status text, stats, fixed spans, screenshot target save, panel credential-write rejection and navigation teardown. Run evidence and screenshots are local-only under /Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/obs-studio/. The fixture omits unrelated backend/locale/agent IPC handlers, so Electron logs their absence without failing smoke assertions.

Full-suite tests require TMPDIR to reach child processes on macOS. Turbo strict environment filtering removes it, causing existing backup tests to reject symlinked /tmp. The lane uses pnpm test --env-mode=loose --concurrency=1 -- --maxWorkers=2 with TMPDIR set to lane scratch. No assertions or check configuration are weakened.

MGMT-219 volume behavior is bound through the existing focused-knob action path. No standalone knob-profile framework is introduced. Browser rendering is verified; physical device raster delivery, real OBS interoperability and the production OS credential backend remain unverified.

Final local gates on 2026-10-26: Biome checked 1173 files with no errors and 14 pre-existing warnings; typecheck passed 6 tasks; full tests passed 2912 with 4 existing skips across 310 passing files and 2 skipped files; build passed; both desktop bundle scenarios passed; strict OpenSpec validation passed 47 items. OBS-specific coverage is 38 edge tests and 7 desktop consumer tests. The extended native smoke passed with production IPC/editor saves for screenshot and knob-enabled special audio input, valid JPEG rendering and visibility teardown. Screenshots: panel-obs.png and management-obs.png in the lane scratch directory.

The branch includes current main thumbnail-retention changes via a conflict-free merge. All six gates, bundle checks and the hidden native smoke passed again after that sync.

PR80 target repair uses GetInputVolume to discover audio support instead of guessing from kind names. Recovered OBSConnectionConfig.vue:217-229 used media/audio substrings and special inputs. That vendor heuristic misses FFmpeg/VLC/platform/plugin sources. The editor retains special inputs, admits all inputs whose audio request succeeds, and explicitly includes FFmpeg/VLC for media controls. Unsupported-input request errors only remove that capability; network/auth failures still fail the catalog. Audit rows MGMT-180,181,184,187,219.

PR80 panel live requests match the decoded committed command and key id on the active device page. Authorization runs before each poll and after IO, revoking stale leases and withholding in-flight images after profile replacement. Management retains draft preview rights. Tiles retry on committed profile snapshots so saving an unchanged draft restores its subscription.
