import { Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { builtinProfiles } from "../../../../../packages/device/src/profiles/profile-catalog";
import {
	Profile,
	ProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import {
	migrateMonitorProfile,
	monitorProfileStorage,
} from "./profile-migration";

const types = [
	"cpuInfo",
	"gpuInfo",
	"memInfo",
	"diskInfo",
	"processInfo",
	"networkInfo",
	"powerInfo",
	"bluetoothInfo",
];
function legacy(): typeof ProfileEnvelope.Encoded {
	const p = builtinProfiles("linux").find((p) => p.id === "1-3");
	if (!p) throw new Error("monitor fixture missing");
	const raw = Schema.encodeSync(Profile)(p);
	return Schema.encodeSync(ProfileEnvelope)(
		Schema.decodeUnknownSync(ProfileEnvelope)({
			schemaVersion: 1,
			profiles: [
				{
					...raw,
					pages: raw.pages.map((page) => ({
						...page,
						keys: types.map((type, i) => {
							const config = {
								...page.keys[0]?.config,
								type,
								size: [1, 1],
								actions: [],
								temperatureUnit: "celsius",
							};
							return {
								keyCode: `1,${i + 1}`,
								childrenName: type,
								config,
								compatibility: {
									catalog: true,
									source: { keyCode: `1,${i + 1}`, config },
								},
							};
						}),
					})),
				},
			],
			activeByDevice: { preview: { profileId: p.id, pageId: "1" } },
		}),
	);
}
describe("installed SysView migration", () => {
	it("migrates untouched catalog grids once, persists and verifies readback", async () => {
		let disk: unknown = legacy();
		const write = vi.fn(async (value: unknown) => {
			disk = value;
		});
		const storage = monitorProfileStorage({ read: async () => disk, write });
		const first = Schema.decodeUnknownSync(ProfileEnvelope)(
			await storage.read(),
		);
		expect(first.profiles[0].pages[0].keys[0]?.config).toMatchObject({
			type: "systemMonitorPanel",
			size: [8, 2],
			supportKnob: false,
			supportTouchEffect: false,
		});
		expect(first.profiles[0].revision).toBe(1);
		expect(first.activeByDevice.preview?.profileId).toBe("1-3");
		expect(await storage.read()).toEqual(disk);
		expect(write).toHaveBeenCalledTimes(1);
	});
	it("preserves a user-edited grid and reports failed verification", async () => {
		const value = legacy();
		const edited = {
			...value,
			profiles: value.profiles.map((p) => ({
				...p,
				pages: p.pages.map((page) => ({
					...page,
					keys: page.keys.map((k, i) =>
						i
							? k
							: {
									...k,
									config: { ...k.config, temperatureUnit: "fahrenheit" },
								},
					),
				})),
			})),
		};
		expect(migrateMonitorProfile(edited)).toBeUndefined();
		const moved = {
			...value,
			profiles: value.profiles.map((p) => ({
				...p,
				pages: p.pages.map((page) => ({
					...page,
					keys: page.keys.map((key, i) =>
						i ? key : { ...key, keyCode: "2,1" },
					),
				})),
			})),
		};
		expect(migrateMonitorProfile(moved)).toBeUndefined();
		const write = vi.fn(async () => undefined);
		await expect(
			monitorProfileStorage({ read: async () => value, write }).read(),
		).rejects.toMatchObject({ code: "QUAKE.PROFILE.WRITE_FAILED" });
		expect(write).toHaveBeenCalledTimes(1);
	});
});
