import { expect, it } from "@effect/vitest";
import { Effect, Either, Option, Schema } from "effect";
import { builtinProfiles } from "./profile-catalog.js";
import {
	createEmptyProfileKey,
	createInitialProfileEnvelope,
	EMPTY_PROFILE_TITLE,
	encodeProfileEnvelope,
	Profile,
	ProfileKey,
} from "./profile-contracts.js";
import { inspectProfileImport } from "./profile-import.js";
import {
	applyManagerCommand,
	managerState,
    installProfileCatalog,
} from "./profile-manager-invariants.js";
import { editProfilePages } from "./profile-pages.js";

it.effect(
	"MGMT-086/088/089 adds ten complete pages, inherits a knob and repairs every first-page selection without renumbering",
	() =>
		Effect.gen(function* () {
			let envelope = createInitialProfileEnvelope();
			for (let i = 2; i <= 10; i++)
				envelope = yield* editProfilePages(envelope, {
					type: "add-page",
					profileId: "local-profile",
					pageId: String(i),
					deviceId: "serial",
					revision: i - 2,
				});
			const profile = envelope.profiles[0];
			expect(profile.pages).toHaveLength(10);
			for (const page of profile.pages.slice(1)) {
				expect(page.keys).toHaveLength(16);
				expect(
					page.keys.every(
						(key) =>
							key.config.type === "" &&
							key.config.actions.length === 0 &&
							key.config.title.text === EMPTY_PROFILE_TITLE.text &&
							key.config.title.size === EMPTY_PROFILE_TITLE.size &&
							Option.contains(key.config.title.resourceId, 0),
					),
				).toBe(true);
			}
			expect(Option.getOrThrow(profile.knob).config.subActions).toEqual([
				{
					type: "assistant",
					animations: ["0-47", "0-48", "0-49", "0-51"],
					actions: [
						{ type: "voiceRoute", value: "legacyAssistant" },
						{ type: "assistant", value: "" },
					],
				},
			]);
			expect(
				Either.isLeft(
					yield* editProfilePages(envelope, {
						type: "add-page",
						profileId: profile.id,
						pageId: "eleven",
						deviceId: "serial",
						revision: profile.revision,
					}).pipe(Effect.either),
				),
			).toBe(true);
			envelope = {
				...envelope,
				activeByDevice: {
					a: { profileId: profile.id, pageId: "local-page" },
					b: { profileId: profile.id, pageId: "local-page" },
				},
			};
			const next = yield* editProfilePages(envelope, {
				type: "delete-page",
				profileId: profile.id,
				pageId: "local-page",
				deviceId: "a",
				revision: profile.revision,
			});
			expect(next.profiles[0].pages.map((page) => page.id)).toEqual([
				"2",
				"3",
				"4",
				"5",
				"6",
				"7",
				"8",
				"9",
				"10",
			]);
			expect(next.activeByDevice).toEqual({
				a: { profileId: profile.id, pageId: "2" },
				b: { profileId: profile.id, pageId: "2" },
			});
		}),
);

it("MGMT-318/328/345 creates an exact custom template, stable anchor and monotonically allocated identity", () => {
	let envelope = createInitialProfileEnvelope();
	const selected = applyManagerCommand(envelope, {
		type: "select",
		id: "local-profile",
	});
	if (selected._tag !== "updated") throw new Error("select failed");
	const result = applyManagerCommand(selected.envelope, { type: "create" });
	if (result._tag !== "updated") throw new Error("create failed");
	envelope = result.envelope;
	const custom = envelope.profiles.find((p) => p.id === "custom-1");
	expect(custom?.name).toBe("Custom1");
	expect(envelope.activeByDevice["desktop-preview"]?.profileId).toBe(
		custom?.id,
	);
	expect(managerState(envelope).anchor).toEqual(Option.some("local-profile"));
	expect(custom?.pages[0].keys).toHaveLength(16);
	expect(
		custom?.pages[0].keys.every(
			(key) =>
				key.config.type === "" &&
				key.config.display &&
				key.config.actions.length === 0,
		),
	).toBe(true);
	expect(Option.getOrThrow(custom?.knob ?? Option.none()).config).toMatchObject(
		{
			icon: "0-50",
			subActions: [
				{ type: "assistant", animations: ["0-47", "0-48", "0-49", "0-51"] },
			],
		},
	);
});

it("MGMT-342/385 pads sparse legacy cells and retains unsupported legacy presets inert", () => {
	const raw = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
	const report = inspectProfileImport([
		{ ...raw, config: { ...raw.config, actions: [{ type: "", value: "" }] } },
	]);
	expect(report.profile?.pages[0].keys).toHaveLength(16);
	expect(
		report.profile?.pages[0].keys.every(
			(key) =>
				key.config.actions?.length === 0 &&
				key.config.display === true &&
				JSON.stringify(key.config.size) === "[1,1]",
		),
	).toBe(true);
});

it("MGMT-352 preserves DK Claw center routing and animations through import/encode", () => {
	const profile = builtinProfiles("win32").find((p) => p.id === "1-8");
	if (!profile) throw new Error("missing preset");
	const report = inspectProfileImport(Schema.encodeSync(Profile)(profile));
	expect(report.profile?.knob).toEqual(
		Schema.encodeSync(Profile)(profile).knob,
	);
	expect(JSON.stringify(report.profile?.knob)).toContain('"dkclaw"');
	expect(JSON.stringify(report.profile?.knob)).toContain('"main"');
	expect(
		encodeProfileEnvelope({
			...createInitialProfileEnvelope(),
			profiles: [profile],
		}).profiles[0]?.knob,
	).toEqual(report.profile?.knob);
});

it.each([-1, -2])(
	"MGMT-401 maps numeric page sentinel %s into a runnable canonical action",
	(value) => {
		const report = inspectProfileImport([
			{
				keyCode: "1,1",
				childrenName: "page",
				config: {
					...Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1")).config,
					type: "page",
					actions: [{ type: "page", value }],
				},
			},
		]);
		expect(report.profile).toBeDefined();
		expect(report.profile?.pages[0].keys[0]).toMatchObject({
			childrenName: value === -1 ? "previousPage" : "nextPage",
			config: { type: value === -1 ? "previousPage" : "nextPage", actions: [] },
			compatibility: { unsupported: false },
		});
	},
);


it("SETTINGS-059 atomically applies all default choices, preserves custom visibility and repairs hidden active profiles", () => {
    const base = installProfileCatalog(createInitialProfileEnvelope(), "win32");
    const envelope = { ...base, activeByDevice: { serial: { profileId: "1-1", pageId: base.profiles.find((p) => p.id === "1-1")?.pages[0].id ?? "1" } } };
    const before = encodeProfileEnvelope(envelope);
    expect(applyManagerCommand(envelope, { type: "default-visibility", ids: [] })).toEqual({ _tag: "rejected", reason: "last-builtin" });
    expect(applyManagerCommand(envelope, { type: "default-visibility", ids: ["missing"] })).toEqual({ _tag: "rejected", reason: "missing" });
    expect(encodeProfileEnvelope(envelope)).toEqual(before);
    const result = applyManagerCommand(envelope, { type: "default-visibility", ids: ["1-2", "1-8"] });
    if (result._tag !== "updated") throw new Error("visibility failed");
    expect(result.envelope.profiles.filter((p) => !managerState(result.envelope).hidden.includes(p.id)).map((p) => p.id)).toEqual(["1-2", "1-8", "local-profile"]);
    expect(result.envelope.activeByDevice.serial?.profileId).toBe("1-2");
    expect(result.envelope.profiles).toHaveLength(envelope.profiles.length);
});
