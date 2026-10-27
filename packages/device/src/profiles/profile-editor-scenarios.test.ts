import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Schema, Stream } from "effect";
import { InvalidKeyAction } from "../actions/action-errors.js";
import { KeyRuntime, KeyRuntimePort } from "../actions/key-runtime-service.js";
import { actionProfileFunctionContracts } from "../actions/profile-function-contracts.js";
import { editKeyTitle, keyTitle } from "./key-editing-invariants.js";
import { KeyEditing } from "./key-editing-service.js";
import { builtinProfiles } from "./profile-catalog.js";
import {
	createEmptyProfileKey,
	encodeProfileEnvelope,
	Profile,
	ProfileEnvelope,
	ProfileKey,
} from "./profile-contracts.js";
import { FORCED_TILE_SPANS } from "./profile-footprint.js";
import {
	ProfileFunctionContracts,
	profileFunctionContractsLayer,
} from "./profile-function-contracts.js";
import { inspectProfileImport, inspectProfileText } from "./profile-import.js";
import { occupiedCells } from "./profile-invariants.js";
import {
	ProfileRepository,
	profileStorageLayer,
} from "./profile-repository.js";
import { ProfileService } from "./profile-service.js";

const encodedKey = (code: string, extra: Record<string, unknown> = {}) => ({
	...Schema.encodeSync(ProfileKey)(createEmptyProfileKey(code)),
	childrenName: "hotkey",
	config: {
		...Schema.encodeSync(ProfileKey)(createEmptyProfileKey(code)).config,
		type: "hotkey",
		actions: [{ type: "key", value: "control+a" }],
		...extra,
	},
});
const fixture = (keys = [encodedKey("1,1"), encodedKey("1,2")]) => {
	let stored = Schema.decodeUnknownSync(ProfileEnvelope)({
		schemaVersion: 1,
		profiles: [
			{
				id: "p",
				name: "Editor",
				revision: 0,
				pages: [{ id: "one", keys }],
				knob: { keyCode: "0,1", config: { nested: { retained: [1, 2, 3] } } },
			},
		],
		activeByDevice: {
			a: { profileId: "p", pageId: "one" },
			b: { profileId: "p", pageId: "one" },
		},
	});
	let writes = 0;
	const repo = ProfileRepository.Default.pipe(
		Layer.provide(
			profileStorageLayer({
				read: async () => encodeProfileEnvelope(stored),
				write: async (value) => {
					stored = Schema.decodeUnknownSync(ProfileEnvelope)(value);
					writes++;
				},
			}),
		),
	);
	const layer = KeyEditing.DefaultWithoutDependencies.pipe(
		Layer.provideMerge(
			ProfileService.DefaultWithoutDependencies.pipe(Layer.provideMerge(repo)),
		),
	);
	return { layer, stored: () => stored, writes: () => writes };
};
const target = {
	token: "geometry",
	profileId: "p",
	pageId: "one",
	keyCode: "1,1",
	revision: 0,
};

describe("editor geometry scenarios", () => {
	for (const destination of ["2,8", "1,2"])
		it.effect(
			`previews, reverts and saves coordinate-only move/swap to ${destination}`,
			() => {
				const f = fixture();
				return Effect.gen(function* () {
					const editor = yield* KeyEditing;
					const original = f.stored().profiles[0].pages[0].keys[0];
					expect(original).toBeDefined();
					if (!original) return;
					yield* editor.preview(
						target,
						Schema.encodeSync(ProfileKey)(original),
						{ destination },
					);
					expect(f.writes()).toBe(0);
					expect(
						(yield* editor.read()).profiles[0].pages[0].keys.find(
							(k) => k.keyCode === destination,
						)?.config,
					).toEqual(original.config);
					yield* editor.revert(target.token);
					expect((yield* editor.read()).profiles[0].pages[0].keys).toEqual(
						f.stored().profiles[0].pages[0].keys,
					);
					yield* editor.preview(
						target,
						Schema.encodeSync(ProfileKey)(original),
						{ destination },
					);
					yield* editor.save(target.token);
					expect(f.writes()).toBe(1);
					expect(f.stored().profiles[0].revision).toBe(1);
					expect(
						f
							.stored()
							.profiles[0].pages[0].keys.find((k) => k.keyCode === destination)
							?.config,
					).toEqual(original.config);
				}).pipe(Effect.provide(f.layer));
			},
		);
	for (const field of [
		"title",
		"icon",
		"allowDelete",
		"grid",
		"allowDrag",
	] as const)
		it.effect(`enforces ${field} in the real editing service`, () => {
			const f = fixture([
				encodedKey("1,1", { basicEditableItems: { [field]: false } }),
			]);
			return Effect.gen(function* () {
				const editor = yield* KeyEditing;
				const raw = encodedKey("1,1", {
					basicEditableItems: { [field]: false },
				});
				yield* editor.preview(target, raw);
				expect(Option.isSome(yield* editor.pending)).toBe(true);
				const input = {
					...raw,
					config: {
						...raw.config,
						...(field === "title"
							? { title: { ...raw.config.title, text: "Changed" } }
							: {}),
						...(field === "icon" ? { icon: "changed" } : {}),
						...(field === "allowDelete"
							? { type: "text", actions: [{ type: "text", value: "Changed" }] }
							: {}),
						...(field === "grid" ? { size: [2, 1] } : {}),
					},
				};
				const result = yield* editor
					.preview(
						target,
						input,
						field === "allowDrag" ? { destination: "2,8" } : {},
					)
					.pipe(Effect.either);
				expect(result._tag === "Left" || result.right._tag === "rejected").toBe(
					true,
				);
				expect(f.writes()).toBe(0);
				expect(Option.isNone(yield* editor.pending)).toBe(true);
				expect(
					(yield* editor.save(target.token).pipe(Effect.either))._tag,
				).toBe("Left");
			}).pipe(Effect.provide(f.layer));
		});
	for (const field of ["allowDrag", "allowDelete"] as const)
		it.effect(
			`refuses replacing a covered key with ${field} false even after confirmation`,
			() => {
				const f = fixture([
					encodedKey("1,1"),
					encodedKey("1,2", { basicEditableItems: { [field]: false } }),
				]);
				return Effect.gen(function* () {
					const editor = yield* KeyEditing;
					const enlarged = encodedKey("1,1", { size: [2, 1] });
					expect(
						(yield* editor.preview(target, enlarged, { replaceOverlaps: true }))
							._tag,
					).toBe("rejected");
					expect(f.writes()).toBe(0);
				}).pipe(Effect.provide(f.layer));
			},
		);
	it.effect(
		"refuses swapping a locked target without changing either tile",
		() => {
			const f = fixture([
				encodedKey("1,1"),
				encodedKey("1,2", { basicEditableItems: { allowDrag: false } }),
			]);
			return Effect.gen(function* () {
				const editor = yield* KeyEditing;
				expect(
					(yield* editor.preview(target, encodedKey("1,1"), {
						destination: "1,2",
					}))._tag,
				).toBe("rejected");
				expect(f.writes()).toBe(0);
			}).pipe(Effect.provide(f.layer));
		},
	);
	it.effect(
		"requires confirmation, cancels cleanly, then commits overlapping span replacement once",
		() => {
			const f = fixture();
			return Effect.gen(function* () {
				const editor = yield* KeyEditing;
				const enlarged = encodedKey("1,1", { size: [2, 1] });
				expect(yield* editor.preview(target, enlarged)).toEqual({
					_tag: "confirmation",
					keyCodes: ["1,2"],
				});
				expect(
					(yield* editor.save(target.token).pipe(Effect.either))._tag,
				).toBe("Left");
				yield* editor.revert(target.token);
				expect(f.writes()).toBe(0);
				yield* editor.preview(target, enlarged, { replaceOverlaps: true });
				yield* editor.save(target.token);
				expect(
					f.stored().profiles[0].pages[0].keys.map((k) => k.keyCode),
				).toEqual(["1,1"]);
				expect(f.writes()).toBe(1);
			}).pipe(Effect.provide(f.layer));
		},
	);
	it.effect(
		"keeps inward edge geometry and refuses resizing every forced type",
		() => {
			const f = fixture([encodedKey("1,1")]);
			return Effect.gen(function* () {
				const editor = yield* KeyEditing;
				yield* editor.preview(target, encodedKey("1,1", { size: [2, 2] }), {
					destination: "2,8",
				});
				yield* editor.save(target.token);
				expect(
					occupiedCells(
						f.stored().profiles[0].pages[0].keys[0] ??
							createEmptyProfileKey("1,1"),
					),
				).toEqual(["1,7", "1,8", "2,7", "2,8"]);
			}).pipe(Effect.provide(f.layer));
		},
	);
	for (const type of FORCED_TILE_SPANS.keys())
		it.effect(`preserves forced ${type} span`, () => {
			const f = fixture([encodedKey("1,1", { type })]);
			return Effect.gen(function* () {
				const editor = yield* KeyEditing;
				expect(
					(yield* editor.preview(
						target,
						encodedKey("1,1", { type, size: [2, 1] }),
					))._tag,
				).toBe("rejected");
				expect(f.writes()).toBe(0);
			}).pipe(Effect.provide(f.layer));
		});
});

describe("page and diagnosed import scenarios", () => {
	for (const sentinel of [null, {}, { type: "" }])
		it(`reports original broken-link action indexes after sentinel ${JSON.stringify(sentinel)}`, () => {
			const source = {
				...encodedKey("1,1", {
					type: "createFolder",
					actions: [sentinel, { type: "folder", value: "missing" }],
				}),
				childrenName: "createFolder",
			};
			const report = inspectProfileImport([source]);
			expect(report.profile).toBeDefined();
			expect(
				report.diagnostics.filter((d) => d.code === "invalid-action"),
			).toEqual([
				{
					code: "invalid-action",
					path: "pages.0.keys.0.config.actions.1.value",
					blocking: false,
				},
			]);
			expect(report.diagnostics).toContainEqual({
				code: "legacy-sentinel",
				path: "pages.0.keys.0.config.actions.0",
				blocking: false,
			});
			expect(report.profile?.pages[0].keys[0]?.config.actions).toEqual([
				{ type: "folder", value: "" },
			]);
			expect(report.profile?.pages[0].keys[0]?.compatibility).toMatchObject({
				unsupported: true,
				source,
			});
		});
	it.effect(
		"dispatch retains a valid imported hotkey while excluding the diagnosed mismatch",
		() =>
			Effect.gen(function* () {
				const input = [
					{ ...encodedKey("1,1"), childrenName: "text" },
					encodedKey("1,2"),
				];
				const report = inspectProfileImport(input);
				expect(report.profile).toBeDefined();
				expect(
					report.diagnostics.filter((d) => d.code === "invalid-action"),
				).toEqual([
					{
						code: "invalid-action",
						path: "pages.0.keys.0.childrenName",
						blocking: false,
					},
				]);
				const envelope = Schema.decodeUnknownSync(ProfileEnvelope)({
					schemaVersion: 1,
					profiles: [report.profile],
					activeByDevice: {},
				});
				const contracts = yield* ProfileFunctionContracts;
				yield* contracts.validateProfile(envelope.profiles[0]);
				const dispatch = yield* contracts.dispatchSnapshot(envelope);
				expect(
					dispatch.profiles[0].pages[0].keys.map((k) => k.keyCode),
				).toEqual(["1,2"]);
				expect(envelope.profiles[0].pages[0].keys).toHaveLength(16);
				expect(
					envelope.profiles[0].pages[0].keys.filter(
						(key) => key.config.type !== "",
					),
				).toHaveLength(2);
			}).pipe(
				Effect.provide(
					profileFunctionContractsLayer(actionProfileFunctionContracts),
				),
			),
	);
	for (const childrenName of ["timer", "text"])
		it(`quarantines a valid hotkey with mismatched childrenName ${childrenName}`, () => {
			const source = { ...encodedKey("1,1"), childrenName };
			const report = inspectProfileImport([source]);
			expect(report.profile).toBeDefined();
			expect(report.diagnostics).toContainEqual({
				code: "invalid-action",
				path: "pages.0.keys.0.childrenName",
				blocking: false,
			});
			expect(report.profile?.pages[0].keys[0]?.compatibility).toMatchObject({
				unsupported: true,
				source,
			});
		});
	it("quarantines unsupported alternate visuals using the dispatch contract", () => {
		const key = encodedKey("1,1");
		const source = encodedKey("1,1", { alterTitle: key.config.title });
		const report = inspectProfileImport([source]);
		expect(report.diagnostics).toContainEqual({
			code: "invalid-action",
			path: "pages.0.keys.0.config.alterTitle",
			blocking: false,
		});
		expect(report.profile?.pages[0].keys[0]?.compatibility?.unsupported).toBe(
			true,
		);
	});
	it.effect(
		"creates/selects/deletes pages, repairs every selected device and retains knob data",
		() => {
			const f = fixture();
			return Effect.gen(function* () {
				const service = yield* ProfileService;
				const knob = f.stored().profiles[0].knob;
				yield* service.editPages({
					...target,
					type: "add-page",
					pageId: "two",
					deviceId: "a",
				});
				expect(f.stored().activeByDevice.a?.pageId).toBe("two");
				yield* service.selectProfile({
					deviceId: "b",
					profileId: "p",
					pageId: "two",
				});
				yield* service.editPages({
					...target,
					type: "delete-page",
					pageId: "two",
					revision: 1,
					deviceId: "a",
				});
				expect(
					Object.values(f.stored().activeByDevice).map((s) => s.pageId),
				).toEqual(["one", "one"]);
				expect(f.stored().profiles[0].knob).toEqual(knob);
				const writes = f.writes();
				const rejected = yield* service
					.editPages({
						...target,
						type: "delete-page",
						revision: 2,
						deviceId: "a",
					})
					.pipe(Effect.either);
				expect(rejected._tag).toBe("Left");
				expect(f.writes()).toBe(writes);
			}).pipe(Effect.provide(f.layer));
		},
	);
	it.effect(
		"repairs a middle-page deletion to the former index and rejects stale mutations",
		() => {
			const f = fixture();
			return Effect.gen(function* () {
				const service = yield* ProfileService;
				yield* service.editPages({
					...target,
					type: "add-page",
					pageId: "two",
					deviceId: "a",
				});
				yield* service.editPages({
					...target,
					revision: 1,
					type: "add-page",
					pageId: "three",
					deviceId: "a",
				});
				yield* service.selectProfile({
					deviceId: "b",
					profileId: "p",
					pageId: "two",
				});
				yield* service.editPages({
					...target,
					revision: 2,
					type: "delete-page",
					pageId: "two",
					deviceId: "a",
				});
				expect(f.stored().activeByDevice.b?.pageId).toBe("three");
				const stale = yield* service
					.editPages({
						...target,
						type: "add-page",
						pageId: "stale",
						deviceId: "a",
					})
					.pipe(Effect.either);
				expect(stale._tag === "Left" && stale.left.code).toBe(
					"QUAKE.PROFILE.REVISION_CONFLICT",
				);
			}).pipe(Effect.provide(f.layer));
		},
	);

	it("AI-011/012 and MGMT-405 migrate imported assistant settings through the real profile importer", () => {
		const input = [
			encodedKey("1,1", {
				type: "assistant",
				errorCode: 2004,
				aiConfigData: {
					modelType: "gpt-4o",
					aiEngineProvider: "DeepSeek",
					supportedModels: [
						{
							value: "DeepSeek",
							custom: true,
							models: [{ value: "my-model", label: "Mine", extra: 42 }],
						},
					],
				},
				sessionState: "assistantSessionError",
				animationState: "assistantAnimationProcessing",
				assistantType: "assistantTypeKeyConfig",
			}),
		];
		const report = inspectProfileImport(input);
		expect(report.profile).toBeDefined();
		expect(report.profile?.pages[0].keys[0]?.config).toMatchObject({
			aiConfigData: {
				modelType: "deepseek-v4-flash",
				aiEngineProvider: "deepseek",
				supportedModels: expect.arrayContaining([
					expect.objectContaining({
						value: "DeepSeek",
						custom: true,
						models: expect.arrayContaining([
							{ value: "my-model", label: "Mine", extra: 42 },
						]),
					}),
				]),
			},
			sessionState: "error",
			animationState: "processing",
			assistantType: "keyConfig",
			compatibility: {
				diagnosticCode: "CHAT.RESPONSE.TIMEOUT",
				legacyErrorCode: 2004,
			},
		});
	});
	it("reports optional fields, unknown functions and legacy sentinels before import", () => {
		const input = [
			encodedKey("1,1", {
				type: "cameraView",
				supportKnob: null,
				actions: [null, {}, { type: "", value: "" }],
			}),
		];
		const report = inspectProfileImport(input);
		expect(report.profile).toBeDefined();
		expect(new Set(report.diagnostics.map((d) => d.code))).toEqual(
			new Set(["unknown-function", "missing-optional", "legacy-sentinel"]),
		);
		expect(report.profile?.pages[0].keys[0]?.compatibility?.source).toEqual(
			input[0],
		);
	});
	it.effect(
		"imports inert camera JSON and knob, preserving reserved properties through unrelated Save and dispatch projection",
		() => {
			const f = fixture();
			const input = [
				encodedKey("1,1", {
					type: "cameraView",
					actions: [
						{
							type: "future",
							value: {
								["__proto__"]: { retained: true },
								constructor: { prototype: [1, 2] },
							},
						},
					],
				}),
				{ keyCode: "0,1", config: { nested: { intact: true } } },
			];
			return Effect.gen(function* () {
				const service = yield* ProfileService;
				yield* service.importProfile(JSON.stringify(input), "imported");
				const imported = yield* service.getProfile("imported");
				expect(Option.getOrThrow(imported.knob).config.nested).toEqual({
					intact: true,
				});
				const key = imported.pages[0].keys[0];
				if (!key) throw new Error("Missing imported key");
				const t = {
					...target,
					token: "import",
					profileId: imported.id,
					pageId: imported.pages[0].id,
				};
				yield* KeyEditing.preview(
					t,
					Schema.encodeSync(ProfileKey)(editKeyTitle(key, "Unrelated")),
				);
				yield* KeyEditing.save(t.token);
				const saved = yield* service.getProfile("imported");
				expect(
					JSON.stringify(Option.getOrThrow(saved.compatibility).source),
				).toBe(JSON.stringify(input));
				const stream = yield* service.subscribeDispatchProfiles();
				const dispatch = Option.getOrThrow(yield* Stream.runHead(stream));
				expect(
					dispatch.profiles.find((p) => p.id === imported.id)?.pages[0].keys,
				).toEqual([]);
				expect(
					f.stored().profiles.find((p) => p.id === imported.id)?.revision,
				).toBe(1);
			}).pipe(Effect.provide(f.layer));
		},
	);
	for (const source of [
		"{",
		"{}",
		JSON.stringify([encodedKey("1,1", { title: { text: "Invalid" } })]),
	])
		it(`blocks malformed import ${source.slice(0, 25)}`, () => {
			const report = inspectProfileText(source);
			expect(report.profile).toBeUndefined();
			expect(report.diagnostics.some((d) => d.blocking)).toBe(true);
		});
});

it("retains source indices after null slots and imports canonical profiles", () => {
	const report = inspectProfileImport([
		null,
		encodedKey("1,1", { type: "cameraView" }),
	]);
	expect(report.profile).toBeDefined();
	expect(report.diagnostics).toContainEqual({
		code: "legacy-sentinel",
		path: "pages.0.keys.0",
		blocking: false,
	});
	expect(report.diagnostics).toContainEqual({
		code: "unknown-function",
		path: "pages.0.keys.1.config.type",
		blocking: false,
	});
	const canonical = fixture().stored().profiles[0];
	const imported = inspectProfileImport(
		encodeProfileEnvelope(fixture().stored()).profiles[0],
	);
	expect(imported.profile?.knob).toEqual(
		Option.isSome(canonical.knob) ? canonical.knob.value : undefined,
	);
	expect(imported.profile?.pages[0].keys.length).toBe(16);
	expect(
		imported.profile?.pages[0].keys.filter((key) => key.config.type !== ""),
	).toHaveLength(2);
});

it.effect(
	"MGMT-090 creates a folder and locked Back in one save, then dispatches folder/Back while retaining parent menu identity",
	() => {
		const f = fixture();
		const folder = {
			...encodedKey("1,1", {
				type: "createFolder",
				actions: [{ type: "folder", value: "nested" }],
			}),
			childrenName: "createFolder",
		};
		const program = Effect.gen(function* () {
			const editor = yield* KeyEditing;
			expect((yield* editor.preview(target, folder))._tag).toBe("ready");
			yield* editor.save(target.token);
			const saved = f.stored();
			expect(saved.profiles[0].pages.map((p) => p.id)).toEqual([
				"one",
				"nested",
			]);
			const back = saved.profiles[0].pages[1]?.keys[0];
			expect(back?.config).toMatchObject({
				type: "back",
				icon: "0-5",
				actions: [{ type: "parentFolder", value: "one" }],
			});
			expect(
				Option.getOrThrow(back?.config.basicEditableItems ?? Option.none()),
			).toMatchObject({ grid: false, allowDelete: false, allowDrag: false });
			expect(f.writes()).toBe(1);
			const runtime = yield* KeyRuntime;
			yield* runtime.activate("a", "1,1", "press");
			expect(f.stored().activeByDevice.a).toEqual({
				profileId: "p",
				pageId: "nested",
			});
			yield* runtime.activate("a", "1,1", "release");
			yield* runtime.activate("a", "1,1", "press");
			expect(f.stored().activeByDevice.a).toEqual({
				profileId: "p",
				pageId: "one",
			});
		});
		const port = Layer.effect(
			KeyRuntimePort,
			Effect.gen(function* () {
				const service = yield* ProfileService;
				return KeyRuntimePort.of({
					read: Effect.sync(f.stored),
					execute: () => Effect.void,
					publish: () => Effect.void,
					alarm: () => Effect.void,
					select: (deviceId, profileId, pageId) =>
						service.selectProfile({ deviceId, profileId, pageId }).pipe(
							Effect.asVoid,
							Effect.mapError(
								(cause) => new InvalidKeyAction("activation", cause),
							),
						),
				});
			}),
		).pipe(Layer.provide(f.layer));
		return program.pipe(
			Effect.provide(
				KeyRuntime.DefaultWithoutDependencies.pipe(
					Layer.provide(port),
					Layer.provideMerge(f.layer),
				),
			),
		);
	},
);

it.effect(
	"MGMT-385 saves and selects a commented 2x6 device preset without adding shipped defaults",
	() => {
		const f = fixture();
		const legacy = Array.from({ length: 12 }, (_, index) => ({
			...Schema.encodeSync(ProfileKey)(
				createEmptyProfileKey(
					`${Math.floor(index / 6) + 1},${(index % 6) + 1}`,
				),
			),
			...(index === 0
				? {
						childrenName: "luminance",
						config: {
							...Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"))
								.config,
							type: "luminance",
							supportKnob: true,
							actions: [
								{ type: "level", value: 1 },
								{ type: "level", value: 0 },
							],
						},
					}
				: {}),
		}));
		return Effect.gen(function* () {
			const service = yield* ProfileService;
			yield* service.importProfile(JSON.stringify(legacy), "legacy-device");
			const saved = yield* service.getProfile("legacy-device");
			yield* service.selectProfile({
				deviceId: "a",
				profileId: "legacy-device",
				pageId: saved.pages[0].id,
			});
			expect(saved.pages[0].keys).toHaveLength(16);
			expect(
				Option.getOrThrow(
					saved.pages[0].keys[0]?.compatibility ?? Option.none(),
				).source,
			).toMatchObject({ childrenName: "luminance" });
			expect(f.stored().activeByDevice.a?.profileId).toBe("legacy-device");
			expect(f.stored().profiles).toHaveLength(2);
		}).pipe(Effect.provide(f.layer));
	},
);

it.effect(
	"MGMT-352 saves and reloads the exact DK Claw knob route and animations",
	() => {
		const f = fixture();
		const preset = builtinProfiles("linux").find(
			(profile) => profile.id === "1-8",
		);
		if (!preset) return Effect.die("missing DK Claw preset");
		const encoded = Schema.encodeSync(Profile)(preset);
		return Effect.gen(function* () {
			const service = yield* ProfileService;
			yield* service.importProfile(JSON.stringify(encoded), "dkclaw-import");
			const imported = yield* service.getProfile("dkclaw-import");
			const { revision: _revision, ...draft } =
				Schema.encodeSync(Profile)(imported);
			yield* service.saveProfile({
				expectedRevision: imported.revision,
				profile: { ...draft, name: "Saved Claw" },
			});
			const saved = yield* service.getProfile("dkclaw-import");
			expect(Schema.encodeSync(Profile)(saved).knob).toEqual(encoded.knob);
		}).pipe(Effect.provide(f.layer));
	},
);

it.effect(
	"MGMT-385 imports and selects the commented AI meeting preset while retaining its unsupported payload inert",
	() => {
		const f = fixture();
		// DefaultProfileData.js:1757-1783, commented DEFAULT_AI_FUNCTION_CONFIG.
		const key = {
			...Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1")),
			childrenName: "meetingMinutes",
			config: {
				...Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1")).config,
				type: "meetingMinutes",
				size: [2, 2],
				icon: "0-61",
				actions: [{ type: "generateReport", value: true }],
			},
		};
		return Effect.gen(function* () {
			const service = yield* ProfileService;
			yield* service.importProfile(JSON.stringify([key]), "legacy-ai");
			const saved = yield* service.getProfile("legacy-ai");
			yield* service.selectProfile({
				deviceId: "a",
				profileId: "legacy-ai",
				pageId: saved.pages[0].id,
			});
			expect(saved.pages[0].keys).toHaveLength(13);
			expect(
				Option.getOrThrow(
					saved.pages[0].keys[0]?.compatibility ?? Option.none(),
				),
			).toMatchObject({ unsupported: true, source: key });
			expect(new Set(saved.pages[0].keys.flatMap(occupiedCells)).size).toBe(16);
			expect(f.stored().activeByDevice.a?.profileId).toBe("legacy-ai");
		}).pipe(Effect.provide(f.layer));
	},
);

it.effect(
	"AI-334 saves alternate meeting viewer spans through the real editor and reload",
	() => {
		const f = fixture([
			encodedKey("1,1", {
				type: "liveAudioTranslateDisplay",
				size: [5, 2],
				actions: [],
			}),
		]);
		return Effect.gen(function* () {
			const editor = yield* KeyEditing;
			const result = yield* editor.preview(
				target,
				encodedKey("1,1", {
					type: "liveAudioTranslateDisplay",
					size: [3, 1],
					actions: [],
				}),
			);
			expect(result._tag).not.toBe("rejected");
			yield* editor.save(target.token);
			const restarted = Schema.decodeUnknownSync(ProfileEnvelope)(
				encodeProfileEnvelope(f.stored()),
			);
			const saved = restarted.profiles[0].pages[0].keys[0];
			expect(saved?.config.size).toEqual([3, 1]);
			expect(saved && occupiedCells(saved)).toEqual(["1,1", "1,2", "1,3"]);
			expect(f.writes()).toBe(1);
		}).pipe(Effect.provide(f.layer));
	},
);

it.effect(
	"MGMT-413 full key replacement persists an optional-field deletion instead of merging it back",
	() => {
		const title = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"))
			.config.title;
		const f = fixture([
			encodedKey("1,1", { title: { ...title, resourceId: "legacy-label" } }),
		]);
		return Effect.gen(function* () {
			const editor = yield* KeyEditing;
			const result = yield* editor.preview(
				target,
				encodedKey("1,1", { title }),
			);
			expect(result._tag).not.toBe("rejected");
			yield* editor.save(target.token);
			const saved = Schema.encodeSync(ProfileEnvelope)(f.stored());
			expect(
				saved.profiles[0].pages[0].keys[0]?.config.title.resourceId,
			).not.toBe("legacy-label");
			expect(f.writes()).toBe(1);
		}).pipe(Effect.provide(f.layer));
	},
);

it.effect(
	"MGMT-259 editor saves a user title equal to its English default without relocalizing after restart",
	() => {
		const f = fixture([encodedKey("1,1")]);
		return Effect.gen(function* () {
			const editor = yield* KeyEditing;
			const source = f.stored().profiles[0].pages[0].keys[0];
			if (!source) throw new Error("missing key");
			const edited = editKeyTitle(source, "Hotkey");
			yield* editor.preview(target, Schema.encodeSync(ProfileKey)(edited));
			yield* editor.save(target.token);
			const restarted = Schema.decodeUnknownSync(ProfileEnvelope)(
				encodeProfileEnvelope(f.stored()),
			);
			const saved = restarted.profiles[0].pages[0].keys[0];
			if (!saved) throw new Error("missing saved key");
			expect(keyTitle(saved, "de")).toBe("Hotkey");
			expect(saved.config.userModifiedTitle).toBe(true);
		}).pipe(Effect.provide(f.layer));
	},
);
