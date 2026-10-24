## ADDED Requirements

### Requirement: Typed hardware command catalog

The protocol SHALL encode opcode 1 commands 0x02 buzzer [0 or 32..128], 0x03 mic [0|1], 0x04 screen power [0|1], 0x05 luminance [25..255], 0x06 knob LED [0|1], 0x10 keyboard [action, modifierMask, usage], and opcode 2 queries 0x03, 0x05, 0x2E with no payload. Keyboard actions SHALL be 0 release, 1 press, 2 tap; modifierMask and usage SHALL be bytes. Replies SHALL decode opcode 0x55: 0x00 ack success only at 0x90, 0x03 mic, 0x05 luminance and 0x2E [deviceName,major,minor,patch]. Frames SHALL use existing A3 length/checksum/report padding. Evidence MAIN-015,018..026 and SETTINGS-077,078.

#### Scenario: Independent byte fixtures
- **WHEN** each typed command is encoded and independently constructed replies are decoded
- **THEN** exact golden bytes, checksum and padding match; malformed known payloads and invalid values fail with catalog errors; unrelated commands remain ignored

### Requirement: Device keyboard route

Hotkeys SHALL default to device keyboard dispatch on each app launch, without persisting this mode. Explicit host mode SHALL use the supplied host adapter. Device mode SHALL encode one USB usage and the combined HID modifier bits, reject unsupported tokens and multiple ordinary keys before writing, and SHALL NOT silently use host injection. Atomic chords SHALL release after 50 ms and on cancellation. Monitoring's unrelated override SHALL be called monitoring override. Evidence MAIN-026,096.

#### Scenario: Device dispatch and explicit host mode
- **WHEN** a committed hotkey action runs in default mode, then the user selects host mode
- **THEN** the first action sends device press/release bytes with no host call and the next uses only the supplied host adapter

### Requirement: Confirmed mic and native panel brightness

The controls SHALL query mic and luminance before enabling their mutations. Mic toggle SHALL send the inverse current bit and change its snapshot only after success ack 0x90. Failed ack or write SHALL retain current state. Transactions SHALL serialize; timeout after 3000 ms or interrupted ack wait SHALL require reconnect before another correlated transaction. Luminance detents SHALL add/subtract 26, clamp to [25,255], and report round(100*value/255); this SHALL target only QUAKE cmd 0x05. Evidence MAIN-019,020 and SETTINGS-080,081.

#### Scenario: Rejected mic and minimum brightness
- **WHEN** an off mic write receives a failed ack, and a darker step runs at native 25
- **THEN** mic remains on and brightness remains 25 without an unnecessary write

### Requirement: Buzzer feedback and volume preference

Per serial defaults SHALL be buzzer enabled, alert volume 84 and LED always-on true. Slider positions SHALL be integers 0..96: zero maps to silence and 1..96 maps to round(32+(position-1)*96/95). Every nonzero sequence level SHALL use the configured volume; disabled or zero volume SHALL play nothing. Start SHALL be [[80,100],[0,10],[80,100]], end [[50,100],[0,1],[50,100],[0,1],[50,100]], error [[90,200]], busy [[60,60],[0,40],[60,60],[0,40],[60,60]]. Every step SHALL send zero after its duration and wait a 10 ms gap. Preview SHALL debounce 300 ms and play [[volume,80],[0,80],[volume,80]]. Preferences SHALL persist after 500 ms debounce and flush on teardown. Cancellation SHALL silence playback. Evidence MAIN-021..023, KNOB-066,067, SETTINGS-022,082.

#### Scenario: Latest preview only
- **WHEN** the volume changes repeatedly within 300 ms
- **THEN** only the latest nonzero preview runs and persistence records the latest serial preference

### Requirement: LED lock and settings

The Device settings SHALL show Firmware Version, Knob LED stays on, and Device Alert Volume using locale-en.json strings verbatim. Volume SHALL show the mapped value or X at zero; firmware SHALL show -- until a reply. OS lock SHALL send op1 cmd0x06 [0] and unlock [1] only for serials whose LED stays-on preference is false; true SHALL send nothing. UI SHALL expose disconnected, pending and failure states and prevent stale sessions from mutating a replacement device. Screen power SHALL be an explicit typed command available to the lifecycle owner. Evidence MAIN-018,024,025, SETTINGS-021,022,085.

#### Scenario: Serial-specific lock policy
- **WHEN** lock and unlock run for one serial with the preference false and another with it true
- **THEN** only the former receives LED off/on bytes and their preferences remain separate
