import { describe, expect, it } from "vitest";
import { failureReason } from "./exerciser-replies";

describe("management IPC failure detection", () => {
	it.each([
		[{ _tag: "rejected", reason: "duplicate" }, "duplicate"],
		[{ _tag: "failure", code: "QUAKE.EMOJI.INVALID" }, "QUAKE.EMOJI.INVALID"],
		[
			{ _tag: "failure", code: "QUAKE.HARDWARE.FAILED" },
			"QUAKE.HARDWARE.FAILED",
		],
		[
			{ type: "error", code: "QUAKE.INTEGRATION.FAILED" },
			"QUAKE.INTEGRATION.FAILED",
		],
		[
			{ ok: false, code: "QUAKE.MAINTENANCE.FAILED" },
			"QUAKE.MAINTENANCE.FAILED",
		],
		[{ success: false, reason: "systemUnavailable" }, "systemUnavailable"],
		[{ _tag: "invalid" }, "invalid"],
	])("recognizes unsuccessful reply %j", (reply, reason) => {
		expect(failureReason(reply)).toBe(reason);
	});
	it.each([
		undefined,
		null,
		true,
		{ _tag: "ready" },
		{ _tag: "cancelled" },
		{ _tag: "offline" },
		{ type: "ok" },
		{ ok: true },
		{ success: true },
	])(
		"doesn't mistake cancellation or availability for failure: %j",
		(reply) => {
			expect(failureReason(reply)).toBeUndefined();
		},
	);
});
