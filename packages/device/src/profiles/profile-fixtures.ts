import { Schema } from "effect";
import {
	EMPTY_PROFILE_TITLE,
	type EncodedProfileEnvelope,
	ProfileEnvelope,
	ProfileKey,
} from "./profile-contracts.js";
import type { ProfileFunctionContract } from "./profile-function-contracts.js";

export const completeEncodedKey = (keyCode = "1,1") => ({
	keyCode,
	childrenName: "hotkey",
	config: {
		type: "hotkey",
		title: {
			...EMPTY_PROFILE_TITLE,
			text: "Launch",
			resourceId: "title-resource",
			pos: "top" as const,
			color: "#AABBCCDD",
		},
		size: [2, 1] as const,
		display: true,
		supportKnob: true,
		supportTouchEffect: true,
		icon: "local:primary",
		alterTitle: {
			...EMPTY_PROFILE_TITLE,
			text: "Stop",
			display: false,
			style: "",
		},
		alterIcon: "local:alternate",
		actions: [
			{ type: "hotkey", value: ["Ctrl", "A"] },
			{ type: "hotkey", value: ["Ctrl", "B"] },
		],
		subActions: [
			{ type: "group", entries: [{ type: "hotkey", value: ["Ctrl", "C"] }] },
		],
		basicEditableItems: {
			title: false,
			grid: true,
			icon: false,
			allowDelete: true,
			allowDrag: true,
		},
		compatibility: {
			defaultIcon: "legacy",
			animations: ["pulse"],
			hasTouchableSubElements: true,
			gap: 4,
			pressTime: 500,
		},
	},
	compatibility: { resourceId: "legacy-key" },
});
export const completeProfileKey = (code = "1,1"): ProfileKey =>
	Schema.decodeUnknownSync(ProfileKey)(completeEncodedKey(code));
export const completeEncodedEnvelope = (
	revision = 4,
): EncodedProfileEnvelope => ({
	schemaVersion: 1 as const,
	profiles: [
		{
			id: "profile-a",
			name: "Daily",
			revision,
			pages: [
				{
					id: "page-a",
					keys: [completeEncodedKey()],
					compatibility: { resourceId: "legacy-page" },
				},
			],
			knob: {
				keyCode: "0,1" as const,
				config: { subActions: [{ type: "brightness", value: 50 }] },
			},
			compatibility: {
				resourceId: "legacy-profile",
				version: 3,
				configIdx: 0,
				pageResources: ["legacy-page"],
			},
		},
	],
	activeByDevice: { "serial-a": { profileId: "profile-a", pageId: "page-a" } },
});
export const completeEnvelope = (revision = 4): ProfileEnvelope =>
	Schema.decodeUnknownSync(ProfileEnvelope)(completeEncodedEnvelope(revision));
export const testFunctionContracts: ReadonlyMap<
	string,
	ProfileFunctionContract
> = new Map([
	[
		"hotkey",
		{
			childrenName: "hotkey",
			supportsKnob: true,
			supportsAlternateVisuals: true,
			validateConfig: (config) =>
				config.actions.every(
					(action) =>
						action.type === "hotkey" &&
						Array.isArray(action.value) &&
						action.value.every((value) => typeof value === "string"),
				)
					? []
					: [["actions"]],
		},
	],
]);
