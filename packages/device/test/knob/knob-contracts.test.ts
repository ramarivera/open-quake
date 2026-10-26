import { describe, expect, it } from "@effect/vitest";
import { Either, FastCheck as fc, Option, Schema } from "effect";
import {
	emptyKnobSlot,
	extractLegacyKnob,
	InvalidKnobConfig,
	KnobEvent,
	KnobImport,
	KnobJson,
	KnobResource,
	KnobVoiceActions,
	migrateKnobResource,
	migrateKnobVoiceActions,
	replaceKnobSlot,
	validateKnobResource,
} from "../../src/knob/index.js";
import {
	brightness,
	knob,
	nextPage,
	previousPage,
	registry,
	rotate,
	session,
	voice,
} from "./fixtures.js";

const right = <A, E>(either: Either.Either<A, E>): A => {
	expect(Either.isRight(either)).toBe(true);
	if (Either.isLeft(either)) throw either.left;
	return either.right;
};
const legacy = (subActions: ReadonlyArray<KnobJson>) => ({
	keyCode: "0,1",
	config: { type: "knob", subActions },
});

describe("knob contracts", () => {
	it.prop(
		"round-trips every slot occupancy without compaction",
		[fc.tuple(fc.boolean(), fc.boolean(), fc.boolean())],
		([filled]) => {
			const slots = filled.map((active) =>
				active ? nextPage : emptyKnobSlot(),
			);
			const resource = right(
				Schema.decodeUnknownEither(KnobResource)({
					...knob(),
					config: { ...knob().config, subActions: slots },
				}),
			);
			const encoded = Schema.encodeSync(KnobResource)(resource);
			expect(
				right(
					Schema.decodeUnknownEither(KnobResource)(
						JSON.parse(JSON.stringify(encoded)),
					),
				),
			).toEqual(resource);
			expect(right(validateKnobResource(resource, registry))).toEqual(resource);
			expect(resource.config.subActions.map((s) => s.config.type)).toEqual(
				filled.map((a) => (a ? "nextPage" : "")),
			);
		},
	);
	it("retains a right-only assignment and rejects invalid identity or counts", () => {
		const resource = knob();
		expect(right(validateKnobResource(resource)).config.subActions).toEqual([
			emptyKnobSlot(),
			emptyKnobSlot(),
			nextPage,
		]);
		for (const input of [
			{ ...resource, keyCode: "1,1" },
			{ ...resource, config: { ...resource.config, subActions: [nextPage] } },
			{
				...resource,
				config: {
					...resource.config,
					subActions: [
						emptyKnobSlot(),
						emptyKnobSlot(),
						{
							...nextPage,
							config: {
								...nextPage.config,
								actions: [{ type: "surprise", value: "unsafe" }],
							},
						},
					],
				},
			},
		])
			expect(Either.isLeft(validateKnobResource(input))).toBe(true);
	});
	it("rejects hold-only and press-only functions in directional slots", () => {
		const pressOnly = registry.map((capability) => ({
			...capability,
			rotation: false,
		}));
		for (const [assignment, capabilities] of [
			[voice(), registry],
			[nextPage, pressOnly],
		] as const) {
			expect(
				Either.isRight(
					validateKnobResource(
						knob([assignment, emptyKnobSlot(), emptyKnobSlot()]),
						capabilities,
					),
				),
			).toBe(true);
			for (const name of ["left", "right"] as const) {
				const resource = knob(
					replaceKnobSlot(
						knob([emptyKnobSlot(), emptyKnobSlot(), emptyKnobSlot()]).config
							.subActions,
						name,
						assignment,
					),
				);
				const result = validateKnobResource(resource, capabilities);
				expect(Either.isLeft(result)).toBe(true);
				if (Either.isLeft(result))
					expect(result.left).toBeInstanceOf(InvalidKnobConfig);
			}
		}
		const disabled = registry.map((capability) => ({
			...capability,
			rotation: false,
			press: false,
			hold: false,
		}));
		expect(
			Either.isLeft(
				validateKnobResource(
					knob([nextPage, emptyKnobSlot(), emptyKnobSlot()]),
					disabled,
				),
			),
		).toBe(true);
	});
	it.prop(
		"slot edits preserve both other positions",
		[fc.constantFrom("center" as const, "left" as const, "right" as const)],
		([slot]) => {
			const before = knob().config.subActions;
			const after = replaceKnobSlot(before, slot, previousPage);
			const index = { center: 0, left: 1, right: 2 }[slot];
			expect(after[index]).toEqual(previousPage);
			for (let i = 0; i < 3; i++)
				if (i !== index) expect(after[i]).toEqual(before[i]);
			expect(before).toEqual(knob().config.subActions);
		},
	);
	it("rejects duplicate or out-of-route fields in newly authored voice actions", () => {
		const direct = voice().config.actions;
		for (const actions of [
			[...direct, direct[0]],
			[...direct, { type: "agentId", value: "main" }],
			[...direct, { type: "apiKey", value: "secret" }],
			[
				{ type: "directProvider", value: "p" },
				{ type: "directModel", value: "m" },
			],
		])
			expect(Schema.is(KnobVoiceActions)(actions)).toBe(false);
		expect(Schema.is(KnobVoiceActions)(voice("").config.actions)).toBe(true);
	});
	it("validates brightness steps and common title values", () => {
		for (const value of [0, -1, 101, 1.5, Number.NaN]) {
			const invalid = {
				...brightness,
				config: {
					...brightness.config,
					actions: [{ type: "stepPercent", value }],
				},
			};
			expect(
				Either.isLeft(
					validateKnobResource(
						knob([invalid, emptyKnobSlot(), emptyKnobSlot()]),
					),
				),
			).toBe(true);
		}
		for (const title of [
			{ ...knob().config.title, size: 0 },
			{ ...knob().config.title, style: "bold|bold" },
			{ ...knob().config.title, color: "red" },
		])
			expect(
				Schema.is(KnobResource)({
					...knob(),
					config: { ...knob().config, title },
				}),
			).toBe(false);
	});
	it("requires normalized positive detents and complete session/classification identity", () => {
		for (const input of [
			rotate(0),
			rotate(-1),
			rotate(1.5),
			rotate(Number.POSITIVE_INFINITY),
			rotate(Number.MAX_SAFE_INTEGER + 1),
			{ ...rotate(), session: { ...session, sessionId: "" } },
			{ _tag: "Release", session, pressId: "p" },
		])
			expect(Schema.is(KnobEvent)(input)).toBe(false);
		expect(Schema.is(KnobEvent)(rotate(3))).toBe(true);
	});
});

describe("voice migration", () => {
	it.prop(
		"splits at the first slash, preserves explicit fields, strips others, and is idempotent",
		[
			fc.stringMatching(/^[a-z]{1,12}$/),
			fc.stringMatching(/^[a-z]{1,12}$/),
			fc.stringMatching(/^[a-z]{1,12}$/),
		],
		([provider, model, tail]) => {
			const source = [
				{ type: "voiceRoute", value: "direct" },
				{ type: "directProvider", value: "custom" },
				{ type: "model", value: `${provider}/${model}/${tail}` },
				{ type: "assistant", value: "old" },
				{ type: "agentId", value: "other" },
			];
			const migrated = right(migrateKnobVoiceActions(source));
			expect(migrated.actions).toEqual([
				{ type: "voiceRoute", value: "direct" },
				{ type: "directProvider", value: "custom" },
				{ type: "directModel", value: `${model}/${tail}` },
			]);
			expect(migrated.original).toEqual(source);
			expect(right(migrateKnobVoiceActions(migrated))).toEqual(migrated);
			expect(right(migrateKnobVoiceActions(migrated.actions)).actions).toEqual(
				migrated.actions,
			);
		},
	);
	it("fills empty direct fields once without creating duplicates", () => {
		const migrated = right(
			migrateKnobVoiceActions([
				{ type: "voiceRoute", value: "direct" },
				{ type: "directProvider", value: "" },
				{ type: "directModel", value: "" },
				{ type: "model", value: "p/m/variant" },
			]),
		);
		expect(migrated.actions).toEqual([
			{ type: "voiceRoute", value: "direct" },
			{ type: "directProvider", value: "p" },
			{ type: "directModel", value: "m/variant" },
		]);
		expect(
			Either.isLeft(
				migrateKnobVoiceActions([
					{ type: "voiceRoute", value: "direct" },
					{ type: "voiceRoute", value: "dkclaw" },
				]),
			),
		).toBe(true);
	});
	it("preserves malformed JSON voice actions as inactive migration data", () => {
		const source = [{ type: "voiceRoute", value: 42 }];
		const migrated = right(migrateKnobVoiceActions(source));
		expect(migrated).toMatchObject({
			active: false,
			actions: [],
			original: source,
			diagnostics: ["unsupported-actions"],
		});
		expect(right(migrateKnobVoiceActions(migrated))).toEqual(migrated);
	});
	it("normalizes aliases only on import, and never redirects unknown routes", () => {
		for (const route of [undefined, "legacy", "assistant", "legacyAssistant"]) {
			const actions =
				route === undefined ? [] : [{ type: "voiceRoute", value: route }];
			expect(right(migrateKnobVoiceActions(actions)).actions).toEqual([
				{ type: "voiceRoute", value: "legacyAssistant" },
				{ type: "assistant", value: "" },
			]);
		}
		const source = [
			{ type: "voiceRoute", value: "mystery" },
			{ type: "model", value: "p/m" },
		];
		const migrated = right(migrateKnobVoiceActions(source));
		expect(migrated).toMatchObject({
			active: false,
			actions: [],
			original: source,
			diagnostics: ["unknown-route"],
		});
		expect(right(migrateKnobVoiceActions(migrated))).toEqual(migrated);
	});
	it("migrates dkclaw model while preserving explicit fields without inventing an agent", () => {
		expect(
			right(
				migrateKnobVoiceActions([
					{ type: "voiceRoute", value: "dkclaw" },
					{ type: "model", value: "p/m" },
					{ type: "directModel", value: "discard" },
				]),
			).actions,
		).toEqual([
			{ type: "voiceRoute", value: "dkclaw" },
			{ type: "agentId", value: "" },
			{ type: "dkclawModel", value: "p/m" },
		]);
		expect(
			right(
				migrateKnobVoiceActions([
					{ type: "voiceRoute", value: "dkclaw" },
					{ type: "agentId", value: "custom" },
					{ type: "dkclawModel", value: "explicit" },
					{ type: "model", value: "old" },
				]),
			).actions,
		).toEqual([
			{ type: "voiceRoute", value: "dkclaw" },
			{ type: "agentId", value: "custom" },
			{ type: "dkclawModel", value: "explicit" },
		]);
	});
});

describe("slot import compatibility", () => {
	it("preserves directional hold-only functions as inactive while importing usable slots", () => {
		for (const name of ["left", "right"] as const) {
			const source = knob(
				replaceKnobSlot(
					knob([nextPage, emptyKnobSlot(), emptyKnobSlot()]).config.subActions,
					name,
					voice(),
				),
			);
			const migrated = right(migrateKnobResource(source));
			expect(migrated.resource.config.subActions).toEqual([
				nextPage,
				emptyKnobSlot(),
				emptyKnobSlot(),
			]);
			expect(migrated.compatibility.inactiveSlots).toEqual({ [name]: voice() });
			expect(migrated.compatibility.diagnostics).toEqual(["unsupported-slot"]);
			expect(right(validateKnobResource(migrated.resource))).toEqual(
				migrated.resource,
			);
		}
	});
	it("keeps malformed assistant actions inactive without losing other slots or the backup", () => {
		const malformed: ReadonlyArray<KnobJson> = [
			42,
			"invalid",
			[null],
			[{ type: "voiceRoute", value: 42 }],
			[{ type: "directModel" }],
		];
		for (const actions of malformed) {
			const badSlot = {
				childrenName: "assistant",
				config: { type: "assistant", actions },
			};
			const source = legacy([badSlot, previousPage, nextPage]);
			const before = JSON.stringify(source);
			const migrated = right(migrateKnobResource(source));
			expect(migrated.resource.config.subActions).toEqual([
				emptyKnobSlot(),
				previousPage,
				nextPage,
			]);
			expect(migrated.compatibility).toMatchObject({
				original: source,
				inactiveSlots: { center: badSlot },
				diagnostics: ["unsupported-slot"],
			});
			expect(JSON.stringify(source)).toBe(before);
			expect(right(migrateKnobResource(migrated))).toEqual(migrated);
			expect(
				right(
					migrateKnobResource(
						JSON.parse(JSON.stringify(Schema.encodeSync(KnobImport)(migrated))),
					),
				),
			).toEqual(migrated);
		}
	});
	it("still rejects duplicate voice discriminators, including malformed duplicate values", () => {
		for (const value of ["dkclaw", 42]) {
			const badSlot = {
				childrenName: "assistant",
				config: {
					type: "assistant",
					actions: [
						{ type: "voiceRoute", value: "direct" },
						{ type: "voiceRoute", value },
					],
				},
			};
			expect(
				Either.isLeft(migrateKnobResource(legacy([badSlot, null, nextPage]))),
			).toBe(true);
		}
	});
	it.prop(
		"preserves explicit holes and the original payload without mutation",
		[fc.boolean(), fc.boolean(), fc.boolean()],
		([center, left, rightSlot]) => {
			const source = legacy([
				center ? nextPage : null,
				left ? previousPage : null,
				rightSlot ? nextPage : null,
			]);
			const before = JSON.stringify(source);
			const migrated = right(migrateKnobResource(source));
			expect(
				migrated.resource.config.subActions.map((s) => s.config.type),
			).toEqual([
				center ? "nextPage" : "",
				left ? "previousPage" : "",
				rightSlot ? "nextPage" : "",
			]);
			expect(JSON.stringify(source)).toBe(before);
			expect(migrated.compatibility.original).toEqual(source);
			expect(right(migrateKnobResource(migrated))).toEqual(migrated);
			const wire = JSON.parse(
				JSON.stringify(Schema.encodeSync(KnobImport)(migrated)),
			);
			expect(right(migrateKnobResource(wire))).toEqual(migrated);
		},
	);
	it("retains both ambiguous compact entries as inactive", () => {
		const source = legacy([previousPage, nextPage]);
		const migrated = right(migrateKnobResource(source));
		expect(migrated.resource.config.subActions).toEqual([
			emptyKnobSlot(),
			emptyKnobSlot(),
			emptyKnobSlot(),
		]);
		expect(migrated.compatibility).toMatchObject({
			original: source,
			inactiveSlots: { compact: [previousPage, nextPage] },
			diagnostics: ["ambiguous-slots"],
		});
	});
	it.prop(
		"preserves arbitrary unsupported compact payloads without activating them",
		[fc.jsonValue(), fc.jsonValue()],
		([first, second]) => {
			const source = legacy([
				{ payload: Schema.decodeUnknownSync(KnobJson)(first) },
				{ payload: Schema.decodeUnknownSync(KnobJson)(second) },
			]);
			const migrated = right(migrateKnobResource(source));
			expect(migrated.resource.config.subActions).toEqual([
				emptyKnobSlot(),
				emptyKnobSlot(),
				emptyKnobSlot(),
			]);
			expect(migrated.compatibility.original).toEqual(source);
			expect(right(migrateKnobResource(migrated))).toEqual(migrated);
		},
	);
	it("preserves an own __proto__ key in the untouched compatibility backup", () => {
		const payload: unknown = JSON.parse(
			'{"__proto__":[],"nested":{"__proto__":"preserved"}}',
		);
		const source = legacy([
			{ payload: Schema.decodeUnknownSync(KnobJson)(payload) },
			nextPage,
		]);
		const migrated = right(migrateKnobResource(source));
		expect(migrated.compatibility.original).toEqual(source);
		const wire = Schema.encodeSync(KnobImport)(migrated);
		expect(JSON.stringify(wire.compatibility.original)).toBe(
			JSON.stringify(source),
		);
		expect(Object.getPrototypeOf({})).toBe(Object.prototype);
	});

	it("retains malformed indexed slots as inactive instead of interpreting primitives as holes", () => {
		const migrated = right(migrateKnobResource(legacy([false, 23, "unknown"])));
		expect(migrated.compatibility.inactiveSlots).toEqual({
			center: false,
			left: 23,
			right: "unknown",
		});
		expect(migrated.compatibility.diagnostics).toEqual([
			"unsupported-slot",
			"unsupported-slot",
			"unsupported-slot",
		]);
	});

	it("accepts explicit slot tags and rejects duplicates or incomplete metadata", () => {
		const migrated = right(
			migrateKnobResource(
				legacy([
					{ ...nextPage, slot: "right" },
					{ ...previousPage, slot: "center" },
				]),
			),
		);
		expect(migrated.resource.config.subActions).toEqual([
			previousPage,
			emptyKnobSlot(),
			nextPage,
		]);
		for (const entries of [
			[
				{ ...nextPage, slot: "right" },
				{ ...previousPage, slot: "right" },
			],
			[{ ...nextPage, slot: "right" }, previousPage],
		])
			expect(Either.isLeft(migrateKnobResource(legacy(entries)))).toBe(true);
	});
	it("imports known center assistant presets, retaining legacy locks as metadata only", () => {
		for (const resourceId of ["1-0", "1-8", "DKClaw", "custom"]) {
			const source = legacy([{ config: voice().config }]);
			const migrated = right(migrateKnobResource(source, { resourceId }));
			expect(migrated.resource.config.subActions).toEqual([
				voice(),
				emptyKnobSlot(),
				emptyKnobSlot(),
			]);
			expect(migrated.compatibility.legacyRouteLock).toEqual(
				resourceId === "custom"
					? Option.none()
					: Option.some(resourceId === "1-0" ? "legacyAssistant" : "dkclaw"),
			);
		}
	});
	it("keeps ambiguous brightness targets and unsupported functions inert", () => {
		for (const type of ["brightness", "luminance", "homeAssistant"]) {
			const raw = {
				config: {
					type,
					actions: [{ type: "level", value: 1 }],
					animations: ["retained"],
				},
			};
			const migrated = right(migrateKnobResource(legacy([raw])));
			expect(migrated.resource.config.subActions[0]).toEqual(emptyKnobSlot());
			expect(migrated.compatibility.inactiveSlots.center).toEqual(raw);
		}
	});
	it("normalizes page aliases only inside explicit navigation imports", () => {
		const raw = {
			childrenName: "previousPage",
			config: { type: "pageUp", actions: [] },
		};
		const source = legacy([raw, null, null]);
		expect(
			right(migrateKnobResource(source)).resource.config.subActions[0],
		).toEqual(emptyKnobSlot());
		expect(
			right(migrateKnobResource(source, { navigationContext: true })).resource
				.config.subActions[0],
		).toEqual(previousPage);
	});
	it("recognizes recovered navigation preset containers only with navigation provenance", () => {
		const source = {
			keyCode: "0,1",
			childrenName: "previousPage",
			config: {
				type: "pageUp",
				subActions: [{ config: { type: "pageUp", actions: [] } }],
			},
		};
		expect(Either.isLeft(migrateKnobResource(source))).toBe(true);
		const migrated = right(
			migrateKnobResource(source, { navigationContext: true }),
		);
		expect(migrated.resource.config.subActions).toEqual([
			previousPage,
			emptyKnobSlot(),
			emptyKnobSlot(),
		]);
		expect(migrated.compatibility.original).toEqual(source);
	});

	it("rejects duplicate reserved entries and preserves unrelated keys during extraction", () => {
		const unrelated = {
			keyCode: "1,1",
			config: { type: "unknown", deeply: { nested: [1, 2, 3] } },
		};
		const source = legacy([null, null, nextPage]);
		const migrated = right(extractLegacyKnob([unrelated, source]));
		expect(migrated.keys).toEqual([unrelated]);
		expect(migrated.keys[0]).not.toBe(unrelated);
		expect(Option.isSome(migrated.knob)).toBe(true);
		expect(Either.isLeft(extractLegacyKnob([source, source]))).toBe(true);
	});
});
