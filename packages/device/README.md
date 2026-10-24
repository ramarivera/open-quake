# QUAKE device conductor

The Effect service owns discovery, incoming events, and a keep-alive fiber. Each
connection is an independent scoped resource. Closing its scope or calling
`disconnect()` stops its workers before closing the HID handle. Keep-alives start
after the first interval, defaulting to 15 seconds.

```ts
import { Effect, Stream } from "effect";
import { QuakeDevice } from "@open-quake/device";

const DeviceLive = QuakeDevice.Default;
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

`QuakeHidReadFailed`, `QuakeHidWriteFailed`, and protocol catalog errors stop the
connection. Protocol failures retain their kernel tags and codes, including
`FrameChecksumMismatch` and `FrameSizeInvalid`. Consumers receive a disconnect
event followed by the typed failure.
Close failures are also reported by `disconnect()`. I/O error codes and categories
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

`QuakeDevice.Default` declares `NodeHidLive` as its default dependency. Tests and
custom transports use `QuakeDevice.DefaultWithoutDependencies.pipe(Layer.provide(transport))`
at their composition root. The JS facade accepts a custom transport as its
second argument and uses that override path.

Read-only discovery opens no handle and starts no keep-alive worker:

```ts
await Effect.runPromise(QuakeDevice.discover().pipe(Effect.provide(QuakeDevice.Default)));
```

`src/protocol-adapter.ts` uses the kernel's `wrapShortCommand`, `encodeHidReport`,
`decodeHidReport`, and `unwrapShortCommand`. The kernel owns framing, report IDs,
padding, declared lengths and checksums. The adapter maps decoded commands to
events. It validates physical report sizes before ignoring unrelated traffic.
Unknown valid control commands, including opcode `55` with command `1A`, are
ignored. Legacy control touch fixtures use the synthetic checksummed `A3/1A` envelope,
with action, little-endian Y, then little-endian X per point.

Native binding installation and read-only enumeration can be checked separately
from connecting. Live writes/reads, watchdog timing, detach behavior and actual
knob/touch reports remain unverified. The separately scoped vendor touch reader now implements the source-derived
0712:0010 FF73/71 format. Synthetic tests establish its software contract only;
physical framing and delivery still require the lead's hardware capture.

Read-only research sources:

- `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, section 1
- `/Users/ramarivera/dev/open-quake/.context/decokee-quake-template/modules/quake-device/{device,protocol,touch}.js`
- `/Users/ramarivera/dev/open-quake/.context/decokee-quake-fw/docs/PROTOCOL.md`

Ramiro approved `node-hid@3.4.0` and its native install step on 2026-10-23. The
root build allowlist includes it, and the shared lockfile records it. No research
source is copied into the repository.

## Vendor touch input

Each control connection also supervises the separately selected touch collection.
See [touch input](src/touch/README.md) for the source-derived frame format, capture
controls, recovery and the lead-only probe. Touch read failures recover separately
from control-channel failures. Real hardware remains unverified.
