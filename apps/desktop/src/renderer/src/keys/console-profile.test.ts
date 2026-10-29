import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { Profile } from "../../../../../../packages/device/src/profiles/profile-contracts";
import { inspectProfileText } from "../../../../../../packages/device/src/profiles/profile-import";
import { stripLayout } from "../strip/geometry";
import { consoleProfile } from "./console-profile";

describe("Instrument Console preset", () => {
	it.each(["en", "de", "es", "fr", "it", "zh", "ja", "ko"] as const)(
		"imports a complete nonoverlapping real layout in %s",
		(locale) => {
			const profile = consoleProfile(locale, "Console");
			const report = inspectProfileText(
				JSON.stringify(Schema.encodeSync(Profile)(profile)),
			);
			expect(report.profile).toBeDefined();
			const layout = stripLayout(profile, profile.pages[0]);
			expect(layout.tiles).toHaveLength(7);
			expect(layout.tiles.map((tile) => tile.type)).toEqual([
				"dkDesktopClock",
				"vol",
				"quakeBotInput",
				"clawbot",
				"clawbot",
				"clawbot",
				"clawbot",
			]);
			expect(
				layout.cells.filter((cell) => cell.state === "empty"),
			).toHaveLength(0);
			expect(
				profile.pages[0].keys
					.filter((key) => key.config.type === "clawbot")
					.every((key) =>
						key.config.actions.some((action) => action.type === "agentId"),
					),
			).toBe(true);
		},
	);
});
