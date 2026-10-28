import { describe, expect, it } from "@effect/vitest";
import { Effect, Either, FastCheck, Option, Schema } from "effect";
import {
	InvalidLightingValue,
	LightingApplyFailed,
	LightingCapabilities,
	LightingChange,
	LightingIoFailed,
	LightingReadFailed,
	LightingSaveFailed,
	LightingService,
	type LightingState,
	LightingTargetUnavailable,
	LightingValueUnsupported,
	reconcileSaveStatus,
	validateCapabilities,
	validateChange,
} from "../../src/lighting/index.js";
import { capabilities, evidence, makeFixture, targetA } from "./fixture.js";

describe("lighting contracts and invariants", () => {
	it.prop(
		"accepts exactly the qualified brightness integer range",
		[FastCheck.double({ noNaN: false })],
		([value]) => {
			expect(
				Either.isRight(
					validateChange(capabilities, { field: "brightness", value }),
				),
			).toBe(Number.isInteger(value) && value >= 0 && value <= 200);
		},
	);
	it.prop(
		"recognizes equivalent saved scalar and color snapshots across field order",
		[
			FastCheck.integer({ min: 0, max: 200 }),
			FastCheck.integer({ min: 0, max: 255 }),
			FastCheck.integer({ min: 0, max: 255 }),
		],
		([brightness, hue, saturation]) => {
			const state: LightingState = {
				capabilities,
				status: "ready",
				desired: [
					{ field: "color1", value: { hue, saturation } },
					{ field: "brightness", value: brightness },
				],
				applied: [
					{ field: "brightness", value: brightness },
					{ field: "color1", value: { hue, saturation } },
				],
				saved: Option.some([
					{ field: "color1", value: { hue, saturation } },
					{ field: "brightness", value: brightness },
				]),
				saveStatus: "unsaved",
			};
			expect(reconcileSaveStatus(state, false).saveStatus).toBe("saved");
			expect(reconcileSaveStatus(state, true).saveStatus).toBe("unsaved");
		},
	);
	it.prop(
		"round-trips byte color models",
		[
			FastCheck.integer({ min: 0, max: 255 }),
			FastCheck.integer({ min: 0, max: 255 }),
		],
		([hue, saturation]) => {
			const value = { field: "color1", value: { hue, saturation } } as const;
			expect(
				Schema.decodeUnknownSync(LightingChange)(
					Schema.encodeSync(LightingChange)(value),
				),
			).toEqual(value);
			expect(Either.isRight(validateChange(capabilities, value))).toBe(true);
		},
	);
	it("rejects stale, malformed, duplicate, and v3 legacy bindings", () => {
		const brightness = capabilities.fields[0];
		if (brightness?.field !== "brightness") throw new Error("fixture");
		for (const caps of [
			{ ...capabilities, target: { ...targetA, session: "stale" } },
			{
				...capabilities,
				fields: [
					{
						...brightness,
						evidence: {
							...evidence,
							identity: { ...evidence.identity, firmware: "stale" },
						},
					},
				],
			},
			{ ...capabilities, fields: [{ ...brightness, valueId: 99 }] },
			{
				...capabilities,
				fields: [{ ...brightness, range: { min: 100, max: 20 } }],
			},
			{
				...capabilities,
				fields: [{ ...brightness, range: { min: 0, max: 256 } }],
			},
			{ ...capabilities, fields: [{ ...brightness, readable: false }] },
			{ ...capabilities, fields: [brightness, brightness] },
			{
				...capabilities,
				identity: { ...capabilities.identity, protocolVersion: 11 },
			},
			{ ...capabilities, transport: "unavailable" },
			{
				...capabilities,
				save: Option.some({
					evidence: {
						...evidence,
						identity: { ...evidence.identity, firmware: "stale" },
					},
					completion: "ack-and-readback",
				}),
			},
		]) {
			const result = validateCapabilities(targetA, caps);
			expect(Either.isLeft(result) && result.left._tag).toBe(
				"LightingTargetUnavailable",
			);
		}
	});
	it("round-trips a capability snapshot", () => {
		expect(
			Schema.decodeUnknownSync(LightingCapabilities)(
				Schema.encodeSync(LightingCapabilities)(capabilities),
			),
		).toEqual(capabilities);
	});
	for (const ErrorClass of [
		LightingTargetUnavailable,
		LightingValueUnsupported,
		InvalidLightingValue,
		LightingReadFailed,
		LightingApplyFailed,
		LightingSaveFailed,
		LightingIoFailed,
	]) {
		it(`preserves private cause identity and scrubs ${ErrorClass.name}`, () => {
			const source = Object.assign(new Error("token=secret /private/hid"), {
				code: "EACCES",
				cause: new Error("password=secret"),
			});
			const error = new ErrorClass(source);
			expect(error.originalCause).toBe(source);
			expect(error.code).toMatch(/^QUAKE\.LIGHTING\./);
			const serialized = JSON.stringify(error);
			expect(serialized).toContain("EACCES");
			for (const text of [
				"secret",
				"/private/hid",
				"originalCause",
				"token",
				"password",
			])
				expect(serialized).not.toContain(text);
		});
	}
});

const v3Identity = { firmware: "QUAKE:3:1.0.19", protocolVersion: 12 };
const v3 = {
	...capabilities,
	identity: v3Identity,
	transport: "v3" as const,
	fields: [
		{
			field: "effectSpeed" as const,
			valueId: 3 as const,
			readable: true,
			writable: true,
			range: { min: 0, max: 255 },
			evidence: { identity: v3Identity, basis: "hardware-qualified" as const },
		},
	],
	save: Option.none(),
};
it("round-trips narrow V3 capabilities and rejects expanded or mislabeled profiles", () => {
	expect(
		Schema.decodeUnknownSync(LightingCapabilities)(
			Schema.encodeSync(LightingCapabilities)(v3),
		),
	).toEqual(v3);
	expect(Either.isRight(validateCapabilities(targetA, v3))).toBe(true);
	const speed = v3.fields[0];
	if (!speed) throw new Error("Missing speed fixture");
	for (const invalid of [
		{ ...v3, save: capabilities.save },
		{ ...v3, fields: [] },
		{ ...v3, fields: [{ ...speed, valueId: 11 }] },
		{ ...v3, fields: [{ ...speed, writable: false }] },
		{
			...v3,
			fields: [
				{
					...speed,
					evidence: { ...speed.evidence, basis: "source-qualified" },
				},
			],
		},
		{ ...v3, fields: [...v3.fields, capabilities.fields[0]] },
		{ ...v3, identity: { ...v3Identity, protocolVersion: 11 } },
		{ ...v3, identity: { ...v3Identity, firmware: "QUAKE:3:1.0.20" } },
		{ ...capabilities, fields: [{ ...speed, evidence }] },
	])
		expect(Either.isLeft(validateCapabilities(targetA, invalid))).toBe(true);
});

it.scoped(
	"standalone legacy adapter rejects V3 before opening a second native handle",
	() =>
		Effect.gen(function* () {
			const fixture = yield* makeFixture(v3);
			yield* Effect.gen(function* () {
				const lighting = yield* LightingService;
				expect(
					yield* lighting.select(targetA).pipe(Effect.either),
				).toMatchObject({
					_tag: "Left",
					left: { _tag: "LightingTargetUnavailable" },
				});
			}).pipe(Effect.provide(fixture.layer));
			expect(yield* fixture.fakeA.opens).toBe(0);
			expect(yield* fixture.fakeA.writes).toEqual([]);
		}),
);
