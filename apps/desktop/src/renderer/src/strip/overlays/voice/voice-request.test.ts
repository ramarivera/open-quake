import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { VoiceSurfaceRequestFailed } from "../../../../../shared/voice-surface";
import { requestVoiceSurface } from "./voice-request";

describe("voice renderer request boundary", () => {
	it("returns registered failure identity for rejecting and synchronously throwing bridges", async () => {
		const cause = new Error("private transcript and sk-test-secret");
		for (const request of [
			() => Promise.reject(cause),
			(): Promise<unknown> => {
				throw cause;
			},
		]) {
			expect(
				await Effect.runPromise(
					requestVoiceSurface(
						{ request, onEvent: () => () => undefined },
						{ _tag: "Hello" },
					),
				),
			).toEqual({ _tag: "rejected", code: "VOICE.SURFACE.REQUEST_FAILED" });
		}
		const error = new VoiceSurfaceRequestFailed(cause);
		expect(error._tag).toBe("VoiceSurfaceRequestFailed");
		expect(error.code).toBe("VOICE.SURFACE.REQUEST_FAILED");
		expect(error.originalCause).toBe(cause);
		expect(JSON.stringify(error)).not.toContain("private transcript");
		expect(JSON.stringify(error)).not.toContain("sk-test-secret");
	});
	it("retains missing bridge, malformed reply and accepted reply behavior", async () => {
		expect(
			await Effect.runPromise(
				requestVoiceSurface(undefined, { _tag: "Hello" }),
			),
		).toEqual({ _tag: "rejected", code: "VOICE.SURFACE.BRIDGE_MISSING" });
		for (const [raw, expected] of [
			[{}, { _tag: "rejected", code: "VOICE.SURFACE.REQUEST_INVALID" }],
			[{ _tag: "ok" }, { _tag: "ok" }],
		]) {
			expect(
				await Effect.runPromise(
					requestVoiceSurface(
						{ request: async () => raw, onEvent: () => () => undefined },
						{ _tag: "Hello" },
					),
				),
			).toEqual(expected);
		}
	});
});
