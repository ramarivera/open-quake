import { describe, expect, it } from "@effect/vitest";
import { Either, FastCheck as fc, Schema } from "effect";
import { ProfileEnvelope } from "./profile-contracts.js";
import { completeEnvelope } from "./profile-fixtures.js";
import { repairProfileSelections } from "./profile-repository.js";

describe("profile selection serials", () => {
	it.prop(
		"repairs reserved own keys without changing prototypes or copying inherited selections",
		[fc.boolean(), fc.uniqueArray(fc.string({ minLength: 1 }))],
		([valid, generated]) => {
			const serials = [
				...new Set(["__proto__", "constructor", "prototype", ...generated]),
			];
			const selection = valid
				? { profileId: "profile-a", pageId: "page-a" }
				: { profileId: "missing", pageId: "missing" };
			const activeByDevice = Object.fromEntries(
				serials.map((serial) => [serial, selection]),
			);
			Object.setPrototypeOf(activeByDevice, { inheritedSerial: selection });
			const result = repairProfileSelections({
				...completeEnvelope(),
				activeByDevice,
			});
			expect(Object.getPrototypeOf(result.envelope.activeByDevice)).toBe(
				Object.prototype,
			);
			expect(Object.keys(result.envelope.activeByDevice).sort()).toEqual(
				serials.sort(),
			);
			for (const serial of serials) {
				expect(Object.hasOwn(result.envelope.activeByDevice, serial)).toBe(
					true,
				);
				expect(result.envelope.activeByDevice[serial]).toEqual({
					profileId: "profile-a",
					pageId: "page-a",
				});
			}
			expect([...result.repairedSelections].sort()).toEqual(
				valid ? [] : serials,
			);
		},
	);

	it.prop(
		"rejects __proto__ before the record decoder and round-trips constructor and prototype",
		[fc.shuffledSubarray(["constructor", "prototype"], { minLength: 1 })],
		([serials]) => {
			const selection = { profileId: "profile-a", pageId: "page-a" };
			const encoded = Schema.encodeSync(ProfileEnvelope)(completeEnvelope());
			const safe = {
				...encoded,
				activeByDevice: Object.fromEntries(
					serials.map((serial) => [serial, selection]),
				),
			};
			const decoded = Schema.decodeUnknownSync(ProfileEnvelope)(safe);
			expect(Schema.encodeSync(ProfileEnvelope)(decoded)).toEqual(safe);
			const unsafe = {
				...safe,
				activeByDevice: Object.fromEntries([
					["__proto__", selection],
					...Object.entries(safe.activeByDevice),
				]),
			};
			// No caller parse options: the schema itself must reject the unsafe key.
			expect(
				Either.isLeft(Schema.decodeUnknownEither(ProfileEnvelope)(unsafe)),
			).toBe(true);
		},
	);
});
