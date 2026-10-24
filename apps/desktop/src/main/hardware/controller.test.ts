import { describe, expect, it } from "@effect/vitest";
import { HardwareControls, QuakeDevice } from "@open-quake/device";
import { makeFakeHardwareTransport } from "@open-quake/device/hardware/fake";
import { Effect, Layer } from "effect";
import { hardwareRequest } from "./controller";

describe("hardware settings consumer", () => {
	it.scoped(
		"drives typed requests into actual fake-HID writes and refuses stale or malformed requests",
		() =>
			Effect.gen(function* () {
				const fake = yield* makeFakeHardwareTransport();
				const device = yield* QuakeDevice.pipe(
					Effect.provide(
						QuakeDevice.DefaultWithoutDependencies.pipe(
							Layer.provide(fake.layer),
						),
					),
				);
				const connection = yield* device.connect();
				const controls = yield* HardwareControls.pipe(
					Effect.provide(HardwareControls.Default),
				);
				const current = yield* controls.create(connection, {
					serial: "serial-A",
					session: "session-A",
				});
				expect(
					yield* hardwareRequest({ _tag: "read" }, undefined, true),
				).toEqual({ _tag: "offline" });
				expect(
					yield* hardwareRequest({ _tag: "send", command: 3 }, current, true),
				).toEqual({ _tag: "failure", code: "QUAKE.HARDWARE.INVALID_REQUEST" });
				expect(
					yield* hardwareRequest(
						{ _tag: "toggleMic", session: "old-session" },
						current,
						true,
					),
				).toEqual({ _tag: "failure", code: "QUAKE.HARDWARE.STALE_SESSION" });
				expect(yield* fake.writes).toHaveLength(0);
				yield* hardwareRequest(
					{ _tag: "refresh", session: "session-A" },
					current,
					true,
				);
				const reply = yield* hardwareRequest(
					{ _tag: "toggleMic", session: "session-A" },
					current,
					true,
				);
				expect(reply._tag).toBe("ready");
				if (reply._tag === "ready") expect(reply.snapshot.mic).toBe(false);
				expect([...((yield* fake.writes).at(-1) ?? [])].slice(0, 7)).toEqual([
					0, 163, 3, 1, 3, 0, 4,
				]);
			}),
	);
});
