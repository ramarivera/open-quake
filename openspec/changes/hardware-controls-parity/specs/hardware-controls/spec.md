## ADDED Requirements

### Requirement: Typed hardware command catalog

The application SHALL implement the following typed hardware command catalog contract.

#### Scenario: Required behavior
- **WHEN** this feature is used
- **THEN** The protocol SHALL encode opcode 1 commands 0x02 buzzer [0 or 32..128], 0x03 mic [0|1], 0x04 screen power [0|1], 0x05 luminance [25..255], 0x06 knob LED [0|1], 0x10 keyboard [action, modifierMask, usage], and opcode 2 queries 0x03, 0x05, 0x06, 0x2E with no payload. Keyboard actions SHALL be 0 release, 1 press, 2 tap; modifierMask and usage SHALL be bytes. Replies SHALL decode opcode 0x55: 0x00 ack success only at 0x90, 0x03 mic, 0x05 luminance, 0x06 knob LED boolean state and 0x2E [deviceName,major,minor,patch]. Frames SHALL use existing A3 length/checksum/report padding. Evidence MAIN-015,018..026 and SETTINGS-077,078.

#### Scenario: Independent byte fixtures
- **WHEN** each typed command is encoded and independently constructed replies are decoded
- **THEN** exact golden bytes, checksum and padding match; malformed known payloads and invalid values fail with catalog errors; unrelated commands remain ignored

#### Scenario: Started writes finish before connection close
- **WHEN** disconnect or scope teardown begins during a native hardware write
- **THEN** teardown waits for that write before closing the handle, refuses new writes, and ordinary acknowledgment waits remain cancellable

### Requirement: Device keyboard route

Hotkeys SHALL default to device keyboard dispatch on each app launch, without persisting this mode. Explicit host mode SHALL use the supplied host adapter. Device mode SHALL encode one USB usage and the combined HID modifier bits, reject unsupported tokens and multiple ordinary keys before writing, and SHALL NOT silently use host injection. Atomic chords SHALL release after 50 ms and on cancellation. Monitoring's unrelated override SHALL be called monitoring override. Evidence MAIN-026,096.

#### Scenario: Device dispatch and explicit host mode
- **WHEN** a committed hotkey action runs in default mode, then the user selects host mode
- **THEN** the first action sends device press/release bytes with no host call and the next uses only the supplied host adapter

### Requirement: Confirmed mic and native panel brightness

The application SHALL implement the following confirmed mic and native panel brightness contract.

#### Scenario: Required behavior
- **WHEN** this feature is used
- **THEN** The controls SHALL query mic and luminance before enabling their mutations. Mic toggle SHALL send the inverse current bit and change its snapshot only after success ack 0x90. Failed ack or write SHALL retain current state. Transactions SHALL serialize; timeout after 3000 ms or interrupted ack wait SHALL require reconnect before another correlated transaction. Luminance detents SHALL add/subtract 26, clamp to [25,255], and report round(100*value/255); this SHALL target only QUAKE cmd 0x05. Evidence MAIN-019,020 and SETTINGS-080,081.

#### Scenario: Rejected mic and minimum brightness
- **WHEN** an off mic write receives a failed ack, and a darker step runs at native 25
- **THEN** mic remains on and brightness remains 25 without an unnecessary write

### Requirement: Buzzer feedback and volume preference

The application SHALL implement the following buzzer feedback and volume preference contract.

#### Scenario: Required behavior
- **WHEN** this feature is used
- **THEN** Per serial defaults SHALL be buzzer enabled, alert volume 84 and LED always-on true. Slider positions SHALL be integers 0..96: zero maps to silence and 1..96 maps to round(32+(position-1)*96/95). Every nonzero sequence level SHALL use the configured volume; disabled or zero volume SHALL play nothing. Start SHALL be [[80,100],[0,10],[80,100]], end [[50,100],[0,1],[50,100],[0,1],[50,100]], error [[90,200]], busy [[60,60],[0,40],[60,60],[0,40],[60,60]]. Every step SHALL send zero after its duration and wait a 10 ms gap. Preview SHALL debounce 300 ms and play [[volume,80],[0,80],[volume,80]]. Preferences SHALL persist after 500 ms debounce and flush on teardown. Cancellation SHALL silence playback. Evidence MAIN-021..023, KNOB-066,067, SETTINGS-022,082.

#### Scenario: Latest preview only
- **WHEN** the volume changes repeatedly within 300 ms
- **THEN** only the latest nonzero preview runs and persistence records the latest serial preference

#### Scenario: Slow preference save cannot overwrite a newer setting
- **WHEN** save A has started and setting B arrives before A completes
- **THEN** A finishes before the latest snapshot is committed, and the persisted preferences end with B even on teardown

#### Scenario: Replacing a preview during acknowledgment
- **WHEN** another preference change cancels a preview while its buzzer command awaits acknowledgment
- **THEN** the started exchange consumes its acknowledgment before cancellation silences playback, and the connected session remains usable

### Requirement: LED lock and settings

The application SHALL implement the following led lock and settings contract.

#### Scenario: Required behavior
- **WHEN** this feature is used
- **THEN** The Device settings SHALL show Firmware Version, Knob LED stays on, and Device Alert Volume using locale-en.json strings verbatim. Volume SHALL show the mapped value or X at zero; firmware SHALL show -- until a reply. OS lock SHALL query opcode 2 cmd0x06 before disabling lighting for a serial whose LED stays-on preference is false. It SHALL send op1 cmd0x06 [0] only when the ring was on, and unlock SHALL send [1] only once after that disable succeeded. A true preference SHALL leave the ring unchanged on lock. Changing the preference during a lock SHALL NOT discard an already-recorded restoration. A failed query SHALL leave lighting untouched through unlock. Duplicate lock events SHALL preserve the original state and duplicate unlock events SHALL send nothing. UI SHALL expose disconnected, pending and failure states and prevent stale sessions from mutating a replacement device. Screen power SHALL be an explicit typed command available to the lifecycle owner. Evidence MAIN-018,024,025, SETTINGS-021,022,085.

#### Scenario: Serial-specific lock policy
- **WHEN** lock and unlock run for one serial with the preference false and another with it true
- **THEN** only the former receives LED off/on bytes and their preferences remain separate

#### Scenario: Continuous volume adjustment and polling recovery
- **WHEN** the user drags through several volume positions while a request is pending, then polling recovers from a transient failure
- **THEN** the range stays enabled for the available session, shows the latest desired position, coalesces requests, previews the final value after 300 ms, and clears the transient failure message

#### Scenario: Ring already off or unreadable
- **WHEN** the ring is off before locking, or its state cannot be read
- **THEN** lock and subsequent unlock send no knob LED writes

#### Scenario: Duplicate lock and changed preference
- **WHEN** a previously-on ring was successfully disabled, another lock arrives, and the always-on preference changes before unlock
- **THEN** the original restoration is retained and unlock restores the ring once

### Requirement: Recovered state and confirmed live state

The application SHALL implement the following recovered state and confirmed live state contract.

#### Scenario: Required behavior
- **WHEN** this feature is used
- **THEN** For MAIN-013, SETTINGS-080 and SETTINGS-081, each serial SHALL retain its last acknowledged microphone and luminance values alongside buzzer, volume and LED preferences. A new session SHALL expose recovered defaults mic on and luminance 255 separately from live values. Live values SHALL remain unknown until queried or acknowledged. Synchronization flags SHALL reset per session and SHALL never persist. Missing replies and failed acknowledgments SHALL NOT promote recovered or requested values to confirmed state. Only a complete mic and luminance refresh SHALL mark synchronization successful. Legacy colon-serial migration SHALL preserve all persisted controls.

#### Scenario: Restart and failed writes
- **WHEN** an acknowledged mic or luminance change is saved and the application restarts
- **THEN** the same serial recovers those values, another serial gets defaults, and neither becomes live until its own replies arrive
- **AND** a rejected or missing acknowledgment leaves the saved and confirmed values unchanged

### Requirement: Bounded tones and meeting feedback

The application SHALL implement the following bounded tones and meeting feedback contract.

#### Scenario: Required behavior
- **WHEN** this feature is used
- **THEN** For AI-076, MAIN-021, MAIN-022, MGMT-408 and SETTINGS-082, the hardware session SHALL accept at most 64 tone pairs, each with a valid buzzer level and duration from 0 to 60000 ms, with total duration at most 120000 ms. Nonzero levels SHALL use the saved alert volume. Firework SHALL be [[80,50]]. Success SHALL be five [80,50] pulses separated by [0,1000]. Playback SHALL retain the existing per-step trailing silence and 10 ms gaps. A long tone SHALL use the saved alert volume and SHALL stop on explicit stop, master disable, interruption or teardown. Disabled or zero-volume preferences SHALL suppress audible writes. Meeting mark and completed processing transitions SHALL each emit their corresponding tone once, without replay on reads or reloads.

#### Scenario: Cancellation and master disable
- **WHEN** arbitrary playback or a long tone is interrupted, disabled, stopped or disconnected
- **THEN** it sends trailing silence, releases the tone owner and cannot resume on a replacement session

#### Scenario: Full tone table
- **WHEN** each named tone runs under a fake clock with a configured alert volume
- **THEN** the ordered levels and durations match the declared pairs, including firework and success, and zero-volume or disabled playback sends no audible command

### Requirement: Saved hardware control keys and hydration

The application SHALL implement the following saved hardware control keys and hydration contract.

#### Scenario: Required behavior
- **WHEN** this feature is used
- **THEN** For MAIN-080, MGMT-139, MGMT-140, MGMT-141, MGMT-205, MGMT-363, MGMT-367, MGMT-368, MGMT-369, SCREEN-037 and SCREEN-150, saved luminance, buzzer and mic keys SHALL execute through the validated action registry. Luminance directional actions SHALL preserve recovered level 1 clockwise and level 0 counterclockwise mapping. Buzzer and mic SHALL toggle the selected serial only. Every visible key of a type SHALL hydrate from that serial's confirmed state on load, profile change, reconnect and external change. On means default artwork and off means alternate artwork. Unknown live values SHALL remain unknown. Multi-action leaf controls SHALL disable grid editing and preserve cancellation and validation before effects.

#### Scenario: Multiple saved controls
- **WHEN** a saved Quick or meeting mic key executes, or a hardware state changes externally
- **THEN** every matching visible key reflects the acknowledged state and a stale or rejected session changes no artwork or hardware

### Requirement: Gaming mode and registered tile

The application SHALL implement the following gaming mode and registered tile contract.

#### Scenario: Required behavior
- **WHEN** this feature is used
- **THEN** For MAIN-096, MGMT-300, MGMT-355, SCREEN-107 and WIDGETS-016, gaming SHALL mean device keyboard output and normal SHALL mean native host keyboard output. Device output SHALL be the per-launch default. Mode changes SHALL update every gameMode consumer. Missing native permission SHALL fail explicitly. Held chords SHALL release their original route on cancellation. A gameMode tile SHALL preserve its 4 by 2 footprint and covered placeholders, expose active, inactive and failure states, and optionally show the foreground application's icon. Entering animation SHALL last 0.6 seconds, active pulse 2 seconds and appearance 0.2 seconds, respecting reduced motion. Saved configuration SHALL retain application, file or folder target and monitorAppView, and monitoring SHALL end when its owner ends.

#### Scenario: Two mode consumers
- **WHEN** a tile or device event changes input mode
- **THEN** both consumers show the same mode, and a new application lifetime starts in device mode

### Requirement: QUAKE lighting and permission ownership

The application SHALL implement the following quake lighting and permission ownership contract.

#### Scenario: Required behavior
- **WHEN** this feature is used
- **THEN** For MAIN-107, MAIN-108 and SETTINGS-024, lighting operations SHALL use an explicit serial and session with the existing HID owner. Only the exact QUAKE VID 0x4158 PID 0x514B usagePage 0xFF60 usage 0x61 SHALL be eligible. VIA permission SHALL be restricted to its configured loopback origin and selected serial. Other origins, collections and devices SHALL be denied. QMK protocol, menu probe, bindings and lighting batches SHALL serialize with hardware transactions, reject stale targets and restore delivery after exclusive work. Settings SHALL expose refresh, target selection and only source-qualified lighting controls. HUB2 and DISK2 remain excluded under GAP-MAP decision 10. For MGMT-406, QUAKE identity discovery SHALL require all four identity fields and a stable serial. The ARIS-68 keyboard portion is out of scope under Ramiro's approved exclusion of ARIS-only flows on 2026-10-26, recorded in Beads memory oq-scope-exclusions-shell and task open-quake-lih.11.27. ARIS SHALL NOT broaden QUAKE discovery.

#### Scenario: Denied origin and stale session
- **WHEN** another origin or collection requests permission, or a target is replaced before a batch
- **THEN** it acquires no handle and emits no command

#### Scenario: Exact QUAKE inventory on Linux
- **WHEN** Linux enumeration returns QUAKE hidraw collections, an ARIS-68 keyboard, another vendor, a wrong usage and an ambiguous serial
- **THEN** only the exact 4158:514B FF60:61 collection is eligible and ambiguous serials fail closed
- **AND** udev permissions grant the active local user access only to QUAKE, without world-writable rules

### Requirement: Live localized hardware controls

The application SHALL render hardware settings, qualified QMK lighting controls and game-mode consumers through bundled copy for all eight supported application locales. Labels, accessibility names, file/folder/application picker actions, operational states and failures SHALL follow the current saved locale without remounting controls, restarting hardware requests or replacing drafts. Protocol identifiers, error codes, serials and user target paths SHALL retain their original values.

#### Scenario: Change language with mounted hardware consumers
- **WHEN** the saved application language changes while hardware controls, a target draft, a game tile or a failure message are mounted
- **THEN** their visible copy and accessibility names update immediately in the new locale, including existing failures and lighting save states
- **AND** the target draft, selected device and pending hardware operation remain intact

### Requirement: Bounded hardware lifecycle and exclusive handoff

The application SHALL bound hardware lifecycle waits and release exclusive handoffs.

#### Scenario: Hardware lifecycle guarantees
- **WHEN** hardware operations overlap or their owners end
- **THEN** the application SHALL settle raw reply waits within 1500 milliseconds even inside a reversible probe and fail pending waits before native handle close. Long-tone startup SHALL settle on every exit, including cancellation while awaiting the tone lock. Disabling the buzzer or setting zero volume SHALL stop active sequences and await trailing silence. Replacement sessions SHALL flush the preceding owner's acknowledged preferences before reading storage and transferring ownership. Native MeetAI mic touches SHALL activate only the saved hardware key. Host chord release SHALL preserve remaining modifier flags on key-up.

#### Scenario: Interrupted or silent hardware
- **WHEN** a probe loses a reply, a queued long tone is cancelled, or the buzzer is disabled during a long sequence
- **THEN** the request settles, owned locks become available, and teardown completes with silence where delivery is available

#### Scenario: VIA lease ends
- **WHEN** its selected device disappears from enumeration, its permission is revoked, or its owning document navigates or ends
- **THEN** the established VIA lease is denied and released, native reconnect resumes, and unrelated chooser events do not release another lease

#### Scenario: Linux modifier-only host chords
- **WHEN** explicit host mode holds or taps a chord containing only modifiers
- **THEN** the Linux keyboard adapter posts only those modifiers, keeps them held until release, and releases them in reverse order without posting ordinary usage zero
- **AND** chords containing an ordinary key preserve their existing down/up order and 50 millisecond tap duration

#### Scenario: VIA handoff during reconnect
- **WHEN** VIA requests ownership while its selected native bus is discovering or opening a connection
- **THEN** handoff waits for in-flight acquisition to settle and closes its native handle before fulfilling the lease, including an uninterruptible late open
- **AND** the selected bus cannot acquire another native handle until the lease ends, other serials retain their independent ownership, and native reconnect resumes when the lease ends
