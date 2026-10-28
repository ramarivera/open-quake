import {
	Effect,
	Array as EffectArray,
	Layer,
	ManagedRuntime,
	Option,
	Schema,
} from "effect";
import { describe, expect, it } from "vitest";
import {
	stripLayout,
	tileAt,
} from "../../../../apps/desktop/src/renderer/src/strip/geometry";
import { executeActionLeaf } from "../actions/action-service";
import { KeyRuntime, KeyRuntimePort } from "../actions/key-runtime-service";
import { QuakeDevice } from "../device-service";
import { makeFakeHardwareTransport } from "../hardware/hardware-fake";
import { hardwareKeyboardAdapter } from "../hardware/hardware-keyboard";
import { HardwareControls } from "../hardware/hardware-service";
import { keyEditable, keyTitle, resetKeyIcons } from "./key-editing-invariants";
import { editKeyLayout } from "./key-geometry";
import {
	builtinProfiles,
	profileLabel,
	profileText,
	translateProfile,
} from "./profile-catalog.js";
import {
	createEmptyProfileKey,
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
	type Profile,
	ProfileEnvelope,
} from "./profile-contracts.js";
import {
	applyManagerCommand,
	installProfileCatalog,
	truncateProfileName,
	visibleProfiles,
	weightedNameLength,
} from "./profile-manager-invariants.js";

describe("recovered catalog", () => {
	it("translates catalog titles but preserves edited regular and agent titles in duplicates", () => {
		for (const id of ["1-0", "1-8"]) {
			const source = builtinProfiles("win32").find((p) => p.id === id);
			if (!source) throw new Error("Missing fixture");
			const duplicate = {
				...source,
				id: "custom-1",
				pages: EffectArray.map(source.pages, (page) => ({
					...page,
					keys: page.keys.map((key) => ({
						...key,
						config: {
							...key.config,
							title: { ...key.config.title, text: "My own title" },
						},
					})),
				})),
			};
			for (const page of translateProfile(duplicate, "de").pages)
				for (const key of page.keys)
					expect(key.config.title.text).toBe("My own title");
			expect(translateProfile(source, "de").pages).not.toEqual(source.pages);
		}
	});
	it("decodes all nine layouts on each OS with exact Quick actions", () => {
		for (const platform of ["darwin", "win32", "linux"] as const) {
			const profiles = builtinProfiles(platform);
			expect(profiles.map((p) => p.id)).toEqual([
				"1-0",
				"1-1",
				"1-4",
				"1-2",
				"1-3",
				"1-5",
				"1-6",
				"1-7",
				"1-8",
			]);
			const quick = profiles.find((p) => p.id === "1-2");
			expect(quick?.pages[0].keys).toHaveLength(16);
			expect(
				quick?.pages[0].keys.find((k) => k.keyCode === "1,6")?.config.actions[0]
					?.value,
			).toBe(
				platform === "darwin"
					? "command+shift+4"
					: platform === "win32"
						? "command+shift+s"
						: "print",
			);
			expect(
				JSON.stringify(
					encodeProfileEnvelope({
						...createInitialProfileEnvelope(),
						profiles: [
							profiles[0] ?? createInitialProfileEnvelope().profiles[0],
							...profiles.slice(1),
						],
					}),
				),
			).not.toMatch(/spotify|nsfw|jailbreak|decokee\.com/i);
		}
	});
	it("keeps eight locale dictionaries and untranslated Quick source titles", () => {
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
			expect(profileText("meetingAssistant", locale)).not.toBe(
				"meetingAssistant",
			);
			const discord = builtinProfiles("win32", locale)[0];
			expect(discord?.pages[0].keys[0]?.config.title.text).toBe(
				profileText("defaultDiscordConfig.mute", locale),
			);
		}
		expect(
			builtinProfiles("linux")[3]?.pages[0].keys.find(
				(k) => k.keyCode === "1,8",
			)?.config.type,
		).toBe("cmd");
	});
	it("retains user profiles and hides Discord only on macOS", () => {
		const envelope = installProfileCatalog(
			createInitialProfileEnvelope(),
			"darwin",
		);
		expect(envelope.profiles).toHaveLength(10);
		expect(visibleProfiles(envelope)).toHaveLength(9);
		expect(visibleProfiles(envelope).some((p) => p.id === "1-0")).toBe(false);
		expect(installProfileCatalog(envelope, "darwin")).toBe(envelope);
	});
	it("counts weighted names and preserves code points on truncation", () => {
		expect(weightedNameLength("中文abc")).toBe(7);
		expect(truncateProfileName("中文中文中x")).toBe("中文中文中");
		let envelope = installProfileCatalog(
			createInitialProfileEnvelope(),
			"win32",
		);
		for (let i = 0; i < 20; i++) {
			const r = applyManagerCommand(envelope, { type: "create" });
			if (r._tag === "updated") envelope = r.envelope;
		}
		expect(visibleProfiles(envelope)).toHaveLength(30);
		expect(applyManagerCommand(envelope, { type: "create" })).toEqual({
			_tag: "rejected",
			reason: "limit",
		});
	});
});

// Exact recovered data goes through the canonical catalog and actual strip layout.
// Source: DefaultProfileData.js 141-564, 1336-1755, 3037-3353, 3901-4419.
it("AI-146 retains DKClaw agents, voice flags, TTS settings and the saved knob route", () => {
	const claw = builtinProfiles("win32").find((p) => p.id === "1-8");
	if (!claw) throw new Error("Missing DKClaw");
	const cell = (code: string) =>
		claw.pages[0].keys.find((k) => k.keyCode === code);
	expect(cell("1,1")?.config.actions).toEqual([
		{ type: "agentId", value: "default" },
		{ type: "ttsEngine", value: "qwen" },
		{ type: "modeltype", value: "qwen-audio-3.1-tts-flash" },
	]);
	for (const [code, agent] of [
		["1,5", "materialfinder"],
		["1,6", "stockmaster"],
		["2,5", "dataorganizer"],
		["2,6", "techex"],
	]) {
		expect(cell(code ?? "")?.config.type).toBe("clawbot");
		expect(cell(code ?? "")?.config.actions).toEqual([
			{ type: "voiceInput", value: true },
			{ type: "taskPrompt", value: "" },
			{ type: "agentId", value: agent },
		]);
	}
	const knob = Option.getOrThrow(claw.knob);
	expect(knob).toMatchObject({
		keyCode: "0,1",
		config: {
			type: "knob",
			subActions: [
				{
					childrenName: "assistant",
					config: {
						type: "assistant",
						actions: [
							{ type: "voiceRoute", value: "dkclaw" },
							{ type: "agentId", value: "main" },
						],
					},
				},
			],
		},
	});
});

it("MGMT-351 / MGMT-357 use exact catalog footprints and hit-test covered and hidden placeholders", () => {
	for (const [id, anchors, covered] of [
		[
			"1-8",
			["1,1", "1,5", "1,6", "1,7", "2,5", "2,6"],
			["1,2", "1,3", "1,4", "2,1", "2,2", "2,3", "2,4", "1,8", "2,7", "2,8"],
		],
		[
			"1-5",
			["1,1", "1,6", "1,7", "1,8", "2,6", "2,7", "2,8"],
			["1,2", "1,3", "1,4", "1,5", "2,1", "2,2", "2,3", "2,4", "2,5"],
		],
	] as const) {
		const profile = builtinProfiles("win32").find((p) => p.id === id);
		if (!profile) throw new Error("Missing preset");
		const layout = stripLayout(profile, profile.pages[0]);
		expect(layout.tiles.map((t) => t.keyCode)).toEqual(anchors);
		expect(new Set(layout.covered)).toEqual(new Set(covered));
		for (const tile of layout.tiles)
			expect(
				tileAt({ x: tile.slot.x + 30, y: tile.slot.y + 30 }, layout)?.keyCode,
			).toBe(tile.keyCode);
		const hidden = profile.pages[0].keys.filter((k) => !k.config.display);
		if (id === "1-8") {
			expect(hidden.map((k) => k.keyCode)).toEqual(["1,8", "2,7", "2,8"]);
			for (const code of ["1,4", "2,4", "1,8", "2,7", "2,8"]) {
				const placeholder = profile.pages[0].keys.find(
					(key) => key.keyCode === code,
				);
				if (!placeholder) throw new Error("Missing locked placeholder");
				expect(keyEditable(placeholder, "grid")).toBe(true);
				expect(keyEditable(placeholder, "icon")).toBe(true);
			}
		}
		const view = layout.tiles[0];
		if (!view) throw new Error("Missing AI panel");
		expect(view?.footprint).toMatchObject({
			width: id === "1-8" ? 4 : 5,
			height: 2,
		});
		if (id === "1-5") {
			expect(view).toMatchObject({
				hasTouchableSubElements: true,
				supportTouchEffect: false,
				pressFeedback: false,
			});
			for (const field of [
				"title",
				"grid",
				"icon",
				"allowDrag",
				"allowDelete",
			] as const)
				expect(keyEditable(view.key, field)).toBe(
					field !== "grid" && field !== "allowDelete",
				);
		}
	}
});

it("AI-147 retains all six saved Copilot roles and independent thinking/search controls", () => {
	const p = builtinProfiles("win32").find((p) => p.id === "1-5");
	if (!p) throw new Error("Missing AI Chat");
	expect(
		p.pages[0].keys
			.filter((k) => k.config.type === "aiChat")
			.map((k) => ({
				code: k.keyCode,
				icon: k.config.icon,
				actions: k.config.actions,
			})),
	).toMatchObject([
		{
			code: "1,6",
			icon: "0-112",
			actions: [
				{ type: "enableThinking", value: true },
				{ type: "enableSearch", value: true },
				{ type: "roleConfig", value: { roleId: 128 } },
			],
		},
		{
			code: "1,7",
			icon: "0-113",
			actions: [
				{ type: "enableThinking", value: false },
				{ type: "enableSearch", value: true },
				{ type: "roleConfig", value: { roleId: 6 } },
			],
		},
		{
			code: "1,8",
			icon: "0-114",
			actions: [
				{ type: "enableThinking", value: false },
				{ type: "enableSearch", value: true },
				{ type: "roleConfig", value: { roleId: 8 } },
			],
		},
		{
			code: "2,6",
			icon: "0-115",
			actions: [
				{ type: "enableThinking", value: false },
				{ type: "enableSearch", value: true },
				{ type: "roleConfig", value: { roleId: 93 } },
			],
		},
		{
			code: "2,7",
			icon: "0-116",
			actions: [
				{ type: "enableThinking", value: false },
				{ type: "enableSearch", value: true },
				{ type: "roleConfig", value: { roleId: 129 } },
			],
		},
		{
			code: "2,8",
			icon: "0-117",
			actions: [
				{ type: "enableThinking", value: false },
				{ type: "enableSearch", value: true },
				{ type: "roleConfig", value: { roleId: 84 } },
			],
		},
	]);
});

it("MGMT-353 permits Vivid move/title/icon while protecting full-screen resize/delete/overwrite", () => {
	const vivid = builtinProfiles("linux").find((p) => p.id === "1-4");
	if (!vivid) throw new Error("Missing Vivid");
	const key = vivid.pages[0].keys[0];
	if (!key) throw new Error("Missing vivid cell");
	expect(Option.getOrThrow(vivid.compatibility).mode).toBe(0);
	expect(key.config).toMatchObject({
		type: "colorfulScreen",
		icon: "",
		actions: [],
	});
	expect(keyEditable(key, "allowDrag")).toBe(true);
	expect(keyEditable(key, "grid")).toBe(false);
	expect(keyEditable(key, "allowDelete")).toBe(false);
	expect(
		editKeyLayout(vivid.pages[0].keys, key, { destination: "1,2" })._tag,
	).toBe("ready");
	expect(
		editKeyLayout(vivid.pages[0].keys, createEmptyProfileKey("1,1"), {
			replaceOverlaps: true,
		})._tag,
	).toBe("rejected");
});

for (const platform of ["win32", "darwin", "linux"] as const) {
	it(`MGMT-370 / MGMT-371 dispatches committed project and Help keys on ${platform}`, async () => {
		const p = builtinProfiles(platform).find((p) => p.id === "1-2");
		if (!p) throw new Error("Missing Quick");
		const urls: string[] = [];
		const envelope: ProfileEnvelope = {
			...createInitialProfileEnvelope(),
			profiles: [p],
			activeByDevice: { test: { profileId: p.id, pageId: "1" } },
		};
		const runtime = ManagedRuntime.make(
			KeyRuntime.DefaultWithoutDependencies.pipe(
				Layer.provide(
					Layer.succeed(KeyRuntimePort, {
						read: Effect.succeed(envelope),
						execute: (config) =>
							executeActionLeaf(config, {
								keyboard: Option.none(),
								text: Option.none(),
								application: Option.none(),
								media: Option.none(),
								website: Option.some({
									openUrl: (url) =>
										Effect.sync(() => {
											urls.push(url);
										}),
								}),
							}),
						publish: () => Effect.void,
						select: () => Effect.void,
						alarm: () => Effect.void,
					}),
				),
			),
		);
		try {
			for (const [code, title, url, icon] of [
				[
					"1,4",
					"open-quake",
					"https://github.com/ramarivera/open-quake",
					"0-93",
				],
				[
					"1,5",
					"Help",
					"https://github.com/ramarivera/open-quake/issues",
					platform === "darwin" ? "0-11" : "0-94",
				],
			]) {
				const key = p.pages[0].keys.find((k) => k.keyCode === code);
				expect(key?.config).toMatchObject({
					type: "website",
					title: { text: title },
					icon,
					actions: [{ type: "url", value: url }],
				});
				if (!key) throw new Error("Missing website");
				for (const field of [
					"title",
					"grid",
					"icon",
					"allowDelete",
					"allowDrag",
				] as const)
					expect(keyEditable(key, field)).toBe(true);
				await runtime.runPromise(
					KeyRuntime.activate("test", code ?? "", "press", {
						profileId: p.id,
						pageId: "1",
						revision: 0,
					}),
				);
				await runtime.runPromise(
					KeyRuntime.activate("test", code ?? "", "release"),
				);
			}
			expect(urls).toEqual([
				"https://github.com/ramarivera/open-quake",
				"https://github.com/ramarivera/open-quake/issues",
			]);
		} finally {
			await runtime.dispose();
		}
	});
	it(`MGMT-381 / MGMT-382 encodes editable Clipboard and Mac Expose presets with retained legacy flags on ${platform}`, async () => {
		const p = builtinProfiles(platform).find((p) => p.id === "1-2");
		if (!p) throw new Error("Missing Quick");
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const fake = yield* makeFakeHardwareTransport();
					const device = yield* QuakeDevice.pipe(
						Effect.provide(
							QuakeDevice.DefaultWithoutDependencies.pipe(
								Layer.provide(fake.layer),
							),
						),
					);
					const connection = yield* device.connect();
					const controls = yield* HardwareControls.pipe(
						Effect.provide(HardwareControls.Default),
					);
					const session = yield* controls.create(connection, {
						serial: "test",
						session: "test-1",
					});
					const runtime = yield* KeyRuntime.pipe(
						Effect.provide(
							KeyRuntime.DefaultWithoutDependencies.pipe(
								Layer.provide(
									Layer.succeed(KeyRuntimePort, {
										read: Effect.succeed<ProfileEnvelope>({
											...createInitialProfileEnvelope(),
											profiles: [p],
											activeByDevice: {
												test: { profileId: p.id, pageId: "1" },
											},
										}),
										execute: (config) =>
											executeActionLeaf(config, {
												website: Option.none(),
												text: Option.none(),
												application: Option.none(),
												media: Option.none(),
												keyboard: Option.some(hardwareKeyboardAdapter(session)),
											}),
										publish: () => Effect.void,
										select: () => Effect.void,
										alarm: () => Effect.void,
									}),
								),
							),
						),
					);
					const clipboard = p.pages[0].keys.find((k) => k.keyCode === "2,7");
					if (!clipboard) throw new Error("Missing Clipboard");
					expect(clipboard.config.actions).toEqual([
						{
							type: "key",
							value:
								platform === "darwin"
									? "command+shift+v"
									: platform === "win32"
										? "command+v"
										: "control+v",
						},
					]);
					expect(clipboard.config.icon).toBe("0-85");
					for (const field of [
						"title",
						"grid",
						"icon",
						"allowDelete",
						"allowDrag",
					] as const)
						expect(keyEditable(clipboard, field)).toBe(true);
					yield* runtime.activate("test", "2,7", "press");
					yield* runtime.activate("test", "2,7", "release");
					const mask =
						platform === "darwin" ? 10 : platform === "win32" ? 8 : 1;
					const expected = [
						[1, 16, 1, mask, 25],
						[1, 16, 0, mask, 25],
					];
					if (platform === "darwin") {
						const expose = p.pages[0].keys.find((k) => k.keyCode === "2,8");
						expect(expose?.config).toMatchObject({
							type: "hotkey",
							icon: "0-92",
							actions: [{ type: "key", value: "control+down" }],
						});
						yield* runtime.activate("test", "2,8", "press");
						yield* runtime.activate("test", "2,8", "release");
						expected.push([1, 16, 1, 1, 81], [1, 16, 0, 1, 81]);
					}
					expect((yield* fake.writes).map((b) => [...b.slice(3, 8)])).toEqual(
						expected,
					);
				}),
			),
		);
	});
}

// AI-265, AI-318, MGMT-360, MGMT-365: independent fixture, not copied from the shipped JSON.
describe("MeetAI recovered control contract", () => {
	it.each(["darwin", "win32", "linux"] as const)(
		"pins all six controls on %s",
		(platform) => {
			const profile = builtinProfiles(platform).find((p) => p.id === "1-1");
			expect(profile?.name).toBe("MeetAI");
			expect(profile && Option.getOrNull(profile.compatibility)).toMatchObject({
				resourceId: "1-1",
				builtin: "meetingAssistant",
				mode: 1,
			});
			const keys = profile?.pages[0].keys.filter((k) => k.config.type);
			expect(
				keys?.map((k) => ({
					keyCode: k.keyCode,
					type: k.config.type,
					title: k.config.title.text,
					size: k.config.size,
					icon: k.config.icon,
					actions: k.config.actions,
					alternateIcon: Option.getOrNull(k.config.alterIcon),
				})),
			).toEqual([
				{
					keyCode: "1,1",
					type: "liveAudioTranslateDisplay",
					title: "",
					size: [5, 2],
					icon: "0-80",
					actions: [{ type: "targetLanguage", value: "zh" }],
					alternateIcon: null,
				},
				{
					keyCode: "1,6",
					type: "meetingMinutes",
					title: "Start",
					size: [1, 2],
					icon: "0-61",
					actions: [{ type: "generateReport", value: true }],
					alternateIcon: null,
				},
				{
					keyCode: "1,7",
					type: "tempMeetingMinutes",
					title: "Record",
					size: [1, 1],
					icon: "0-99",
					actions: [],
					alternateIcon: null,
				},
				{
					keyCode: "1,8",
					type: "mic",
					title: "Mic Mute",
					size: [1, 1],
					icon: "0-59",
					actions: [
						{ type: "toggle", value: 0 },
						{ type: "toggle", value: 1 },
					],
					alternateIcon: "0-100",
				},
				{
					keyCode: "2,7",
					type: "liveAudioTranslate",
					title: "Translate",
					size: [1, 1],
					icon: "0-98",
					actions: [{ type: "targetLanguage", value: "zh" }],
					alternateIcon: null,
				},
				{
					keyCode: "2,8",
					type: "meetingRecordMark",
					title: "Mark",
					size: [1, 1],
					icon: "0-99",
					actions: [],
					alternateIcon: null,
				},
			]);
			expect(profile?.pages[0].keys).toHaveLength(16);
			expect(keys?.[0]?.compatibility).toMatchObject({
				value: {
					source: {
						config: {
							hasTouchableSubElements: true,
							supportTouchEffect: false,
						},
					},
				},
			});
			for (const key of keys ?? []) {
				for (const field of [
					"title",
					"grid",
					"icon",
					"allowDelete",
					"allowDrag",
				] as const)
					expect(keyEditable(key, field)).toBe(
						key.keyCode === "1,1" ||
							key.config.type === "mic" ||
							(field !== "grid" && field !== "allowDelete"),
					);
				expect(key.config.supportKnob).toBe(false);
			}
		},
	);
});

it("MGMT-255/340: reset uses every platform template, including Linux and clock, and keeps project URLs region-neutral", () => {
	for (const platform of ["linux", "darwin", "win32"] as const) {
		const catalog = builtinProfiles(platform);
		for (const profile of catalog)
			for (const page of profile.pages)
				for (const original of page.keys) {
					if (!original.config.type) continue;
					const edited = {
						...original,
						config: {
							...original.config,
							icon: "custom",
							alterIcon: Option.some("custom-alternate"),
							compatibility: Option.none(),
						},
						compatibility: Option.none(),
					};
					const reset = resetKeyIcons(edited, original);
					expect(reset.config.icon).toBe(
						original.config.type === "brightness"
							? "0-1"
							: original.config.icon,
					);
					expect(reset.config.actions).toEqual(original.config.actions);
					expect(reset.config.title).toEqual(original.config.title);
					if (Option.isSome(original.config.alterIcon))
						expect(reset.config.alterIcon).toEqual(original.config.alterIcon);
					else expect(reset.config.alterIcon).toEqual(edited.config.alterIcon);
				}
		const quick = catalog.find((p) => p.id === "1-2");
		const urls = quick?.pages.flatMap((p) =>
			p.keys.flatMap((k) =>
				k.config.actions.filter((a) => a.type === "url").map((a) => a.value),
			),
		);
		expect(urls).toContain("https://github.com/ramarivera/open-quake");
		expect(urls).toContain("https://github.com/ramarivera/open-quake/issues");
	}
});

it("MGMT-384: SysView ships one full-strip glass Celsius panel with exact input and lock flags", () => {
	const profile = builtinProfiles("linux").find((p) => p.id === "1-3");
	expect(profile?.pages[0].keys).toHaveLength(1);
	const key = profile?.pages[0].keys[0];
	expect(key?.keyCode).toBe("1,1");
	expect(key?.config).toMatchObject({
		type: "systemMonitorPanel",
		size: [8, 2],
		supportTouchEffect: false,
		supportKnob: false,
		display: true,
		actions: [
			{
				type: "monitorStyle",
				value: { styleId: "glass", background: { mode: "style", themes: {} } },
			},
		],
	});
	expect(
		Option.getOrUndefined(key?.compatibility ?? Option.none()),
	).toMatchObject({
		source: {
			config: { temperatureUnit: "celsius", hasTouchableSubElements: true },
		},
	});
	expect(
		Option.getOrUndefined(key?.config.basicEditableItems ?? Option.none()),
	).toEqual({
		title: false,
		grid: false,
		icon: false,
		allowDelete: false,
		allowDrag: false,
	});
});

describe("Agent profile display compatibility", () => {
	it("localizes persisted legacy and current defaults without changing stored data", () => {
		const source = builtinProfiles("darwin").find((p) => p.id === "1-8");
		if (!source) throw new Error("Missing Agent profile");
		const names = {
			en: "Agent",
			zh: "智能体",
			de: "Agent",
			es: "Agente",
			fr: "Agent",
			it: "Agente",
			ja: "エージェント",
			ko: "에이전트",
		} as const;
		for (const storedName of [
			"DK Claw",
			"DK-Claw",
			"DK龙虾",
			...Object.values(names),
		]) {
			const encoded = encodeProfileEnvelope({
				...createInitialProfileEnvelope(),
				profiles: [{ ...source, name: storedName }],
			});
			const saved = Schema.decodeUnknownSync(ProfileEnvelope)(
				JSON.parse(JSON.stringify(encoded)),
			);
			const profile = saved.profiles[0];
			for (const [locale, name] of Object.entries(names)) {
				expect(profileLabel(profile, locale as keyof typeof names)).toBe(name);
				const translated = translateProfile(
					profile,
					locale as keyof typeof names,
				);
				expect(translated.name).toBe(name);
				expect(translated.id).toBe("1-8");
				expect(translated.knob).toEqual(profile.knob);
				expect(
					translated.pages.flatMap((page) =>
						page.keys.map((key) => ({
							type: key.config.type,
							actions: key.config.actions,
						})),
					),
				).toEqual(
					profile.pages.flatMap((page) =>
						page.keys.map((key) => ({
							type: key.config.type,
							actions: key.config.actions,
						})),
					),
				);
			}
			expect(encodeProfileEnvelope(saved)).toEqual(encoded);
		}
	});
	it("preserves explicit renames and duplicate names across locale changes", () => {
		const source = builtinProfiles("darwin").find((p) => p.id === "1-8");
		if (!source) throw new Error("Missing Agent profile");
		for (const profile of [
			{ ...source, name: "My helper" },
			{ ...source, id: "custom-agent", name: "DK Claw" },
		]) {
			expect(profileLabel(profile, "ja")).toBe(profile.name);
			expect(translateProfile(profile, "de").name).toBe(profile.name);
		}
	});
});

it("shows the Agent titles for agent tiles saved before the rename", async () => {
	const { keyTitle } = await import("./key-editing-invariants.js");
	const profile = builtinProfiles("darwin").find((p) =>
		p.pages.some((page) => page.keys.some((k) => k.config.type === "quakeBot")),
	);
	const keys = profile?.pages.flatMap((page) => page.keys) ?? [];
	for (const [type, legacy, current] of [
		["quakeBot", "ClawBotView", "Agent"],
		["quakeBotInput", "ClawBotInput", "Agent input"],
	] as const) {
		const key = keys.find((k) => k.config.type === type);
		if (!key) throw new Error(`Missing ${type}`);
		const saved = {
			...key,
			config: {
				...key.config,
				title: { ...key.config.title, text: legacy },
				userModifiedTitle: false,
			},
		};
		expect(keyTitle(saved, "en")).toBe(current);
		expect(
			keyTitle(
				{ ...saved, config: { ...saved.config, userModifiedTitle: true } },
				"en",
			),
		).toBe(legacy);
	}
});

it("localizes fresh and persisted Agent defaults across source languages without changing custom titles or actions", () => {
	for (const sourceLocale of ["en", "zh", "ja", "de"] as const) {
		const profile = builtinProfiles("darwin", sourceLocale).find(
			(p) => p.id === "1-8",
		);
		if (!profile) throw new Error("Missing Agent fixture");
		for (const original of profile.pages[0].keys.filter(
			(key) => key.config.type === "clawbot",
		)) {
			const agent = original.config.actions.find((a) => a.type === "agentId");
			const name = `openclawAgents.${String(agent?.value)}.name`;
			expect(original.config.title.text).toBe(profileText(name, sourceLocale));
			for (const compatibility of [original.compatibility, Option.none()]) {
				const saved = { ...original, compatibility };
				for (const locale of ["en", "zh", "ja", "de"] as const) {
					expect(keyTitle(saved, locale)).toBe(profileText(name, locale));
					const input: Profile = {
						...profile,
						pages: [{ ...profile.pages[0], keys: [saved] }],
					};
					const rendered = translateProfile(input, locale).pages[0].keys[0];
					expect(rendered?.config.title.text).toBe(profileText(name, locale));
					expect(rendered?.config.actions).toEqual(saved.config.actions);
				}
				for (const text of [
					"我的自定义",
					"Custom label",
					profileText(name, "zh"),
					"",
				]) {
					const custom = {
						...saved,
						config: {
							...saved.config,
							userModifiedTitle: true,
							title: { ...saved.config.title, text },
						},
					};
					expect(keyTitle(custom, "en")).toBe(text);
					expect(
						translateProfile(
							{ ...profile, pages: [{ ...profile.pages[0], keys: [custom] }] },
							"en",
						).pages[0].keys[0]?.config.title.text,
					).toBe(text);
				}
			}
		}
	}
});

it("preserves an unmarked custom Discord title equal to another locale default", () => {
	const source = builtinProfiles("win32", "en").find(
		(profile) => profile.id === "1-0",
	);
	if (!source) throw new Error("Missing Discord fixture");
	const first = source.pages[0].keys[0];
	if (!first) throw new Error("Missing Discord key");
	const input: Profile = {
		...source,
		pages: [
			{
				...source.pages[0],
				keys: [
					{
						...first,
						config: {
							...first.config,
							userModifiedTitle: undefined,
							title: { ...first.config.title, text: "Stumm" },
						},
					},
				],
			},
		],
	};
	expect(
		translateProfile(input, "en").pages[0].keys[0]?.config.title.text,
	).toBe("Stumm");
});
