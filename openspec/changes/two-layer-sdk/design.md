# Design

## Context

Settled by the wayfinder map (`open-quake-2qs`): Effect devs first, non-Effect
devs covered; protocol layer uses Effect Schema only; governing skills are
`effect-conductor`, `open-quake-errors`, `effect-best-practices`.

## Open decisions

1. **Proposed (pending Ramiro)**: keep `@open-quake/protocol` as the pure
   kernel. Export schemas, `encode*` / `decode*` and `wrap*` / `unwrap*`
   functions returning `Either`, plus discovery constants. Preserve `checksum`,
   `frameHostCommand`, `verifyDeviceReport`, and `FRAME_HEADER`. Use
   `QuakeDevice` for the device conductor. This follows effect-conductor's
   contracts/invariants split without putting a service or runtime in pure code.
2. **Proposed (pending Ramiro)**: protocol owns catalog-backed
   `ProtocolInputInvalid`, `FrameSizeInvalid`, `FrameChecksumMismatch`,
   `FrameTypeUnsupported`, `ProtocolJsonInvalid`, and `QmkResponseMismatch`
   Schema.TaggedError leaves. Device owns separate discovery/open/read/write/
   timeout/closed failures at its actual I/O boundaries. Preserve original
   causes privately, serialize only fixed diagnostics, and handle tags/codes.
   The protocol catalog is exported for later composition into a shared kernel;
   no dependency on device errors. This applies open-quake-errors without a
   generic catch-all error or a dependency on an out-of-lane shared package.
3. **Proposed (pending Ramiro)**: expose an Effect `Stream` backed by a scoped
   `PubSub` internally, and a callback subscription returning an unsubscribe
   function for plain JS. The conductor owns fan-out, ordering, and scope.
   Callers should not have to manage the internal PubSub.
4. **Proposed (pending Ramiro)**: the device conductor starts and interrupts
   the keep-alive fiber with its connection scope. Use the observed 15-second
   interval and stop on disconnect/disposal. Caller scope bounds the connection,
   rather than requiring callers to implement an independent ping timer.
5. **Proposed (pending Ramiro)**: expose a Promise/callback facade backed by
   one owned `ManagedRuntime`, with explicit asynchronous disposal. Effect users
   use the service/layer directly. Keep the runtime an implementation detail
   of the JS facade so there is one lifecycle and one error translation boundary.

These recommendations are not approved decisions. L1 implements only the
protocol kernel; L2 owns `packages/device`. Ramiro's decisions and their Beads
record remain parent follow-up work.

## Protocol evidence and limits

Read local-only research from `/Users/ramarivera/dev/open-quake/`:

- `.context/research/dk-suite-feature-inventory.md`, section 1.
- `.context/decokee-quake-fw/docs/PROTOCOL.md` and
  `.context/decokee-quake-template/modules/quake-device/protocol.js` agree on
  short-command body/checksum and DFU `[A3,03,01,2F,03,33]`.
- `.agents/skills/dark-encyclopedia/dk-suite-introspeccion/artifacts/ProtocolUtil.js.head.txt`
  resolves A1/A2 big-endian lengths and matrix offsets. Implementations are
  independently written; research files are never redistributed.

The firmware doc's incoming-length prose includes the checksum, but the actual
template parser and recovered wrapper exclude it. Follow the executable layout:
A3 length is `opcode + cmdID + subData`, with checksum at `2 + length`.
The doc lists `5012:6817`; the inventory/recovered DK-Suite instead identifies
`4158:514B`. Export the requested latter identity with usagePage `FF60`, usage
`61`; selecting another hardware revision is a device-layer decision.

Logical frames and physical reports are separate contracts. Host writes are
33 bytes, report ID zero plus 32 bytes; reads may already omit the ID. One-report
packing rejects oversized frames. A1/A2 logical codecs support their 16-bit
lengths without inventing transport fragmentation or timing. Padding is excluded
from checksum/JSON/resource data. Decoders accept compact frames or zero-padded
reports and reject inconsistent length, truncated data, and nonzero padding.

Partial evidence is explicit: A2 preserves its five metadata bytes, opcode,
sequence byte and opaque payload. Raw resource opcode 2 identifies type, row,
column and two reserved bytes; opcode 1 carries a prefix byte and four-byte ID.
JPEG interpretation, key-to-icon mapping, sequence rollover, acknowledgment,
retry and image chunking are unverified. Unknown A2/short opcodes round-trip as
opaque bytes. Only DFU has a named short-command constructor. The matrix has 15
states at offsets 4..18, in three groups of five; the first byte equal to one
identifies a press. Physical placement and release-event semantics are unknown.
QMK protocol-version responses use big-endian bytes; backlight responses echo
their selector, and set/save responses echo the request prefix. These rules come
from the recovered QMK service, not the A3-only template.
