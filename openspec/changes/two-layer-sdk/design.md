# Design

## Desktop service ownership

The desktop root prepares each domain's existing service layer before it registers
IPC handlers or starts consumers. It merges those layers into one application
graph and creates one ManagedRuntime. Registrations receive execution views of
that owner, with their existing diagnostic operation labels, and cannot dispose
the application runtime. Their explicit teardown still cancels and joins workers
in dependency order. The root disposes the graph once after those writers stop,
then flushes diagnostics. Standalone module tests may construct their own owner.
This does not use a registry of runtimes or a shared memo map across owners.
Each execution view owns a closeable scope for its registration's asynchronous
operations. Closing that view interrupts and joins those operations, including
pending finalizers, while keeping the shared services alive. Caller interruption
also interrupts and joins the corresponding operation. Standalone views additionally
dispose their own runtime. Service resources, including the emoji foreground
probe and conversation shutdown, remain scoped to the graph.

Settings, chat history, meeting history and firmware recovery load their local
records on the first service operation rather than while acquiring the graph.
Initialization is serialized, publishes state only after a successful read or
recovery, and retries after failures. A corrupt feature store retains its catalog
error and cannot block unrelated services from starting. No failed read silently
replaces saved data. HTTP connection acquisition retains its existing unavailable
response when its local repository cannot be constructed.

The root acquires the graph before activating IPC consumers and loads renderers
after registrations. Recreated panel and management windows still load their
surfaces. Wallpaper delegates quit ownership to the root. Shutdown attempts every
ordered registration cleanup even if an earlier one fails, awaits graph disposal,
then flushes diagnostics. Maintenance reset and import finish their graph-bound
request effect before main runs the confirmed replacement. Main stops all writers
and awaits graph finalizers before clearing or replacing owned data, so a late
persistence finalizer cannot recreate deleted records or overwrite imported data.
The replacement uses an IO-only diagnostic effect outside the disposed graph;
failures retain their catalog identity, and diagnostics flush before native exit. Firmware shutdown prevents new work and joins its worker before
releasing security bookmarks.

The runtime registry and conversation service participate in the same graph.
Saved connection reads remain local, optional runtime setup failures retain their
unavailable IPC response. Graph acquisition performs no HTTP or HID I/O; the
existing device bus starts after registration.

## Context

Settled by the wayfinder map (`open-quake-2qs`): Effect devs first, non-Effect
devs covered; protocol layer uses Effect Schema only; governing skills are
`effect-conductor`, `open-quake-errors`, `effect-best-practices`.

## Approved decisions

1. **Approved (Ramiro, 2026-10-23)**: keep `@open-quake/protocol` as the pure
   kernel. Export schemas, `encode*` / `decode*` and `wrap*` / `unwrap*`
   functions returning `Either`, plus discovery constants. Preserve `checksum`,
   `frameHostCommand`, `verifyDeviceReport`, and `FRAME_HEADER`. Use
   `QuakeDevice` for the device conductor. This follows effect-conductor's
   contracts/invariants split without putting a service or runtime in pure code.
2. **Approved (Ramiro, 2026-10-23)**: protocol owns catalog-backed
   `ProtocolInputInvalid`, `FrameSizeInvalid`, `FrameChecksumMismatch`,
   `FrameTypeUnsupported`, `ProtocolJsonInvalid`, and `QmkResponseMismatch`
   Schema.TaggedError leaves. Device owns separate discovery/open/read/write/
   timeout/closed failures at its actual I/O boundaries. Preserve original
   causes privately, serialize only fixed diagnostics, and handle tags/codes.
   The protocol catalog is exported for later composition into a shared kernel;
   no dependency on device errors. This applies open-quake-errors without a
   generic catch-all error or a dependency on an out-of-lane shared package.
3. **Approved (Ramiro, 2026-10-23)**: expose an Effect `Stream` backed by a scoped
   `PubSub` internally, and a callback subscription returning an unsubscribe
   function for plain JS. The conductor owns fan-out, ordering, and scope.
   Callers should not have to manage the internal PubSub.
4. **Approved (Ramiro, 2026-10-23)**: the device conductor starts and interrupts
   the keep-alive fiber with its connection scope. Use the observed 15-second
   interval and stop on disconnect/disposal. Caller scope bounds the connection,
   rather than requiring callers to implement an independent ping timer.
5. **Approved (Ramiro, 2026-10-23)**: expose a Promise/callback facade backed by
   one owned `ManagedRuntime`, with explicit asynchronous disposal. Effect users
   use the service/layer directly. Keep the runtime an implementation detail
   of the JS facade so there is one lifecycle and one error translation boundary.

All five decisions above were approved by Ramiro on 2026-10-23. The parent
records their Beads status. The integrated device package consumes the protocol
kernel; it owns transport and event interpretation.

## Device integration

`QuakeDevice.Default` declares `NodeHidLive` in its dependencies. Native code
loads lazily when discovery or open runs. Custom transports and tests use
`QuakeDevice.DefaultWithoutDependencies` with their transport layer at the
application root. `discover()` filters all four kernel-owned identity fields
without opening handles or starting workers; `connect()` uses the same path.

The adapter uses `wrapShortCommand` and `encodeHidReport` for keep-alives, then
`decodeHidReport` and `unwrapShortCommand` for incoming control reports. Physical
size, report ID, body length, padding and checksum validation belong to protocol.
The conductor and JS facade preserve protocol error identities. Device catalog
errors translate native discovery/open/read/write/close exceptions only at those
boundaries; callback and connection configuration failures remain device-owned.

The connection scope owns acquisition, reader and keep-alive workers. The first
keep-alive follows one positive finite interval, default 15 seconds. Disconnect
waits for an in-flight native write, stops workers, closes the handle once, and
broadcasts termination. Active subscribers receive ordered events; late
subscribers receive termination rather than replayed input.

Checksummed control event mapping supports knob opcode `03` with commands
`01` and `02`, pong `55/EF`, and the existing synthetic touch envelope `A3/1A`.
Other valid control commands are ignored, including `55/1A`; payload validation
only runs after matching the supported opcode and command. Malformed physical
reports and malformed supported control frames terminate with protocol errors.
`strip-touch-input` adds source-derived vendor parsing and a scoped reader for
0712:0010 FF73/71. The original control fixtures remain compatibility tests.
Physical report framing and live timing still require hardware acceptance;
synthetic fixtures do not establish hardware parity.

The JS facade owns one ManagedRuntime, registers its subscription before connect
resolves, and supports idempotent asynchronous disconnect. Consumers construct a
new client to reconnect. The `./plain`, `./fake`, and `./node-hid` entry points
retain the workspace's source-TypeScript export convention; publishing standalone
compiled JavaScript is separate packaging work. `node-hid@3.4.0` and its native
build were approved by Ramiro on 2026-10-23.

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
