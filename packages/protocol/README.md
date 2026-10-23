# Protocol kernel

Pure functions and Effect Schema codecs for QUAKE HID. No device access,
Node-specific buffers, timers, layers or Effect runtime are required.

```ts
import { Either, Schema } from "effect";
import {
  dfuCommand, encodeHidReport, wrapShortCommand, ShortCommandFrame,
} from "@open-quake/protocol";

// Either<Uint8Array, ProtocolError>: [00,A3,03,01,2F,03,33,...zero padding].
const report = wrapShortCommand(dfuCommand()).pipe(Either.flatMap(encodeHidReport));

// Equivalent logical-frame Schema codec, returning Schema ParseError on failure.
const decoded = Schema.decodeUnknownEither(ShortCommandFrame)(
  [0xa3, 3, 1, 0x2f, 3, 0x33],
);
```

Use the `Either` functions to retain catalog error tags/codes and private parsing
causes. Schema adapters report catalog codes as parse issues. They validate the
same layouts. All byte decoders accept arrays and Uint8Array, including Node
Buffer. Encoder inputs are validated at runtime as well as typed statically.

- `QUAKE_IDENTITY`, individual `QUAKE_*` constants and `isQuakeInterface` identify
  the inventory's `4158:514B` collection, usage `61`, usagePage `FF60`.
- `encodeHidReport` packs up to 32 bytes into a 33-byte host report with ID zero.
  `decodeHidReport` returns the full 32-byte body from a 32-byte read or 33-byte
  report. `HidReport` is the corresponding canonical full-body Schema codec.
- `wrapShortCommand` / `unwrapShortCommand`, `ShortCommandFrame` use
  `{ opCode, cmdId, subData }`. `dfuCommand()` supplies the confirmed DFU bytes.
- `wrapJsonFrame` / `unwrapJsonFrame`, `JsonFrame` use JSON values with UTF-8
  encoding and a big-endian 16-bit byte length. Values follow standard JSON
  serialization semantics, including negative zero becoming zero.
- `wrapResourceFrame` / `unwrapResourceFrame`, `ResourceFrame` use
  `{ opCode, metadata: [byte, byte, byte, byte, byte], sequence, payload }`.
  `resourceMetadata` interprets known metadata structures without assigning image
  or key-mapping semantics. Reserved fields and unknown opcodes survive intact.
- `decodeKeyMatrix` / `encodeKeyMatrix`, `KeyMatrixReport` preserve three
  reserved bytes, fifteen states and thirteen trailing bytes. `firstMatrixPress`
  returns an Option for the first state equal to one, in `row,column` order.
- `encodeQmkCommand` models version, lighting set/get and save requests.
  `decodeQmkResponse(request, bytes)` checks the request echo, extracts a
  big-endian version or requested values, or returns an acknowledgment. QMK
  responses accept compact or full physical reports. `wrapQmkCommand`,
  `decodeQmkCommand(bytes, parameterLength)`, and
  `qmkCommandReport(parameterLength)` support raw request round-trips. The caller
  supplies parameter count because padding cannot be distinguished from zero data.

The original `checksum`, `frameHostCommand`, `verifyDeviceReport` and
`FRAME_HEADER` exports remain available. `frameHostCommand` retains its compact,
byte-normalizing behavior for compatibility; prefer the validated short-command
codec for new callers. `verifyDeviceReport` now checks the declared length and
allows zero padding in full HID reports.

Logical A1/A2 frames may exceed one HID report. `encodeHidReport` returns a typed
size failure for those frames. Transport fragmentation, reassembly, timing,
acknowledgments, JPEG data semantics and sequence rollover need further evidence.
Other short-command opcode meanings, matrix release semantics and physical key
placement remain unknown. The firmware/template's alternate USB identity is
recorded in the OpenSpec design. No hardware verification has been performed.

Byte-layout sources are cited in implementation comments. Research lives only in
`/Users/ramarivera/dev/open-quake/.context/` and the main checkout's ignored
`.agents/skills/dark-encyclopedia/`; none is copied into this package.
