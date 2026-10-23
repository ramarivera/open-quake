# QUAKE device conductor

The Effect service owns discovery, incoming events, and a keep-alive fiber. Each
connection is an independent scoped resource. Closing its scope or calling
`disconnect()` stops its workers before closing the HID handle. Keep-alives start
after the first interval, defaulting to 15 seconds.

```ts
import { Effect, Layer, Stream } from "effect";
import { NodeHidLive, QuakeDevice } from "@open-quake/device";

const DeviceLive = QuakeDevice.Default.pipe(Layer.provide(NodeHidLive));
const program = Effect.scoped(Effect.gen(function* () {
  const device = yield* QuakeDevice;
  const connection = yield* device.connect({ keepAliveIntervalMs: 15_000 });
  yield* Stream.runForEach(connection.events, (event) => Effect.log(event));
}));
await Effect.runPromise(program.pipe(Effect.provide(DeviceLive)));
```

`connection.events` broadcasts `KnobRotate`, `KnobPress`, `Touch`, `KeepAlive`, and
`Disconnect` values. `KeepAlive` means an incoming pong. Input events are not
replayed. `yield* connection.subscribe()` acquires a subscription before the
caller generates input, useful for deterministic tests. Terminated connections
replay their disconnect and stream failure to late subscribers. A subscription
must remain inside the connection's owning scope.

`QuakeHidReadFailed`, `QuakeHidWriteFailed`, and `QuakeReportInvalid` stop the
connection. Consumers receive a disconnect event followed by the typed failure.
Close failures are also reported by `disconnect()`. Error codes and categories
are pinned to `DeviceErrors`; original upstream exceptions remain on the
non-enumerable `originalCause` property. Serialized diagnostics contain only
fixed error names and allowlisted operating-system codes, with bounded causes.

## JavaScript callers

```js
import { createQuakeDevice } from "@open-quake/device/plain";

const device = createQuakeDevice();
const unsubscribe = device.subscribe(
  (event) => console.log(event),
  (error) => console.error(error.code),
);
try {
  await device.connect();
  // Application work; callbacks continue until disconnect or unsubscribe.
} finally {
  await device.disconnect();
  unsubscribe();
}
```

This facade owns its `ManagedRuntime`. It installs its event subscription before
`connect()` resolves. Concurrent connects share one connection, and disconnect
is idempotent. Construct a new client to reconnect after any disconnect.
Subscriptions may be installed before connect. Callback exceptions are isolated
and delivered to that subscription's optional error callback. Callbacks should
be synchronous; Promise-returning callbacks are not awaited.

The package follows the workspace's source-TypeScript export convention. The
JavaScript example requires a consumer toolchain that resolves those exports.
Standalone built JavaScript distribution is outside this lane.

## Transports and verification

`HidTransport` is the infrastructure interface. `NodeHidLive` dynamically loads
`node-hid@3.4.0` when discovery/open runs. Importing the package, using a fake, and
running the test suite require no native binding or hardware. Host writes are
exactly 33 bytes, starting with report ID zero. Discovery checks all four values:
VID `0x4158`, PID `0x514B`, usage page `0xFF60`, and usage `0x61`.

`makeFakeHidTransport()` from `@open-quake/device/fake` returns a transport layer,
report injection, read/write failure injection, and open/close/write observations.
Tests use `@effect/vitest` and `TestClock` to drive the actual service and facade.
The native API is mocked for node-hid boundary tests.

All local byte handling is isolated in `src/protocol-adapter.ts`, which consumes
only today's protocol exports. It prepends/pads host reports and trims incoming
padding before checking the checksum. The recovered host parser counts incoming
body bytes without the checksum. Touch points use action, little-endian Y, then
little-endian X. L1 codecs should replace this adapter during integration.

Hardware verification remains **unverified**: USB enumeration and permissions,
native binding installation, live writes/reads, watchdog timing, detach behavior,
and actual knob/touch reports. Research identifies touch as a separate HID
collection on some devices. This lane decodes checksummed touch reports delivered
by the configured transport; it does not open a second touch interface or handle
that collection's unchecked raw touch format.

Read-only research sources:

- `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, section 1
- `/Users/ramarivera/dev/open-quake/.context/decokee-quake-template/modules/quake-device/{device,protocol,touch}.js`
- `/Users/ramarivera/dev/open-quake/.context/decokee-quake-fw/docs/PROTOCOL.md`

The exact node-hid dependency requires approval before integration. The shared
lockfile is outside this lane's scope; regenerate it when merging the lane
manifests. No research source is copied into the repository.
