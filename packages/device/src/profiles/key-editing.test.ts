import { describe, expect, it } from "@effect/vitest";
import {
	Effect,
	Array as EffectArray,
	FastCheck as fc,
	Layer,
	Option,
	Schema,
} from "effect";
import {
	DEFAULT_KEY_TITLE_STYLE,
	editKeyTitle,
	editKeyTitleStyle,
	iconInUse,
	keyText,
	keyTitle,
	resetKeyIcons,
	titleWeight,
	truncateKeyTitle,
} from "./key-editing-invariants.js";
import { KeyEditing } from "./key-editing-service.js";
import { builtinProfiles, profileText } from "./profile-catalog.js";
import {
	createEmptyProfileKey,
	encodeProfileEnvelope,
	ProfileEnvelope,
	ProfileKey,
} from "./profile-contracts.js";
import {
	ProfileRepository,
	profileStorageLayer,
} from "./profile-repository.js";
import { ProfileService } from "./profile-service.js";

const key = Schema.decodeUnknownSync(ProfileKey)({
	...Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1")),
	childrenName: "hotkey",
	config: {
		...Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1")).config,
		type: "hotkey",
		actions: [{ type: "key", value: "control+a" }],
	},
});
const seed = () =>
	Schema.decodeUnknownSync(ProfileEnvelope)({
		schemaVersion: 1,
		profiles: [
			{
				id: "p",
				name: "Profile",
				revision: 0,
				pages: [{ id: "one", keys: [Schema.encodeSync(ProfileKey)(key)] }],
			},
		],
		activeByDevice: {},
	});
function setup(fail = false, initial = seed()) {
	let stored = encodeProfileEnvelope(initial);
	let writes = 0;
	const repository = ProfileRepository.Default.pipe(
		Layer.provide(
			profileStorageLayer({
				read: async () => stored,
				write: async (next) => {
					if (fail) throw new Error("disk secret=do-not-print");
					stored = next;
					writes++;
				},
			}),
		),
	);
	return {
		layer: KeyEditing.DefaultWithoutDependencies.pipe(
			Layer.provideMerge(
				ProfileService.DefaultWithoutDependencies.pipe(
					Layer.provideMerge(repository),
				),
			),
		),
		writes: () => writes,
	};
}
const target = {
	token: "draft",
	profileId: "p",
	pageId: "one",
	keyCode: "1,1",
	revision: 0,
};
describe("key editing", () => {
	it.prop(
		"bounds Unicode input without splitting a surrogate pair",
		[fc.string()],
		([text]) => {
			const truncated = truncateKeyTitle(text);
			expect(titleWeight(truncated)).toBeLessThanOrEqual(20);
			expect(text.startsWith(truncated)).toBe(true);
			expect(truncateKeyTitle(truncated)).toBe(truncated);
		},
	);
	it("counts only the recovered CJK range twice", () => {
		expect(titleWeight("中A😀")).toBe(5);
		expect(truncateKeyTitle("中".repeat(11))).toBe("中".repeat(10));
	});
	it("resolves eight locales and retains explicit empty and English default titles", () => {
		const source = builtinProfiles("darwin")
			.find((p) => p.id === "1-1")
			?.pages[0].keys.find((k) => k.config.title.text === "Start");
		expect(source).toBeDefined();
		if (!source) return;
		for (const locale of [
			"en",
			"zh",
			"de",
			"es",
			"fr",
			"it",
			"ja",
			"ko",
		] as const) {
			expect(keyTitle(source, locale)).not.toBe("");
			for (const text of ["Start", "My title", ""]) {
				const edited = editKeyTitle(source, text),
					roundtrip = Schema.decodeUnknownSync(ProfileKey)(
						Schema.encodeSync(ProfileKey)(edited),
					);
				expect(keyTitle(roundtrip, locale)).toBe(text);
			}
		}
		expect(keyTitle(source, "zh")).not.toBe(keyTitle(source, "en"));
	});
	it("auto-styles primary and alternate title edits, then retains explicit styles without changing text origin", () => {
		for (const alternate of [false, true]) {
			const edited = editKeyTitle(key, "Label", alternate);
			const title = alternate
				? Option.getOrElse(edited.config.alterTitle, () => edited.config.title)
				: edited.config.title;
			expect(title).toMatchObject({
				text: "Label",
				display: true,
				pos: "top",
				style: "",
			});
			const styled = editKeyTitleStyle(
				edited,
				{ ...title, pos: "mid", size: 18, color: "#123456", style: "italic" },
				alternate,
			);
			const reset = editKeyTitleStyle(
				styled,
				DEFAULT_KEY_TITLE_STYLE,
				alternate,
			);
			const roundtrip = Schema.decodeUnknownSync(ProfileKey)(
				Schema.encodeSync(ProfileKey)(reset),
			);
			const result = alternate
				? Option.getOrElse(
						roundtrip.config.alterTitle,
						() => roundtrip.config.title,
					)
				: roundtrip.config.title;
			expect(result).toMatchObject({
				...DEFAULT_KEY_TITLE_STYLE,
				text: "Label",
				userModifiedStyle: true,
			});
			expect(keyTitle(roundtrip, "de", alternate)).toBe("Label");
		}
	});
	it.effect(
		"previews without writes, reverts, then commits a complete revision",
		() => {
			const fixture = setup();
			return Effect.gen(function* () {
				const editing = yield* KeyEditing,
					profiles = yield* ProfileService;
				const draft = editKeyTitle(key, "Draft");
				yield* editing.preview(target, Schema.encodeSync(ProfileKey)(draft));
				expect(
					(yield* editing.read()).profiles[0].pages[0].keys[0]?.config.title
						.text,
				).toBe("Draft");
				expect(
					(yield* profiles.loadProfiles()).envelope.profiles[0].pages[0].keys[0]
						?.config.title.text,
				).toBe("");
				expect(fixture.writes()).toBe(0);
				yield* editing.revert("stale");
				expect(Option.isSome(yield* editing.pending)).toBe(true);
				yield* editing.revert(target.token);
				expect(
					(yield* editing.read()).profiles[0].pages[0].keys[0]?.config.title
						.text,
				).toBe("");
				yield* editing.preview(target, Schema.encodeSync(ProfileKey)(draft));
				yield* editing.save(target.token);
				expect(
					(yield* profiles.loadProfiles()).envelope.profiles[0].revision,
				).toBe(1);
				expect(fixture.writes()).toBe(1);
				expect(Option.isNone(yield* editing.pending)).toBe(true);
			}).pipe(Effect.provide(fixture.layer));
		},
	);
	it.effect(
		"retains a draft on a revision conflict and never overwrites concurrent data",
		() => {
			const fixture = setup();
			return Effect.gen(function* () {
				const editing = yield* KeyEditing,
					repository = yield* ProfileRepository;
				yield* editing.preview(
					target,
					Schema.encodeSync(ProfileKey)(editKeyTitle(key, "Draft")),
				);
				yield* repository.transact((env) =>
					Effect.succeed({
						...env,
						profiles: EffectArray.map(env.profiles, (p) => ({
							...p,
							revision: p.revision + 1,
							name: "Concurrent",
						})),
					}),
				);
				const result = yield* Effect.either(editing.save(target.token));
				expect(result._tag).toBe("Left");
				if (result._tag === "Left")
					expect(result.left.code).toBe("QUAKE.PROFILE.REVISION_CONFLICT");
				expect(Option.isSome(yield* editing.pending)).toBe(true);
				expect((yield* repository.load()).envelope.profiles[0].name).toBe(
					"Concurrent",
				);
				expect(fixture.writes()).toBe(1);
			}).pipe(Effect.provide(fixture.layer));
		},
	);
	it.effect("failed disk write retains draft and committed revision", () => {
		const fixture = setup(true);
		return Effect.gen(function* () {
			const editing = yield* KeyEditing;
			yield* editing.preview(
				target,
				Schema.encodeSync(ProfileKey)(editKeyTitle(key, "Draft")),
			);
			const failed = yield* Effect.either(editing.save(target.token));
			expect(failed._tag).toBe("Left");
			if (failed._tag === "Left")
				expect(failed.left.code).toBe("QUAKE.PROFILE.WRITE_FAILED");
			expect(Option.isSome(yield* editing.pending)).toBe(true);
		}).pipe(Effect.provide(fixture.layer));
	});
	it("finds alternate and nested artwork references", () => {
		expect(
			iconInUse(
				{ alterIcon: "chosen", subActions: [{ config: { icon: "nested" } }] },
				new Set(["chosen"]),
			),
		).toBe(true);
		expect(iconInUse({ other: "none" }, new Set(["chosen"]))).toBe(false);
	});
});

it("keeps alternate custom title origin separate and resets both icons from default metadata", () => {
	const key = createEmptyProfileKey("1,1");
	const source = {
		...key,
		config: {
			...key.config,
			icon: "changed",
			alterIcon: Option.some("changed-alternate"),
			compatibility: Option.some({
				defaultIcon: "default",
				defaultAlterIcon: "default-alternate",
			}),
		},
	};
	const edited = editKeyTitle(source, "Alternate", true);
	expect(keyTitle(edited, "de", true)).toBe("Alternate");
	expect(edited.config.userModifiedTitle).toBeUndefined();
	const reset = resetKeyIcons(edited);
	expect(reset.config.icon).toBe("default");
	expect(Option.getOrUndefined(reset.config.alterIcon)).toBe(
		"default-alternate",
	);
	expect(keyTitle(reset, "ja", true)).toBe("Alternate");
});

it.effect(
	"cosmetic saves retain legacy sequence payload despite editor row IDs; executable changes still reject",
	() => {
		const initial = encodeProfileEnvelope(seed());
		const raw = Schema.encodeSync(ProfileKey)(key);
		const legacy = Schema.decodeUnknownSync(ProfileKey)({
			...raw,
			config: {
				...raw.config,
				type: "multiActions",
				actions: [],
				subActions: [
					{
						config: {
							type: "retainedLegacy",
							actions: [],
							vendorOption: "synthetic",
						},
					},
				],
			},
		});
		const envelope = {
			...seed(),
			profiles: EffectArray.map(seed().profiles, (p) => ({
				...p,
				pages: EffectArray.map(p.pages, (page) => ({
					...page,
					keys: [legacy],
				})),
			})),
		};
		const f = setup(false, envelope);
		return Effect.gen(function* () {
			const editing = yield* KeyEditing;
			const changed = Schema.encodeSync(ProfileKey)(legacy);
			const rows = changed.config.subActions ?? [];
			const edited = {
				...changed,
				config: {
					...changed.config,
					title: { ...changed.config.title, text: "Cosmetic" },
					subActions: rows.map((row) => ({ ...row, editorId: "row-1" })),
				},
			};
			yield* editing.preview(target, edited);
			yield* editing.save(target.token);
			const saved = (yield* editing.read()).profiles[0].pages[0].keys[0];
			if (!saved) return yield* Effect.die("Missing saved sequence");
			expect(saved.config.title.text).toBe("Cosmetic");
			expect(
				Schema.encodeSync(ProfileKey)(saved).config.subActions?.[0]?.config,
			).toEqual(rows[0]?.config);
			yield* editing.preview(
				{ ...target, revision: 1 },
				{
					...edited,
					config: {
						...edited.config,
						subActions: [
							{
								editorId: "row-1",
								config: {
									type: "retainedLegacy",
									actions: [],
									vendorOption: "changed",
								},
							},
						],
					},
				},
			);
			expect((yield* Effect.either(editing.save(target.token)))._tag).toBe(
				"Left",
			);
			expect(initial.profiles[0]?.id).toBe("p");
		}).pipe(Effect.provide(f.layer));
	},
);

it("preserves imported source identity independently for reset states without defaults", () => {
	const key = createEmptyProfileKey("1,1");
	const imported = {
		...key,
		config: {
			...key.config,
			icon: "portable-primary",
			alterIcon: Option.some("portable-alternate"),
			compatibility: Option.some({
				iconSource: "pack-primary",
				alternateIconSource: "pack-alternate",
			}),
		},
	};
	expect(resetKeyIcons(imported)).toEqual(imported);
	const partial = resetKeyIcons({
		...imported,
		config: {
			...imported.config,
			compatibility: Option.some({
				iconSource: "pack-primary",
				alternateIconSource: "pack-alternate",
				defaultIcon: "",
			}),
		},
	});
	expect(partial.config.icon).toBe("");
	expect(partial.config.alterIcon).toEqual(imported.config.alterIcon);
	const metadata = Option.getOrThrow(partial.config.compatibility);
	expect(metadata.iconSource).toBe("");
	expect(metadata.alternateIconSource).toBe("pack-alternate");
	expect(iconInUse(partial, new Set(["pack-alternate"]))).toBe(true);
	const alternate = resetKeyIcons({
		...imported,
		config: {
			...imported.config,
			compatibility: Option.some({
				iconSource: "pack-primary",
				alternateIconSource: "pack-alternate",
				defaultAlterIcon: "alternate-default",
			}),
		},
	});
	expect(alternate.config.icon).toBe("portable-primary");
	expect(Option.getOrThrow(alternate.config.compatibility).iconSource).toBe(
		"pack-primary",
	);
	expect(
		Option.getOrThrow(alternate.config.compatibility).alternateIconSource,
	).toBe("alternate-default");
});

it("MGMT-100 recovers polluted hotkey and agent titles from all eight locales without changing custom text", () => {
	for (const origin of [
		"en",
		"zh",
		"de",
		"fr",
		"it",
		"es",
		"ja",
		"ko",
	] as const) {
		const hotkey = {
			...key,
			config: {
				...key.config,
				title: { ...key.config.title, text: keyText("hotkey", origin) },
			},
		};
		for (const locale of [
			"en",
			"zh",
			"de",
			"fr",
			"it",
			"es",
			"ja",
			"ko",
		] as const) {
			expect(keyTitle(hotkey, locale)).toBe(keyText("hotkey", locale));
			const agent = {
				...key,
				config: {
					...key.config,
					type: "clawbot",
					title: { ...key.config.title, text: keyText("clawbot", origin) },
					actions: [{ type: "agentId", value: "materialfinder" }],
				},
			};
			expect(keyTitle(agent, locale)).toBe(
				profileText("openclawAgents.materialfinder.name", locale),
			);
			expect(
				keyTitle(
					{ ...agent, config: { ...agent.config, userModifiedTitle: true } },
					locale,
				),
			).toBe(agent.config.title.text);
		}
		expect(
			keyTitle(
				{ ...hotkey, config: { ...hotkey.config, userModifiedTitle: true } },
				"en",
			),
		).toBe(hotkey.config.title.text);
	}
});
