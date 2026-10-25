import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
	SettingsBackendFailure,
	SettingsInvalid,
	SettingsOsApplyFailed,
	SettingsPersistFailed,
	SettingsReadFailed,
	WizardIncomplete,
} from "./settings-errors.js";

describe("settings failures across the actual RPC schema", () => {
	it("retains each safe catalog identity and diagnostic projection without serializing the private cause", () => {
		const cause = Object.assign(new Error("private provider content"), {
			code: "EACCES",
		});
		for (const original of [
			new SettingsInvalid(cause),
			new SettingsReadFailed(cause),
			new SettingsPersistFailed(cause),
			new WizardIncomplete(cause),
			...(
				[
					"unsupported",
					"denied",
					"timeout",
					"unverified",
					"unavailable",
				] as const
			).map((reason) => new SettingsOsApplyFailed(cause, reason)),
		]) {
			const encoded = Schema.encodeSync(SettingsBackendFailure)(original);
			const decoded = Schema.decodeUnknownSync(SettingsBackendFailure)(
				JSON.parse(JSON.stringify(encoded)),
			);
			expect(decoded._tag).toBe(original._tag);
			expect(decoded.code).toBe(original.code);
			expect(decoded.diagnosticCause).toEqual(original.diagnosticCause);
			if (original._tag === "SettingsOsApplyFailed") {
				expect(decoded).toBeInstanceOf(SettingsOsApplyFailed);
				expect(decoded).toMatchObject({ reason: original.reason });
			}
			expect(original.originalCause).toBe(cause);
			expect(decoded.originalCause).toBeUndefined();
			expect(JSON.stringify(encoded)).not.toContain("private provider content");
			expect(Object.keys(decoded)).not.toContain("originalCause");
		}
	});
});
