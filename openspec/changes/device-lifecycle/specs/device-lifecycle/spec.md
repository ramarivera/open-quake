# Spec Delta

## Purpose

Keep the desktop connected to one QUAKE and its strip across transient USB, display, sleep and lock events, with diagnostics and consent for host display changes.

## ADDED Requirements

### Requirement: Exclusive application instance
The app MUST acquire its single-instance lock before windows or device access. A duplicate MUST exit with an explanation and the existing instance MUST restore and focus management on all platforms. It MUST NOT terminate another process. Sources: MAIN-103, MAIN-120; open-quake-l86.12.

#### Scenario: Second launch
- **WHEN** the lock is unavailable
- **THEN** no device is discovered or opened and no windows are created, and the process quits with an already-running explanation

#### Scenario: Existing instance activated
- **WHEN** a second-instance event arrives
- **THEN** the existing management window is restored if minimized, shown, and focused

### Requirement: Screen pairing transaction
The app SHALL serialize discovery, observe display disappearance before sending opcode 1 command [04,00], identify the unique removed QUAKE candidate, send [04,01], and bind when that display returns or a unique matching replacement appears. It SHALL restore screen power on timeout, interruption and failure. A transaction SHALL time out after 30 seconds and leave unresolved displays hidden rather than guess. Locked sessions SHALL defer discovery. Sources: MAIN-024, MAIN-042, MAIN-045, MAIN-050, MAIN-053, SETTINGS-083.

#### Scenario: Blanking identifies the strip
- **WHEN** two candidate displays exist and only one disappears during blanking
- **THEN** discovery powers the screen back on and binds the returning candidate rather than the first label or size hit

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

### Requirement: Display prompts and explicit host consent
The app SHALL detect mirroring and portrait orientation, using displayMode English strings. Portrait SHALL persist 2500 ms and be ignored within 6000 ms of landscape. Later SHALL snooze prompts for ten minutes. macOS arrangement remediation SHALL require explicit consent describing a CoreGraphics call to make QUAKE non-primary, disable mirroring if requested, and move it to the far right. No host change SHALL occur before consent or in mock mode. Windows SHALL open display settings; DisplaySwitch /extend is a future platform-gated consent action. Sources: MAIN-056-058, SETTINGS-087-089.

#### Scenario: Portrait prompt snoozed
- **WHEN** confirmed portrait is dismissed with Later
- **THEN** no orientation prompt recurs for ten minutes

#### Scenario: Mirrored or misplaced strip
- **WHEN** a strip is mirrored or needs macOS arrangement repair
- **THEN** the app offers a consent dialog describing the proposed operation, and declining or Later makes no native call
