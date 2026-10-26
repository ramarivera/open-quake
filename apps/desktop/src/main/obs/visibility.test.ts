import { Schema } from "effect";
import { expect, it } from "vitest";
import {
	createEmptyProfileKey,
	ProfileEnvelope,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import { visibleObsKeys } from "./visibility";

it("only authorizes displayed committed OBS keys on the selected device page", () => {
	const key = (
		keyCode: string,
		display = true,
		type = "obsScreenshot",
		value = '{"sourceName":"Public"}',
	) => {
		const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey(keyCode));
		return {
			...empty,
			childrenName: type,
			config: {
				...empty.config,
				type,
				size: type === "obsScreenshot" ? [2, 2] : [1, 1],
				display,
				actions: [{ type: "configData", value }],
			},
		};
	};
	const envelope = Schema.decodeUnknownSync(ProfileEnvelope)({
		schemaVersion: 1,
		profiles: [
			{
				id: "one",
				name: "OBS",
				revision: 0,
				pages: [
					{
						id: "visible",
						keys: [
							key("1,1"),
							key("1,3", false),
							key("1,5", true, "obsScreenshot", "{}"),
							key("1,7", true, "hotkey"),
						],
					},
					{
						id: "hidden",
						keys: [
							key("1,1", true, "obsScreenshot", '{"sourceName":"Private"}'),
						],
					},
				],
			},
		],
		activeByDevice: {
			current: { profileId: "one", pageId: "visible" },
			other: { profileId: "one", pageId: "hidden" },
		},
	});
	expect(visibleObsKeys(envelope, "current")).toEqual([
		{
			id: "1,1",
			command: { type: "obsScreenshot", settings: { sourceName: "Public" } },
		},
	]);
	expect(visibleObsKeys(envelope, "disconnected")).toEqual([]);
});
