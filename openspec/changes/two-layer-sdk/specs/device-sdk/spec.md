# Spec Delta

## Purpose
Public surface of the protocol kernel and the device conductor wrapper that
every open-quake consumer uses to talk to a QUAKE device.

## ADDED Requirements

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
The broader opcode catalog SHALL remain partial: unknown opcode/cmdID bytes
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

### Requirement: Non-Effect consumers are supported
`packages/device` SHALL expose an entry point that a consumer can use without
importing or running Effect.

#### Scenario: Plain JS consumer
- **WHEN** a plain JavaScript program uses the device entry point
- **THEN** it can connect and receive device events without constructing an Effect runtime itself
