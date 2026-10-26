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
The panel SHALL hide immediately on display or USB loss and preserve the existing strip window for a 3000 ms USB disconnect grace. A return within grace SHALL reuse it. Lock SHALL defer heavy display recovery; unlock and resume SHALL reset backoff and schedule recovery after 2500 ms. All work and listeners SHALL stop on quit. Sources: MAIN-011, MAIN-012, MAIN-060, SETTINGS-079, SETTINGS-085.

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

Audit regression coverage: MGMT-023, MGMT-027, MGMT-028, MGMT-036, MGMT-043.

#### Scenario: Connection transitions use both channels
- **WHEN** USB arrives before a valid landscape or portrait display, repeats, and is later lost
- **THEN** management enters Screen only after both channels pass, ignores repeated pass notifications, returns to Connection after loss, and still permits explicit desktop preview

Audit regression coverage: MGMT-032, MGMT-033, MGMT-035, MGMT-040.

#### Scenario: Diagnostic details remain accessible
- **WHEN** a completed check reports USB failure, missing HDMI, resolution mismatch or both passing
- **THEN** the first failed row expands, keyboard activation exposes each troubleshooting branch or stable-connection advice, and narrow layout, focus visibility and reduced motion remain supported

### Requirement: Display prompts and explicit host consent
The app SHALL detect mirroring and portrait orientation, using displayMode English strings. Portrait SHALL persist 2500 ms and be ignored within 6000 ms of landscape. Later SHALL snooze prompts for ten minutes. macOS arrangement remediation SHALL require explicit consent describing a CoreGraphics call to make QUAKE non-primary, disable mirroring if requested, and move it to the far right. No host change SHALL occur before consent or in mock mode. Windows SHALL open display settings; DisplaySwitch /extend is a future platform-gated consent action. Sources: MAIN-056-058, SETTINGS-087-089.

#### Scenario: Portrait prompt snoozed
- **WHEN** confirmed portrait is dismissed with Later
- **THEN** no orientation prompt recurs for ten minutes

#### Scenario: Mirrored or misplaced strip
- **WHEN** a strip is mirrored or needs macOS arrangement repair
- **THEN** the app offers a consent dialog describing the proposed operation, and declining or Later makes no native call

#### Scenario: Consented layout repair fails
- **WHEN** an accepted automatic layout repair fails at the native boundary
- **THEN** management keeps the diagnostic visible instead of entering Screen, receives a safe native-failed diagnostic with recovery text and automatic layout consent prompts snooze for ten minutes from failure, while an explicit repair remains available and preserves the catalog failure identity
