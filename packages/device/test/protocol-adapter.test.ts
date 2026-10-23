import { describe, expect, it } from "@effect/vitest";
import { Either, FastCheck as fc, Option, Schema } from "effect";
import {
	QuakeHidReadFailed,
	toSafeDiagnosticCause,
} from "../src/device-errors.js";
import { decodeReport } from "../src/protocol-adapter.js";
import { report } from "./reports.js";

describe("internal byte adapter", () => {
	it.prop(
		"decodes every press byte with and without a report ID",
		[fc.integer({ min: 0, max: 255 }), fc.boolean()],
		([state, withId]) => {
			expect(decodeReport(report(3, 2, [state], withId))).toEqual(
				Either.right(Option.some({ _tag: "KnobPress", state })),
			);
		},
	);
	it("ignores unrelated HID traffic and valid unknown control reports", () => {
		expect(decodeReport(new Uint8Array([1, 2, 3]))).toEqual(
			Either.right(Option.none()),
		);
		expect(decodeReport(report(0x55, 46, [1, 2, 3, 4]))).toEqual(
			Either.right(Option.none()),
		);
	});
	it("rejects corrupt, truncated, inconsistent, and undersized reports", () => {
		const corrupt = report(3, 1, [1]);
		corrupt[5] = 0;
		const tooLong = report(3, 1, [1]);
		tooLong[1] = 255;
		for (const bytes of [
			corrupt,
			tooLong,
			report(3, 1),
			report(3, 2),
			report(3, 1, [1]).subarray(0, 5),
			report(0xa3, 26, [2, 1, 0, 0, 0, 0]),
		]) {
			const decoded = decodeReport(bytes);
			expect(Either.isLeft(decoded) && decoded.left.code).toBe(
				"QUAKE.REPORT.INVALID",
			);
		}
	});
	it.prop(
		"never throws on arbitrary incoming bytes",
		[fc.uint8Array({ maxLength: 128 })],
		([bytes]) => {
			expect(() => decodeReport(bytes)).not.toThrow();
		},
	);
});

describe("catalog error diagnostics", () => {
	it.prop(
		"retains original exceptions while excluding arbitrary upstream content",
		[fc.string()],
		([privateText]) => {
			const original = Object.assign(
				new Error(privateText, { cause: new Error(privateText) }),
				{ code: "EIO", name: privateText },
			);
			const error = new QuakeHidReadFailed(original);
			expect(error.originalCause).toBe(original);
			expect(Object.keys(error)).not.toContain("originalCause");
			expect(error.diagnosticCause).toEqual({
				name: "Error",
				sourceCode: "EIO",
				truncated: true,
				cause: { name: "Error", truncated: true },
			});
			const decoded = Schema.decodeUnknownEither(QuakeHidReadFailed)(
				JSON.parse(JSON.stringify(error)),
			);
			expect(Either.isRight(decoded)).toBe(true);
		},
	);
	it("bounds cycles and tolerates throwing upstream accessors", () => {
		const cycle = new Error("token=private");
		cycle.cause = cycle;
		const safe = JSON.stringify(toSafeDiagnosticCause(cycle));
		expect(safe.length).toBeLessThan(400);
		expect(safe).not.toContain("private");
		const hostile = Object.defineProperty(new Error(), "cause", {
			get: () => {
				throw new Error("secret");
			},
		});
		expect(toSafeDiagnosticCause(hostile)).toEqual({
			name: "UnreadableCause",
			truncated: true,
		});
		expect(toSafeDiagnosticCause("private upstream failure")).toEqual({
			name: "UnknownCause",
			truncated: true,
		});
	});
	it("rejects a forged public error identity", () => {
		const error = JSON.parse(JSON.stringify(new QuakeHidReadFailed(undefined)));
		error.code = "QUAKE.HID.OPEN_FAILED";
		expect(
			Either.isLeft(Schema.decodeUnknownEither(QuakeHidReadFailed)(error)),
		).toBe(true);
	});
});
