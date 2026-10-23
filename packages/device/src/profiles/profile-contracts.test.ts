import { describe, expect, it } from "@effect/vitest";
import { Either, FastCheck as fc, Option, Schema } from "effect";
import {
	createEmptyProfileKey,
	createInitialProfileEnvelope,
	EMPTY_PROFILE_TITLE,
	ProfileEditPolicy,
	ProfileEnvelope,
	ProfileKey,
	ProfileTitle,
	QUAKE_LOGICAL_GRID,
} from "./profile-contracts.js";
import {
	completeEncodedEnvelope,
	completeEncodedKey,
} from "./profile-fixtures.js";

describe("profile contracts", () => {
	it("accepts composite subActions without leaf actions and rejects missing leaf actions", () => {
		const key = completeEncodedKey();
		const {
			actions: _actions,
			subActions: _subActions,
			...config
		} = key.config;
		expect(
			Either.isLeft(Schema.decodeUnknownEither(ProfileKey)({ ...key, config })),
		).toBe(true);
		const composite = Schema.decodeUnknownSync(ProfileKey)({
			...key,
			config: { ...config, subActions: [{ type: "group", entries: [] }] },
		});
		expect(composite.config.actions).toEqual([]);
		expect(Option.isSome(composite.config.subActions)).toBe(true);
	});
	it("rejects executable or expanded empty placeholders", () => {
		const key = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
		for (const config of [
			{ actions: [{ type: "unsafe", value: "payload" }] },
			{ icon: "artwork" },
			{ size: [2, 1] },
			{ supportKnob: true },
		]) {
			expect(
				Either.isLeft(
					Schema.decodeUnknownEither(ProfileKey)({
						...key,
						config: { ...key.config, ...config },
					}),
				),
			).toBe(true);
		}
	});
	it("round trips every common field, nested JSON, metadata, and action order", () => {
		const fixture = completeEncodedEnvelope();
		const decoded = Schema.decodeUnknownSync(ProfileEnvelope)(fixture);
		expect(Schema.encodeSync(ProfileEnvelope)(decoded)).toEqual(fixture);
		expect(
			JSON.stringify(Schema.encodeSync(ProfileEnvelope)(decoded)),
		).not.toContain(":null");
		expect(
			decoded.profiles[0].pages[0].keys[0]?.config.title.resourceId,
		).toEqual(Option.some("title-resource"));
	});
	it("uses one-based row,col and reserves the knob outside page keys", () => {
		expect(QUAKE_LOGICAL_GRID).toMatchObject({
			rows: 2,
			columns: 8,
			coordinateOrder: "row,col",
			knobCode: "0,1",
		});
		expect(createEmptyProfileKey("1,8").keyCode).toBe("1,8");
		expect(() => createEmptyProfileKey("0,1")).toThrow();
		expect(
			Either.isLeft(
				Schema.decodeUnknownEither(ProfileKey)(completeEncodedKey("1,8")),
			),
		).toBe(true);
		expect(createInitialProfileEnvelope().profiles[0]).toMatchObject({
			revision: 0,
			pages: [{ keys: [] }],
		});
	});
	it("requires childrenName on authored nonempty keys and supports explicitly inert imports", () => {
		const {
			childrenName: _childrenName,
			compatibility: _compatibility,
			...key
		} = completeEncodedKey();
		expect(Either.isLeft(Schema.decodeUnknownEither(ProfileKey)(key))).toBe(
			true,
		);
		expect(
			Either.isLeft(
				Schema.decodeUnknownEither(ProfileKey)({ ...key, compatibility: {} }),
			),
		).toBe(true);
		expect(
			Either.isRight(
				Schema.decodeUnknownEither(ProfileKey)({
					...key,
					compatibility: { unsupported: true, original: { type: "unknown" } },
				}),
			),
		).toBe(true);
	});
	it("normalizes absent flags and optional fields without raw null", () => {
		const key = createEmptyProfileKey("1,1");
		expect(key.config).toMatchObject({
			supportKnob: false,
			supportTouchEffect: false,
		});
		expect(key.childrenName).toEqual(Option.none());
		expect(Schema.encodeSync(ProfileTitle)(key.config.title)).toEqual(
			EMPTY_PROFILE_TITLE,
		);
		expect(Schema.decodeUnknownSync(ProfileEditPolicy)({})).toEqual({
			title: true,
			grid: true,
			icon: true,
			allowDelete: true,
			allowDrag: true,
		});
		const encoded = Schema.encodeSync(ProfileKey)(key);
		expect(encoded).not.toHaveProperty("childrenName");
		expect(encoded.config).not.toHaveProperty("alterTitle");
	});

	it.each([
		{ text: 1 },
		{ pos: "bottom" },
		{ size: 0 },
		{ size: Infinity },
		{ size: NaN },
		{ color: "red" },
		{ color: "#FFF" },
		{ display: 1 },
		{ style: "bold|blink" },
		{ style: "bold|bold" },
		{ resourceId: -1 },
		{ resourceId: "" },
		{ resourceId: null },
	])("rejects malformed title %j", (invalid) => {
		expect(
			Either.isLeft(
				Schema.decodeUnknownEither(ProfileTitle)({
					...EMPTY_PROFILE_TITLE,
					...invalid,
				}),
			),
		).toBe(true);
	});

	it.each([
		{ keyCode: "01,1" },
		{ keyCode: "1, 1" },
		{ keyCode: "3,1" },
		{ keyCode: "1,9" },
		{ childrenName: null },
		{ childrenName: undefined },
		{ config: {} },
	])("rejects malformed key %j", (invalid) => {
		expect(
			Either.isLeft(
				Schema.decodeUnknownEither(ProfileKey)({
					...completeEncodedKey(),
					...invalid,
				}),
			),
		).toBe(true);
	});
	it.each([
		{ type: 1 },
		{ title: {} },
		{ size: [0, 1] },
		{ size: [1, 3] },
		{ size: [1.5, 1] },
		{ display: "false" },
		{ supportKnob: null },
		{ supportTouchEffect: 1 },
		{ icon: null },
		{ alterTitle: null },
		{ alterIcon: 2 },
		{ actions: [{}] },
		{ actions: [{ type: "hotkey" }] },
		{ actions: [{ type: "hotkey", value: Infinity }] },
		{ subActions: [1] },
		{ basicEditableItems: { title: "false" } },
		{ basicEditableItems: { grid: 0 } },
		{ basicEditableItems: { icon: null } },
		{ basicEditableItems: { allowDelete: 0 } },
		{ basicEditableItems: { allowDrag: "no" } },
	])("rejects malformed key config %j", (invalid) => {
		const key = completeEncodedKey();
		expect(
			Either.isLeft(
				Schema.decodeUnknownEither(ProfileKey)({
					...key,
					config: { ...key.config, ...invalid },
				}),
			),
		).toBe(true);
	});
	it("requires nonempty authored identifiers and strict versioned collections", () => {
		const fixture = completeEncodedEnvelope();
		for (const invalid of [
			{ ...fixture, schemaVersion: 2 },
			{ ...fixture, profiles: [] },
			{ ...fixture, profiles: [...fixture.profiles, ...fixture.profiles] },
			...[
				{ id: "" },
				{ name: " " },
				{ revision: -1 },
				{ revision: 0.5 },
				{ pages: [] },
				{
					pages: [fixture.profiles[0]?.pages[0], fixture.profiles[0]?.pages[0]],
				},
			].map((fields) => ({
				...fixture,
				profiles: [{ ...fixture.profiles[0], ...fields }],
			})),
		])
			expect(
				Either.isLeft(Schema.decodeUnknownEither(ProfileEnvelope)(invalid)),
			).toBe(true);
	});
	it.prop(
		"round trips arbitrary titles and both resource identifier forms",
		[fc.string(), fc.oneof(fc.nat(), fc.string({ minLength: 1 }))],
		([text, resourceId]) => {
			const input = { ...EMPTY_PROFILE_TITLE, text, resourceId };
			expect(
				Schema.encodeSync(ProfileTitle)(
					Schema.decodeUnknownSync(ProfileTitle)(input),
				),
			).toEqual(input);
		},
	);
});
