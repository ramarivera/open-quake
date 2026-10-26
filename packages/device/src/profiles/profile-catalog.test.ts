import { Array as EffectArray, Option } from "effect";
import { describe, expect, it } from "vitest";
import { keyEditable } from "./key-editing-invariants.js";
import {
	builtinProfiles,
	profileText,
	translateProfile,
} from "./profile-catalog.js";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
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
					expect(keyEditable(key, field)).toBe(key.keyCode === "1,1");
				expect(key.config.supportKnob).toBe(false);
			}
		},
	);
});
