import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { QuakeDevice, QuakeDeviceLive } from "../src/index.js";

describe("@open-quake/device wiring", () => {
	it("builds a framed keep-alive ping via the protocol package", async () => {
		const program = Effect.gen(function* () {
			const device = yield* QuakeDevice;
			return yield* device.keepAlivePing;
		});
		const frame = await Effect.runPromise(
			Effect.provide(program, QuakeDeviceLive),
		);
		expect(Array.from(frame)).toEqual([0xa3, 2, 2, 0xef, 0xf1]);
	});
});
