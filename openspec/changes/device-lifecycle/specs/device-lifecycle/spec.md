# Spec Delta

## Purpose

Keep the desktop connected to one QUAKE and its strip across transient USB, display, sleep and lock events, with diagnostics and consent for host display changes.

## ADDED Requirements

### Requirement: Exclusive application instance
The app MUST acquire its single-instance lock before windows or device access. A duplicate MUST exit with an explanation and the existing instance MUST restore and focus management on all platforms. It MUST NOT terminate another process. Sources: MAIN-103, MAIN-120; open-quake-l86.12.

#### Scenario: Second launch
- **WHEN** the lock is unavailable
- **THEN** no device is discovered or opened and no windows are created, and the process quits with an already-running explanation

#### Scenario: Dock activation with a hidden fallback
- **WHEN** management is closed, hidden or minimized and the packaged fallback panel still exists
- **THEN** activate recreates or restores management, shows it and focuses it independently of the panel

#### Scenario: Existing instance activated
- **WHEN** a second-instance event arrives
- **THEN** the existing management window is restored if minimized, shown, and focused

#### Scenario: Second launch after all windows closed
- **WHEN** all windows have closed on macOS and a second-instance event reopens management
- **THEN** the existing instance restarts the device bus after the old owner closes, unlocks the lifecycle and schedules the same wake recovery as activate

### Requirement: Screen pairing transaction
When exactly one candidate has both the exact DK-QUAKE label and the physical 1920×480 dimensions in either orientation, the app SHALL bind that identified display without requiring a power-cycle topology change. Other candidate sets SHALL retain the screen-pairing transaction: the app SHALL serialize discovery, observe display disappearance before sending opcode 1 command [04,00], identify the unique removed QUAKE candidate, send [04,01], and bind when that display returns or a unique matching replacement appears. It SHALL restore screen power on timeout, interruption and failure. A transaction SHALL time out after 30 seconds and leave unresolved displays hidden rather than guess. Locked sessions SHALL defer discovery. Sources: MAIN-024, MAIN-042, MAIN-045, MAIN-050, MAIN-053, SETTINGS-083.

#### Scenario: Known strip retains EDID while blanked
- **WHEN** USB is connected and the sole candidate has the exact DK-QUAKE label and physical 1920×480 dimensions in either orientation
- **THEN** the panel binds that display without screen-power writes and without waiting for a disappearance event
- **AND** missing labels, mismatched dimensions and multiple candidates still require the blanking transaction

#### Scenario: Disconnect interrupts a pending discovery fork
- **WHEN** resume reopens HID and its disconnect event cancels a discovery fiber before that fiber starts
- **THEN** the checking reservation is released and the reconnected device can complete discovery and restore its panel

#### Scenario: Blanking identifies the strip
- **WHEN** two candidate displays exist and only one disappears during blanking
- **THEN** discovery powers the screen back on and binds the returning candidate rather than the first label or size hit

#### Scenario: USB arrives before HDMI
- **WHEN** USB connects without any display candidates
- **THEN** discovery returns unavailable without screen-power writes, HDMI stays failed, and a later HDMI topology event starts pairing automatically

#### Scenario: HDMI arrives during an active transaction
- **WHEN** a new candidate arrives while discovery is checking and that transaction finishes without a binding
- **THEN** the lifecycle retains the topology event and retries against the changed candidate set after restoring power, without requiring Re-detect
- **AND** off/on events that restore the same candidate set do not cause repeated transactions

#### Scenario: Missing or ambiguous topology
- **WHEN** no unique candidate disappears and returns within 30 seconds
- **THEN** power is restored, no guessed binding is committed, and diagnostics remain available

#### Scenario: Concurrent or interrupted checks
- **WHEN** checks overlap or shutdown interrupts discovery
- **THEN** only one off/on transaction runs at once and interruption restores power before the HID scope closes

### Requirement: Read error resilience and reconnect backoff
The device SHALL count transient EIO errors within a rolling ten-second window and refresh presence on each. Three EIOs SHALL terminate the handle; fewer SHALL preserve it with a thirty-second fallback reconnect. Other read failures SHALL disconnect immediately. Reconnect attempts SHALL wait min(1000+2000*retry,30000) ms, run in bursts of five while the selected path is still present, and reset retry state after thirty seconds of stable connection. After a burst, passive presence scanning SHALL permit later reappearance without a busy loop. Sources: MAIN-009, MAIN-010.

#### Scenario: Isolated EIO
- **WHEN** two EIOs occur within ten seconds
- **THEN** input can resume on the existing handle and it reconnects if the thirty-second fallback expires

#### Scenario: Error burst
- **WHEN** a third EIO occurs within ten seconds
- **THEN** the handle closes once and reconnect starts after one second, then uses increasing delays after failures

#### Scenario: Non-EIO failure
- **WHEN** the transport reports a non-EIO read error
- **THEN** the handle closes immediately and only safe catalog identity crosses IPC

#### Scenario: Device arrives during the final reconnect delay
- **WHEN** startup has no device through the fifth failed attempt at 16 seconds and a device arrives during the following nine-second wait
- **THEN** the first passive scan compares with presence observed before that wait and starts a new connection burst without another topology change or explicit recovery

### Requirement: Disconnect grace and wake recovery
The panel SHALL park immediately on display or USB loss and preserve the existing strip window for a 3000 ms USB disconnect grace. A return within grace SHALL reuse it. At 3000 ms the binding and active-device suspension lease SHALL release; at 5000 ms the parked window SHALL be destroyed unless a reconnect cancelled its close. Display removal SHALL park immediately and dispose the orphan after the 1500 ms topology debounce. Voice and key holds SHALL stop immediately on link loss. Lock SHALL defer heavy display recovery; unlock and resume SHALL reset backoff and schedule recovery after 2500 ms. All work and listeners SHALL stop on quit. Sources: MAIN-011, MAIN-012, MAIN-050, MAIN-053, MAIN-060, SETTINGS-079, SETTINGS-085.

#### Scenario: Brief disconnect
- **WHEN** the same device returns within three seconds
- **THEN** the existing panel window is repositioned and reused

#### Scenario: Unlock after topology changed
- **WHEN** the session unlocks or resumes
- **THEN** discovery and device reconnect resume after 2500 ms without overlapping HID handles

### Requirement: Connection diagnostic and re-detect
Management SHALL expose a USB and HDMI diagnostic with the recovered quakeDiagnostic English strings, expandable troubleshooting, accessible status, loading/error/retry states, and Re-detect. USB SHALL pass only for a current connection. HDMI SHALL pass only for a discovered QUAKE display with valid physical landscape or portrait size. A labelled display with wrong size SHALL show its physical dimensions and resolution guidance. Both passing SHALL admit device settings automatically; desktop preview SHALL remain available without hardware. Sources: MAIN-059, MGMT-026-030, MGMT-032-037, MGMT-040, SETTINGS-086.

#### Scenario: USB only
- **WHEN** USB passes and HDMI is absent
- **THEN** HDMI troubleshooting expands and Re-detect can run again without another HID handle

#### Scenario: Wrong resolution
- **WHEN** a labelled QUAKE display has an unsupported physical size
- **THEN** HDMI fails with current dimensions and resolution guidance

#### Scenario: Re-detect completes
- **WHEN** the user re-detects
- **THEN** the action disables during the check, failures remain retryable, and both passing enables device settings automatically

#### Scenario: Diagnostic integrates with management navigation
- **WHEN** the user opens Connection from the sidebar or Overview and both checks finish passing
- **THEN** management enters Screen automatically, preview remains reachable without hardware, and connection updates continue on other pages

#### Scenario: Initial real-device readiness
- **WHEN** USB connects with a unique panel-shaped display before screen-off pairing completes
- **THEN** every diagnostic notification keeps HDMI failed until the transaction confirms a binding, and timeout cannot publish readiness

#### Scenario: Readiness lost while viewing Screen
- **WHEN** a passing check has opened Screen and readiness becomes false
- **THEN** management returns to Connection to show checking or failure, and a later passing check enters Screen again
- **AND** Screen remains available as a deliberate desktop preview while offline

### Requirement: Display prompts and explicit host consent
The app SHALL detect mirroring and portrait orientation, using displayMode English strings. Portrait SHALL persist 2500 ms and be ignored within 6000 ms of landscape. The setup wizard SHALL suppress automatic orientation prompts while open. Later SHALL snooze prompts for ten minutes and keep the device connected. Mirroring dialogs SHALL also expose an explicit Disconnect choice that requests the existing graceful application shutdown. macOS arrangement remediation SHALL require explicit consent to make QUAKE non-primary, disable mirroring if requested, and move it to the far right. Only a successful consented repair SHALL persist the first-run arrangement result. No host change SHALL occur before consent or in mock mode. Windows SHALL offer consented DisplaySwitch.exe /extend and display settings. Sources: MAIN-044, MAIN-057, MAIN-058, SETTINGS-087-089.

#### Scenario: Portrait prompt snoozed
- **WHEN** confirmed portrait is dismissed with Later
- **THEN** no orientation prompt recurs for ten minutes

#### Scenario: Mirrored or misplaced strip
- **WHEN** a strip is mirrored or needs macOS arrangement repair
- **THEN** the app offers a consent dialog describing the proposed operation, and declining or Later makes no native call

#### Scenario: Consented layout repair fails
- **WHEN** an accepted automatic layout repair fails at the native boundary
- **THEN** management keeps the diagnostic visible instead of entering Screen, receives a safe native-failed diagnostic with recovery text and automatic layout consent prompts snooze for ten minutes from failure, while an explicit repair remains available and preserves the catalog failure identity

### Requirement: Serial-safe stable display recovery
The lifecycle SHALL retain bindings and last stable bounds by device serial. A pure planner SHALL reserve unique existing candidate IDs first, then unique equal stable bounds, then a sole remaining candidate for a sole remaining device. Reused IDs on unrelated displays SHALL never bind. Unresolved devices SHALL park and enter serialized screen-power discovery. Multiple unresolved candidates SHALL publish a typed multi-screen alert with every active serial as targets. Meaningful display bursts SHALL debounce for 1500 ms; workArea-only changes SHALL not schedule recovery. Lock SHALL cancel pending generations and park windows; wake SHALL park immediately and recover all queued bindings after 2500 ms, without stale-session writes. Sources: MAIN-046, MAIN-047, MAIN-053, MAIN-060, SETTINGS-085.

#### Scenario: Reused ID and multiple unresolved strips
- **WHEN** a prior strip ID now belongs to a desktop and two strips need binding
- **THEN** the desktop stays unbound, uniquely matching stable bounds reserve their serial, and remaining ambiguous serials park and receive the same targeted multi-screen alert

#### Scenario: Lock invalidates pending recovery
- **WHEN** lock or a newer wake interrupts discovery or a delayed recovery
- **THEN** the older generation cannot commit a binding or write to a replaced hardware session, and unlock pumps the remaining serials after exactly 2500 ms

### Requirement: Serial-owned panel renderers
Every strip renderer SHALL receive its owning serial during initialization. Wallpaper state and playback SHALL remain independent of the management selection. Profile selection and key activation SHALL use the renderer's serial, and main SHALL reject a panel's activation for another serial using the registered window identity. Sources: MAIN-046, MAIN-047, SCREEN-146.

#### Scenario: Two strips and a changing management selection
- **WHEN** panels A and B are connected and management selects either device
- **THEN** each panel keeps its own wallpaper and selected profile, receives its own input, and submits activations for its own serial only

### Requirement: Native display evidence and bounded Windows preparation
Read-only Windows probes SHALL inspect Windows Forms screens and WMI monitor names, retaining wmi-name or forms-size evidence separately from Electron bindings. Probe and extend failures SHALL retain their catalog identity in diagnostics. Native-only evidence SHALL never place a window on an unconfirmed display. Explicit Re-detect SHALL offer Windows extend consent, make zero native mutation calls on decline or in mock mode, poll Electron every 500 ms through 5000 ms, collect native evidence, and publish the final diagnostic after a further 1500 ms. Sources: MAIN-043, MAIN-044, MAIN-059.

#### Scenario: Electron misses a Windows strip
- **WHEN** Electron has no candidate but WMI reports DK-QUAKE
- **THEN** diagnostics retain native presence and source while HDMI remains unbound, polling stops at 5000 ms, and the final diagnostic arrives at 6500 ms

#### Scenario: Windows preparation refused or failed
- **WHEN** extend consent is declined or an accepted native operation fails
- **THEN** decline performs no DisplaySwitch call, failure remains visible and retryable, and mock mode performs neither probes nor host changes

### Requirement: Scaled layout and orientation snapshots
Diagnostics SHALL project every display's physical bounds using its scale factor, preserve negative origins and report strip order. Every confirmed serial binding SHALL publish rotation, isVertical and horizontal or vertical orientation on bind and after debounced topology recovery. Setup SHALL subscribe while mounted and refresh connected-device orientation every 2000 ms, show portrait and landscape diagrams and platform Display Settings remediation, and require connected landscape for hardware continuation. Valid display dimensions SHALL determine orientation, with rotation used only when dimensions are unavailable. A transition from connected hardware to USB loss SHALL leave setup without completing or erasing saved progress. Desktop preview SHALL remain available independently. Sources: MAIN-054, SCREEN-147, SETTINGS-058.

#### Scenario: Rotated strip with mixed DPI
- **WHEN** a bound serial rotates on a desktop with mixed scale factors and negative display origins
- **THEN** reads use its live orientation and physical bounds, recovery reassignment waits for the 1500 ms burst debounce, physical bounds retain their scaled negative origins, and another serial's orientation remains independent

#### Scenario: Bound strip moves during another serial's pairing
- **WHEN** a bound strip changes position or rotation while another serial is pairing
- **THEN** the first strip's display lookup and the pairing finalizer use the live display metrics, while the saved binding remains separate for recovery

#### Scenario: Wizard owns orientation remediation
- **WHEN** setup is open with a connected portrait strip
- **THEN** it shows orientation guidance and diagrams, hardware continuation waits for landscape, desktop preview still continues, and automatic orientation prompts resume only after setup closes

### Requirement: Scoped native strip window policy
Strip windows SHALL be frameless, fixed-size, transparent, non-focusable, excluded from taskbars and native mouse input, with context isolation and typed preload. Fallback preview SHALL retain mouse interaction. Native strip content SHALL reveal only after load readiness, use display-derived zoom and bounds, and remain above normal windows. macOS SHALL own a black boot shield until 350 ms after reveal and destroy it on park, replacement or quit, including slow loads. Windows SHALL refresh topmost position every 1000 ms while visible. Linux SHALL use a dock window visible across workspaces. Minimize SHALL restore after 10 ms only while presentation is still requested. Hide and close SHALL retain separate last visible bounds. Only windows owned by this panel owner SHALL be swept. Sources: MAIN-048, MAIN-049, MAIN-050, SCREEN-146.

#### Scenario: Slow load or replacement leaves no shield
- **WHEN** a macOS strip loads slowly, parks, is replaced or quits
- **THEN** no content appears before readiness and every shield and delayed reveal callback is disposed with its owner

#### Scenario: Disconnect deadline and reconnect cancellation
- **WHEN** USB disappears
- **THEN** the panel parks immediately, stays reusable at 2999 ms, releases its binding at 3000 ms, exists at 4999 ms and is destroyed at 5000 ms unless reconnect cancels the deadline

### Requirement: Active-device app suspension lease
The app SHALL start exactly one prevent-app-suspension blocker when the first device becomes active, retain it during USB grace, and stop it after the last active device leaves or on quit. Duplicate events and reconnects SHALL not leak blockers. Failed start SHALL retain a retryable safe failure without losing cleanup ownership. Display sleep SHALL remain under OS policy. Sources: MAIN-061, SETTINGS-084.

#### Scenario: First and last strip
- **WHEN** two devices connect, one disconnects, the other reconnects within grace, and finally both leave
- **THEN** one blocker spans their active lifetimes, stops after the last grace expires, and quit releases any remaining blocker

#### Scenario: Explicit mirroring disconnect
- **WHEN** the user chooses Disconnect in a mirroring dialog instead of Switch or Later
- **THEN** the existing graceful quit path tears down device, voice, window and suspension owners, while Later alone keeps them connected
