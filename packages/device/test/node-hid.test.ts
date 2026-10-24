import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it } from "@effect/vitest";
import { Effect, Either, Fiber, Stream } from "effect";
import { vi } from "vitest";
import { QuakeDevice } from "../src/device-service.js";
import { FAKE_QUAKE_DEVICE } from "../src/hid-fake.js";
import { HidTransport } from "../src/hid-transport.js";
import { NodeHidLive } from "../src/node-hid.js";
import { createQuakeDevice } from "../src/plain.js";
import { report } from "./reports.js";

const mocks = vi.hoisted(() => ({ discover: vi.fn(), open: vi.fn() }));
vi.mock("node-hid", () => ({
	devicesAsync: mocks.discover,
	HIDAsync: { open: mocks.open },
}));

class Handle extends EventEmitter {
	write = vi.fn(async (bytes: number[]) => bytes.length);
	close = vi.fn(async () => {});
}
let handle: Handle;
beforeEach(() => {
	vi.clearAllMocks();
	handle = new Handle();
	mocks.discover.mockResolvedValue([FAKE_QUAKE_DEVICE]);
	mocks.open.mockResolvedValue(handle);
});

describe("node-hid boundary, native API mocked", () => {
	it.effect(
		"discovers only the control interface without opening hardware",
		() =>
			Effect.gen(function* () {
				mocks.discover.mockResolvedValue([
					{ ...FAKE_QUAKE_DEVICE, path: "system", usagePage: 1, usage: 0x80 },
					{ ...FAKE_QUAKE_DEVICE, path: "consumer", usagePage: 0xc, usage: 1 },
					{ ...FAKE_QUAKE_DEVICE, path: "keyboard", usagePage: 1, usage: 6 },
					FAKE_QUAKE_DEVICE,
				]);
				const devices = yield* (yield* QuakeDevice).discover();
				expect(devices).toEqual([FAKE_QUAKE_DEVICE]);
				expect(mocks.open).not.toHaveBeenCalled();
				expect(handle.write).not.toHaveBeenCalled();
			}).pipe(Effect.provide(QuakeDevice.Default)),
	);
	it.scoped("provides the native transport through QuakeDevice.Default", () =>
		Effect.gen(function* () {
			const connection = yield* (yield* QuakeDevice).connect();
			expect(mocks.discover).toHaveBeenCalledTimes(1);
			expect(mocks.open).toHaveBeenCalledWith("fake:quake");
			yield* connection.disconnect();
			expect(handle.close).toHaveBeenCalledTimes(1);
		}).pipe(Effect.provide(QuakeDevice.Default)),
	);
	it("registers input before connect resolves and detaches listeners on close", async () => {
		const client = createQuakeDevice();
		const seen: string[] = [];
		let received: (() => void) | undefined;
		const next = new Promise<void>((resolve) => {
			received = resolve;
		});
		client.subscribe((event) => {
			seen.push(event._tag);
			received?.();
		});
		try {
			await client.connect();
			expect(handle.listenerCount("data")).toBe(1);
			expect(mocks.open).toHaveBeenCalledWith("fake:quake");
			handle.emit("data", report(3, 2, [0]));
			await next;
			expect(seen).toEqual(["KnobPress"]);
		} finally {
			await client.disconnect();
		}
		expect(handle.close).toHaveBeenCalledTimes(1);
		expect(handle.listenerCount("data")).toBe(0);
		expect(handle.listenerCount("error")).toBe(0);
	});
	for (const operation of ["discover", "open"] as const) {
		it(`retains and scrubs native ${operation} failures`, async () => {
			const original = Object.assign(new Error("/private/hid token=secret"), {
				code: "EACCES",
			});
			mocks[operation].mockRejectedValue(original);
			const client = createQuakeDevice();
			await expect(client.connect()).rejects.toMatchObject({
				_tag:
					operation === "discover"
						? "QuakeHidDiscoveryFailed"
						: "QuakeHidOpenFailed",
				originalCause: original,
				diagnosticCause: { name: "Error", sourceCode: "EACCES" },
			});
			await client.disconnect().catch(() => {});
			expect(handle.close).not.toHaveBeenCalled();
		});
	}
	it("reports a native read failure, closes, and rejects reuse of the disconnected JS client", async () => {
		const client = createQuakeDevice();
		const original = new Error("read token=secret");
		const seen: string[] = [];
		let fail: ((error: unknown) => void) | undefined;
		const failed = new Promise<unknown>((resolve) => {
			fail = resolve;
		});
		client.subscribe(
			(event) => {
				seen.push(event._tag);
			},
			(error) => {
				fail?.(error);
			},
		);
		try {
			await client.connect();
			handle.emit("error", original);
			const error = await failed;
			expect(error).toMatchObject({
				_tag: "QuakeHidReadFailed",
				code: "QUAKE.HID.READ_FAILED",
				originalCause: original,
			});
			expect(JSON.stringify(error)).not.toContain("token=secret");
			expect(seen).toEqual(["Disconnect"]);
			await expect(client.connect()).rejects.toMatchObject({
				_tag: "QuakeConnectionClosed",
			});
		} finally {
			await client.disconnect();
		}
		expect(handle.close).toHaveBeenCalledTimes(1);
	});
	it.scoped(
		"validates report length and maps rejected/short native writes",
		() =>
			Effect.gen(function* () {
				yield* Effect.gen(function* () {
					const transport = yield* HidTransport;
					const connection = yield* transport.open(FAKE_QUAKE_DEVICE);
					expect(
						Either.isLeft(
							yield* Effect.either(connection.write(new Uint8Array(32))),
						),
					).toBe(true);
					expect(handle.write).not.toHaveBeenCalled();
					handle.write.mockResolvedValueOnce(32);
					const short = yield* Effect.either(
						connection.write(new Uint8Array(33)),
					);
					expect(Either.isLeft(short) && short.left.code).toBe(
						"QUAKE.HID.WRITE_FAILED",
					);
					const original = new Error("private report data");
					handle.write.mockRejectedValueOnce(original);
					const rejected = yield* Effect.either(
						connection.write(new Uint8Array(33)),
					);
					expect(Either.isLeft(rejected) && rejected.left.originalCause).toBe(
						original,
					);
					yield* connection.close();
				}).pipe(Effect.provide(NodeHidLive));
			}),
	);
	it.scoped(
		"propagates native close failures and retains the original cause",
		() =>
			Effect.gen(function* () {
				const original = new Error("close token=secret");
				handle.close.mockRejectedValueOnce(original);
				yield* Effect.gen(function* () {
					const connection = yield* (yield* QuakeDevice).connect();
					const events = yield* connection.subscribe();
					const consumer = yield* Stream.runDrain(events).pipe(
						Effect.either,
						Effect.forkScoped,
					);
					const result = yield* Effect.either(connection.disconnect());
					expect(Either.isLeft(result) && result.left._tag).toBe(
						"QuakeHidCloseFailed",
					);
					expect(Either.isLeft(result) && result.left.originalCause).toBe(
						original,
					);
					expect(JSON.stringify(result)).not.toContain("token=secret");
					expect(Either.isLeft(yield* Fiber.join(consumer))).toBe(true);
				}).pipe(Effect.provide(QuakeDevice.Default));
			}),
	);
});

it.scoped(
	"uses non-exclusive macOS opening for vendor touch without writes",
	() =>
		Effect.gen(function* () {
			const transport = yield* HidTransport;
			const connection = yield* transport.open({
				path: "fake:touch",
				vendorId: 0x0712,
				productId: 0x0010,
				usagePage: 0xff73,
				usage: 0x71,
			});
			if (process.platform === "darwin")
				expect(mocks.open).toHaveBeenCalledWith("fake:touch", {
					nonExclusive: true,
				});
			else expect(mocks.open).toHaveBeenCalledWith("fake:touch");
			expect(handle.write).not.toHaveBeenCalled();
			yield* connection.close();
			expect(handle.close).toHaveBeenCalledTimes(1);
		}).pipe(Effect.provide(NodeHidLive)),
);
