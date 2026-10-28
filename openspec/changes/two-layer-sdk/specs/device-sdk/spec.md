# Spec Delta

## Purpose
Public surface of the protocol kernel and the device conductor wrapper that
every open-quake consumer uses to talk to a QUAKE device.

## ADDED Requirements

### Requirement: Desktop has one service graph owner
The production desktop main process SHALL compose its domain layers into one
application Layer graph owned by one ManagedRuntime. IPC registrations SHALL
cancel and join their own work before the root disposes that runtime exactly
once. A module teardown SHALL NOT dispose services used by another consumer.
The graph SHALL preserve catalog errors and operation-specific diagnostics.

#### Scenario: Quit while work is active
- **WHEN** the desktop quits with active domain workers
- **THEN** it stops incoming work, joins the workers and awaits graph finalizers before quitting
- **AND** the diagnostic sink remains available through the finalizers

#### Scenario: Shared service consumers
- **WHEN** two desktop registrations use the same service layer
- **THEN** they observe the same acquired service instance
- **AND** stopping one registration does not dispose the application graph

#### Scenario: Reset or import after meeting history is loaded
- **WHEN** the user confirms clearing data or importing a backup
- **THEN** main finishes the graph-bound request and stops writers and graph finalizers before changing owned data
- **AND** no finalizer recreates deleted history or overwrites the replacement
- **AND** a cleanup failure retains the existing data and reports its catalog identity before exit

### Requirement: Protocol layer is pure
`packages/protocol` SHALL perform no I/O. Its deterministic plain functions
SHALL return typed `Either` failures for invalid inputs, and its Effect Schema
codecs SHALL describe the same byte layouts without requiring an Effect runtime.
Existing `checksum`, `frameHostCommand`, `verifyDeviceReport`, and `FRAME_HEADER`
exports SHALL remain usable by the existing device consumer.

#### Scenario: Host command framing
- **WHEN** a host command with flag `f` and payload `p` is framed
- **THEN** the result is `[0xA3, len(p)+1, f, ...p, (f + sum(p)) % 0xFF]`

#### Scenario: Corrupt device report
- **WHEN** a device report's declared body checksum does not match
- **THEN** verification reports it invalid without throwing

### Requirement: Discovery constants identify the inventory device
The kernel SHALL export usagePage `0xFF60`, usage `0x61`, vendor ID `0x4158`,
and product ID `0x514B`, and a pure predicate matching all four fields.

#### Scenario: Filter unrelated HID collections
- **WHEN** a descriptor differs in any of the four identity fields
- **THEN** the predicate rejects it without enumerating or opening hardware

### Requirement: Physical HID reports have explicit framing
The kernel SHALL encode host reports as exactly 33 bytes with report ID `0x00`
and a 32-byte zero-padded body. It SHALL decode 32-byte reads or 33-byte reports
with ID zero, reject other sizes/IDs, and reject an oversized single-report body.
Logical frame codecs SHALL use declared lengths and exclude report padding.
Transport fragmentation SHALL remain outside this kernel contract.

#### Scenario: Pack a short command
- **WHEN** a compact command fits within 32 bytes
- **THEN** report encoding prepends zero and pads to exactly 33 bytes

#### Scenario: Oversized logical frame
- **WHEN** a logical JSON or resource frame exceeds 32 bytes
- **THEN** its logical codec succeeds within its length limit and single-report packing returns a typed size failure

### Requirement: JSON frames round-trip both directions
The kernel SHALL wrap and unwrap `0xA1` JSON frames as
`[A1, lengthHi, lengthLo, ...UTF8(JSON), checksum]`, with big-endian byte length
and checksum over JSON bytes only. It SHALL reject malformed UTF-8, invalid JSON,
non-JSON values, truncated lengths and corrupted checksums. JSON values SHALL
follow standard JSON serialization semantics, including normalization of negative
zero to zero. Round-trip identity SHALL apply to values in that canonical form.

#### Scenario: Unicode config or event
- **WHEN** a JSON value containing Unicode is encoded then decoded
- **THEN** the original JSON value is recovered and length counts UTF-8 bytes

### Requirement: Resource envelope support is partial
The kernel SHALL wrap and unwrap `0xA2` envelopes as
`[A2, lengthHi, lengthLo, opcode, ...metadata5, sequence, ...payload, checksum]`.
Length SHALL count seven metadata/control bytes plus payload; checksum SHALL
cover that body. It SHALL preserve unknown opcodes, all five metadata bytes,
sequence and opaque payload, without claiming resource interpretation.
Opcode 2 metadata SHALL expose resource type, row, column and two reserved bytes;
opcode 1 SHALL expose a prefix and four-byte big-endian identifier.
JPEG encoding, key-to-icon mapping, image chunking, acknowledgments, sequence
rollover and transfer timing SHALL remain explicitly unverified P-tier behavior.

#### Scenario: Opaque resource round-trip
- **WHEN** an envelope contains reserved metadata or an unknown opcode
- **THEN** decoding and re-encoding preserves those bytes exactly

#### Scenario: Padded resource report
- **WHEN** an A2 frame occupies part of a zero-padded HID report
- **THEN** resource payload ends at its declared checksum and excludes padding

### Requirement: Short commands have exact lengths and checksums
The kernel SHALL wrap and unwrap `0xA3` frames as
`[A3, bodyLength, opcode, cmdID, ...subData, checksum]`, where bodyLength counts
opcode, cmdID and subData, excludes checksum, and fits in one byte. Checksum
SHALL be the byte sum modulo `0xFF`, not modulo `0x100`.

#### Scenario: Keep-alive known vector
- **WHEN** query flag 2 and command `EF` are wrapped
- **THEN** the compact bytes are `[A3,02,02,EF,F1]`

#### Scenario: Malformed declared length
- **WHEN** a frame declares an incomplete body or carries unexplained trailing bytes
- **THEN** decoding returns a typed failure even if a trailing byte matches a checksum

### Requirement: DFU has a confirmed command
The kernel SHALL expose a DFU command constructor for opcode `01`, cmdID `2F`,
subData `[03]`, producing `[A3,03,01,2F,03,33]` before report padding.
The hardware-controls catalog SHALL additionally type set commands 02,03,04,05,06,10, queries 03,05,2E and their 55 replies (MAIN-015,018..026; hardware-controls-parity). The remaining opcode catalog SHALL remain partial: unknown opcode/cmdID bytes
SHALL survive generic round-trips without inferred behavior.

#### Scenario: Encode DFU without hardware
- **WHEN** a consumer requests the confirmed DFU short command
- **THEN** the encoder returns the known vector without rebooting or opening a device

### Requirement: Key matrix presses use recovered offsets
The kernel SHALL decode type `01` matrix reports with three reserved bytes and
15 state bytes at offsets 4..18. The first state equal to `01` SHALL map to
row `floor(index/5)+1`, column `(index%5)+1`, keyCode `row,column`, and keyAction
zero. It SHALL expose the states and preserve remaining report bytes.
It SHALL NOT invent a release event or a physical layout from an empty matrix.

The panel SHALL derive successful up edges when the first pressed cell changes or
becomes empty, suppress repeated downs while a cell stays pressed, and retain
held hotkeys until release. All edges SHALL pass through the complete strip key
handler, including ordinary KeyRuntime activation, voice, meeting and emoji.
A-to-B transitions SHALL release A before pressing B. Disconnect, selection reset
and unmount SHALL cancel outstanding contacts. The pure kernel SHALL continue
exposing raw state without inventing protocol release events.

Sources: MAIN-008/028, SCREEN-144, PR #112 finding 4380831182. Recovered DK-Suite
0.4.95 `src/main/DeviceControl/Connections/ProtocolUtil.js:59-75` and
`app-resources/background.js`, character offset 642333, emit the first pressed
cell with keyAction 0 and discard empty matrices. The decoder supplies no release
or A-to-B cancellation. `src/views/DKQuake/QuakeScreenView.vue:2895-2984` routes down
and successful up through the full key handler;
`src/views/DKQuake/RemoteSocketClient.vue:162-168` forwards both actions. Deriving
contact transitions in the panel corrects the recovered decoder's incomplete
handling, without changing the wire protocol.

#### Scenario: Ordinary matrix contact
- **WHEN** a mounted panel receives the same pressed cell repeatedly and then two empty matrices
- **THEN** KeyRuntime executes its ordinary action exactly once on the first empty matrix
- **AND** another full contact executes the action once again

#### Scenario: Legacy matrix hold and replacement
- **WHEN** repeated reports select a hotkey cell, followed by a different cell and an empty report
- **THEN** one down holds the hotkey until the change, up releases it, and the next cell gets down and successful up
- **AND** disconnect cancels any remaining contact

#### Scenario: Replacement arrives during an in-flight down
- **WHEN** the mounted panel receives matrix A followed by B while A's down acknowledgement is delayed
- **THEN** the device's requests complete in A-down, A-up, B-down order, including across different key codes
- **AND** repeated frames do not add contacts and disconnect cancels queued contacts while releasing the started contact
- **AND** a mounted production dispatcher and KeyRuntime regression uses TestClock to prove B waits for A, covering PR #120 finding 4381194049 and MAIN-008/028, SCREEN-144

#### Scenario: Matrix contact selects knob focus
- **WHEN** a mounted panel receives a completed matrix contact on a knob-capable key
- **THEN** its successful release emits the same quake-strip-tile-tap event as native touch, and the mounted KnobPanelLayer updates the production KnobModel focus
- **AND** repeated held or empty frames add no taps, non-focusable contacts clear focus, and disconnect cancellation emits no tap
- **AND** this covers PR #120 finding 4381208066 and MAIN-008/028, SCREEN-144; recovered DK-Suite 0.4.95 src/views/DKQuake/QuakeScreenView.vue:2984-2990 likewise changes knob focus on successful up

#### Scenario: Legacy matrix emoji
- **WHEN** repeated matrix reports select an emoji tile, followed by an empty matrix
- **THEN** its owning emoji handler receives exactly one successful release for the captured profile and page

#### Scenario: Last matrix cell pressed
- **WHEN** only state index 14 is one
- **THEN** the first press is key `3,5`

#### Scenario: No press
- **WHEN** no matrix state equals one
- **THEN** decoding returns no press and no synthetic release

### Requirement: QMK raw commands are distinct from matrix events
The kernel SHALL encode QMK command `01` for protocol version, `07` for
backlight set, `08` for backlight get and `09` for save, including optional save
channel. It SHALL validate response prefixes, decode the version as big-endian,
extract the requested backlight value length and reject truncated responses.
Response decoding SHALL use the originating command so command `01` is not
mistaken for an unsolicited matrix report.

#### Scenario: Protocol version response
- **WHEN** a version request receives body `[01,12,34,...padding]`
- **THEN** the decoded version is `0x1234`

#### Scenario: Backlight response belongs to another selector
- **WHEN** a backlight get response echoes a different selector
- **THEN** decoding returns `QmkResponseMismatch`

### Requirement: Protocol failures use catalog identities
Protocol failures SHALL be `Schema.TaggedError` leaves with stable catalog
code, category, message and policy. Errors caused by parsing SHALL retain the
original cause non-enumerably and serialize only bounded fixed diagnostics,
without payload bytes, JSON text or raw parser messages.

#### Scenario: JSON parsing failure contains sensitive text
- **WHEN** malformed JSON produces a protocol failure
- **THEN** consumers can branch on its tag/code, recover its private cause, and serialize it without exposing the input text

### Requirement: Scoped device connection
The device conductor SHALL match all four USB identity fields, own each opened
handle as a scoped resource, and own its read and keep-alive fibers in that
connection scope. It SHALL stop workers before closing the handle and SHALL
close each successful acquisition exactly once.

#### Scenario: Scope closes
- **WHEN** a connected caller closes its scope
- **THEN** the keep-alive fiber stops and the transport handle closes exactly once
- **AND** advancing the test clock causes no further writes

#### Scenario: Disconnect during native write
- **WHEN** disconnect is requested while a keep-alive write is in flight
- **THEN** the write finishes before the handle closes

#### Scenario: No matching hardware
- **WHEN** discovery returns no descriptor matching VID `0x4158`, PID `0x514B`, usage page `0xFF60`, and usage `0x61`
- **THEN** connect fails with `QuakeDeviceNotFound` and opens no handle

### Requirement: Default and custom transport layers
`QuakeDevice.Default` SHALL declare its native transport dependency. Custom
transport composition SHALL use `QuakeDevice.DefaultWithoutDependencies` so
tests and consumers can replace native I/O explicitly. `discover()` SHALL return
matching control interfaces without opening hardware or starting keep-alives.

#### Scenario: Default layer
- **WHEN** a consumer provides only `QuakeDevice.Default`
- **THEN** the service can discover and connect through the native transport

#### Scenario: Read-only discovery
- **WHEN** enumeration returns the control collection alongside keyboard, consumer, and system collections
- **THEN** discovery returns only the matching control interface and performs no open or write

### Requirement: Connection keep-alive
A connection SHALL write a 33-byte report consisting of report ID zero,
`frameHostCommand(2, [0xEF])`, and zero padding on a configurable positive,
finite interval. The default SHALL be 15 seconds and the first write SHALL
occur 1000 ms after connect. Failed pings SHALL receive at most three retries,
500 ms apart, before failing the session. Subsequent pings SHALL run every
15 seconds by default. Encoding SHALL use protocol kernel codecs.
Audit rows MAIN-017 and SETTINGS-076.

#### Scenario: Configured cadence
- **WHEN** a connection uses a 1-second interval
- **THEN** no write occurs before 1 second and three writes exist after 3 seconds

### Requirement: Broadcast typed device events
The connection SHALL expose an Effect Stream for knob rotation, knob press,
supported checksummed touch points, keep-alive pongs, and disconnect events.
It SHALL preserve input ordering for active subscribers, broadcast to each
subscriber, and replay termination to late subscribers. It SHALL retain upstream
exception identity privately and expose only scrubbed diagnostics.
Unchecked reports from a separate touch collection SHALL remain unverified.

#### Scenario: Read fails
- **WHEN** the transport emits a read failure
- **THEN** the handle closes, subscribers receive a disconnect event and `QuakeHidReadFailed`, and the keep-alive fiber stops

#### Scenario: Unknown opcode uses the touch command number
- **WHEN** a valid checksummed report uses opcode `55` and command `1A` without a touch payload
- **THEN** it produces no event, leaves the connection open, and later knob events and keep-alives continue

### Requirement: Device consumes protocol codecs and failures
The device adapter SHALL delegate physical report and short-command framing,
length, padding and checksum validation to `@open-quake/protocol`. It SHALL
preserve protocol catalog failure identities through the event stream and JS
facade. Device I/O catalog errors SHALL translate native exceptions at their
discovery, open, read, write and close boundaries.

#### Scenario: Corrupt control report reaches a subscriber
- **WHEN** a report carries an invalid checksum
- **THEN** the connection closes and subscribers receive `FrameChecksumMismatch` with code `QUAKE.PROTOCOL.CHECKSUM_MISMATCH`

#### Scenario: Kernel rejects encoding or decoding
- **WHEN** a protocol codec returns a catalog error
- **THEN** the connection closes, preserves the error's original instance and private cause through Effect tracing, and serializes only scrubbed diagnostics

### Requirement: ManagedRuntime JavaScript facade
The device package SHALL expose a Promise/callback facade that owns its Effect
runtime, connects without consumer Effect code, registers its event subscription
before connect resolves, and supports idempotent asynchronous disconnect.

#### Scenario: Plain JS consumer
- **WHEN** a plain JavaScript program uses the device entry point
- **THEN** it can connect and receive device events without constructing an Effect runtime itself

#### Scenario: Plain JavaScript subscription
- **WHEN** a consumer subscribes and awaits connect
- **THEN** incoming knob events invoke the callback and disconnect releases the connection and runtime

### Requirement: Canonical HID identity and native discovery
Audit rows MAIN-004, MAIN-006, MAIN-014 and SETTINGS-073. The transport SHALL
prefer read-only Win32 enumeration on Windows, permanently select node-hid
on native failure and report that failure once. Control filtering SHALL retain
all four USB identity fields. HID serials SHALL remove colons. Imported `ws_`
aliases SHALL resolve to the same physical serial without creating another
handle. Ambiguous normalized serials SHALL fail discovery. A newer connection
for a serial SHALL close the prior session before opening its replacement.
All macOS opens SHALL request nonexclusive access.

#### Scenario: Native enumeration fails
- **WHEN** the first Windows enumeration throws
- **THEN** that call and subsequent scans use node-hid and the native operation is never retried

#### Scenario: Alias and stale handle
- **WHEN** serial `AB:CD` reconnects through alias `ws_ABCD`
- **THEN** its canonical identity is `ABCD`, its old handle closes once and no parallel handle survives

### Requirement: Explicit framing compatibility
Audit row MAIN-007. The default SHALL retain validated padded 33-byte reports.
An explicit DK-Suite framing mode MAY emit compact short commands with report
ID zero and compact A1 frames without report ID. Transport errors on macOS
SHALL retry at most twice after 10 ms sleeps, never after a successful write.
Partial native writes SHALL fail without retry to avoid duplicating delivery.

#### Scenario: Transient native write failure
- **WHEN** a macOS write rejects twice and then succeeds
- **THEN** exactly three writes occur, each separated by 10 ms, with no fourth write

### Requirement: Live input dispatch
Audit row MAIN-008. The live read adapter SHALL decode A1 JSON, A2 resource
envelopes and 01 matrix reports through the protocol codecs. It SHALL assemble
split wide envelopes in order within one connection, preserve resource metadata
and sequence, and reject checksum or truncation errors. Replaced sessions SHALL
never deliver their remaining bytes into the replacement.

#### Scenario: Independent input fixtures
- **WHEN** independent A1, split A2 and matrix fixtures enter the read stream
- **THEN** subscribers receive typed JSON, resource and matrix events in order

### Requirement: Safe mock startup
Audit row MAIN-005. Explicit mock runs SHALL never open native HID. Custom fake
device fixtures SHALL be rejected in packaged builds. Test-only parent guards
SHALL quit on parent loss and dispose their timer on shutdown. Firmware safety
limits SHALL not be weakened through environment overrides.

#### Scenario: Packaged custom fixtures
- **WHEN** a packaged application starts with custom fake-device JSON
- **THEN** startup fails before importing the production composition root

### Requirement: Incoming device images have bounded decoded dimensions
Audit rows MAIN-008 and SCREEN-144. Before publishing an A2 JPEG to a renderer
image element, the resource receiver SHALL enforce both 8 MiB compressed bytes
and 64 million decoded pixels, matching the desktop image budget. It SHALL read
JPEG SOF dimensions before rendering and reject missing, zero, truncated,
conflicting or excessive dimensions, including progressive JPEG frames.

#### Scenario: Small compressed image expands beyond the pixel budget
- **WHEN** an otherwise valid bounded A2 image declares a 65535 by 65535 JPEG frame
- **THEN** no data URL is published or rendered
- **WHEN** a complete JPEG frame is within the decoded-pixel budget
- **THEN** ordinary sequenced resource assembly still publishes it to its target cell

### Requirement: Management exerciser isolates fixture state and records contract failures
The opt-in management exerciser SHALL reset targeted scenarios through the fixture store owner before each scenario and before the page crawl. It SHALL identify profile controls independently of names and generated IDs, explore controls revealed by a selector before restoring it, and record unsuccessful replies across the exercised IPC contracts. It SHALL keep windows hidden and use fixture data only.

#### Scenario: Move followed by swap
- **WHEN** an empty-cell move succeeds before a swap scenario
- **THEN** the swap starts with the original fixture key positions and revision
- **AND** the later page crawl starts with the original profiles

#### Scenario: Generated profile is renamed or reordered
- **WHEN** profile rows change names or positions during exploration
- **THEN** controls retain their profile identity and generated rows do not recursively duplicate themselves

#### Scenario: Selector reveals controls
- **WHEN** changing a selector reveals additional controls
- **THEN** the exerciser explores those controls before restoring the original selection

#### Scenario: Invalid emoji package name
- **WHEN** a package rename exceeds 20 weighted units
- **THEN** the UI keeps the draft editable and shows guidance beside the field without sending the invalid command
- **AND** the domain validation remains enforced for other callers

#### Scenario: Duplicate profile name
- **WHEN** a profile is renamed to an existing profile name
- **THEN** persistence preserves the previous name and the UI shows localized guidance to choose another name
- **AND** the exerciser distinguishes this expected rejection from valid unique rename samples

#### Scenario: Repeated sweep and failing report finalization
- **WHEN** the exerciser runs three times on the same source
- **THEN** its pass and failure records are identical apart from documented timing tolerances
- **AND** it exits with failure if report finalization throws

#### Scenario: Overlong rename remains editable without stealing focus
- **WHEN** a pasted ASCII or weighted name exceeds the package-name limit
- **THEN** the full draft stays editable with an associated error and no rename command is sent
- **AND** unrelated updates do not focus the rename input again

#### Scenario: Selector restoration or report finalization fails
- **WHEN** a selector cannot restore its original value
- **THEN** the exerciser records that restoration failure and continues exploring the page
- **WHEN** report finalization throws
- **THEN** it logs the exception before exiting with failure

### Requirement: Probe serial-byte rejection
The hardware query probe SHALL reject evidence containing the selected device serial as text, numeric arrays or Uint8Array views including Buffer. It SHALL inspect only the bytes belonging to a view.

#### Scenario: Typed evidence bytes
- **WHEN** serial bytes occur in a nested typed byte view
- **THEN** the probe rejects the evidence before writing it
- **AND** bytes outside the view do not become evidence
