import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { builtinProfiles } from "../../../../../../../../packages/device/src/profiles/profile-catalog";
import { ProfileKey } from "../../../../../../../../packages/device/src/profiles/profile-contracts";
import { defaults } from "../../../../../shared/monitor-contracts";
import { monitorKeySettings, withMonitorKeySettings } from "./key-settings";
import { temperature } from "./view-model";

const key = builtinProfiles("linux").find((p) => p.id === "1-3")?.pages[0]
	.keys[0];
if (!key) throw new Error("monitor builtin missing");
describe("profile-owned monitor presentation", () => {
	it("persists two independent keys through the real profile key schema, preserving collector policy", () => {
		const a = withMonitorKeySettings(key, {
			...defaults(),
			styleId: "cyber",
			background: "none",
			temperatureUnit: "fahrenheit",
		});
		const b = withMonitorKeySettings(key, {
			...defaults(),
			styleId: "anime",
			background: "custom",
			media: { anime: { id: "a".repeat(32), kind: "image", name: "a.png" } },
		});
		const restart = (value: ProfileKey) =>
			Schema.decodeUnknownSync(ProfileKey)(
				JSON.parse(JSON.stringify(Schema.encodeSync(ProfileKey)(value))),
			);
		expect(
			monitorKeySettings(restart(a), { ...defaults(), hz: 2 }),
		).toMatchObject({
			styleId: "cyber",
			background: "none",
			temperatureUnit: "fahrenheit",
			hz: 2,
			media: {},
		});
		expect(monitorKeySettings(restart(b))).toMatchObject({
			styleId: "anime",
			background: "custom",
			temperatureUnit: "celsius",
			media: { anime: { name: "a.png" } },
		});
		const draft = withMonitorKeySettings(a, {
			...monitorKeySettings(a),
			styleId: "wasteland",
		});
		expect(monitorKeySettings(draft).styleId).toBe("wasteland");
		expect(monitorKeySettings(a).styleId).toBe("cyber");
		expect(key.config).toMatchObject({
			supportKnob: false,
			supportTouchEffect: false,
		});
	});
	it.each(["cpuInfo", "gpuInfo"])(
		"backfills Celsius and saves Fahrenheit for %s",
		(type) => {
			const cpu = { ...key, config: { ...key.config, type, actions: [] } };
			expect(monitorKeySettings(cpu).temperatureUnit).toBe("celsius");
			const saved = Schema.decodeUnknownSync(ProfileKey)(
				Schema.encodeSync(ProfileKey)(
					withMonitorKeySettings(cpu, {
						...defaults(),
						temperatureUnit: "fahrenheit",
					}),
				),
			);
			expect(temperature(50, monitorKeySettings(saved).temperatureUnit)).toBe(
				"122",
			);
		},
	);
});
