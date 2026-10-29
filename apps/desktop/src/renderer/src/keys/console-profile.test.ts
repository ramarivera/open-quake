import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { builtinProfiles } from "../../../../../../packages/device/src/profiles/profile-catalog";
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

it("keeps bundled and previously saved unmarked clock/input footprints while honoring explicit Console spans after import", () => {
	const builtins = builtinProfiles("darwin");
	const clock = builtins.find((profile) => profile.id === "1-7");
	const agent = builtins.find((profile) => profile.id === "1-8");
	if (!clock || !agent) throw new Error("Missing bundled profiles");
	for (const source of [
		clock,
		{ ...clock, id: "saved-clock", name: "My saved clock" },
	]) {
		const restored = Schema.decodeUnknownSync(Profile)(
			JSON.parse(JSON.stringify(Schema.encodeSync(Profile)(source))),
		);
		const tile = stripLayout(restored, restored.pages[0]).tiles[0];
		expect(tile?.box).toEqual({ x: 0, y: 0, width: 1920, height: 480 });
		expect(tile?.fullBleed).toBe(true);
	}
	const legacyInput = stripLayout(agent, agent.pages[0]).tiles.find(
		(tile) => tile.type === "quakeBotInput",
	);
	expect(legacyInput?.footprint).toMatchObject({ width: 2, height: 2 });
	const preset = consoleProfile("en", "Console");
	const imported = Schema.decodeUnknownSync(Profile)(
		JSON.parse(JSON.stringify(Schema.encodeSync(Profile)(preset))),
	);
	const layout = stripLayout(imported, imported.pages[0]);
	expect(
		layout.tiles.find((tile) => tile.type === "dkDesktopClock")?.footprint,
	).toMatchObject({ width: 2, height: 2 });
	expect(
		layout.tiles.find((tile) => tile.type === "quakeBotInput")?.footprint,
	).toMatchObject({ width: 4, height: 1 });
});
