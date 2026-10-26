import { Schema } from "effect";
import { expect, it } from "vitest";
import {
	createEmptyProfileKey,
	ProfileKey,
} from "../../../../../../../../packages/device/src/profiles/profile-contracts";
import { ClockSnapshot } from "../../../../../shared/clock-contracts";
import { patchClockEditorKey } from "./editorPatch";

it("device theme patch preserves unsaved format, unrelated action and key metadata", () => {
	const empty = createEmptyProfileKey("1,1");
	const key = Schema.decodeUnknownSync(ProfileKey)({
		...Schema.encodeSync(ProfileKey)(empty),
		keyCode: "1,1",
		childrenName: "dkDesktopClock",
		config: {
			...Schema.encodeSync(ProfileKey)(empty).config,
			type: "dkDesktopClock",
			size: [8, 2],
			actions: [
				{ type: "hourFormat", value: "12h" },
				{ type: "other", value: { draft: true } },
				{
					type: "clockStyle",
					value: {
						background: {
							mode: "theme",
							themeId: "season",
							themes: {
								season: { kind: "image", path: "opaque", crop: "keep" },
							},
							customBackground: "keep",
						},
						musicEnabled: true,
						customMetadata: "keep",
					},
				},
			],
		},
	});
	const snapshot = Schema.decodeUnknownSync(ClockSnapshot)({
		revision: 4,
		keyCode: "1,1",
		mode: "theme",
		themeId: "aurora",
		showSeconds: false,
		media: {},
		recovered: false,
		change: "setTheme",
	});
	const next = patchClockEditorKey(key, snapshot);
	expect(next.config.actions.find((a) => a.type === "hourFormat")?.value).toBe(
		"12h",
	);
	expect(next.config.actions.find((a) => a.type === "other")).toEqual(
		key.config.actions[1],
	);
	expect(
		next.config.actions.find((a) => a.type === "clockStyle")?.value,
	).toMatchObject({
		background: {
			themeId: "aurora",
			customBackground: "keep",
			themes: { season: { crop: "keep" } },
		},
		musicEnabled: true,
		customMetadata: "keep",
	});
	expect(
		key.config.actions.find((a) => a.type === "clockStyle")?.value,
	).toMatchObject({ background: { themeId: "season" } });
});
