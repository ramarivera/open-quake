import { Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { builtinProfiles } from "../../../../../packages/device/src/profiles/profile-catalog";
import {
	Profile,
	ProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import {
	monitorKeySettings,
	withMonitorKeySettings,
} from "../../renderer/src/strip/tiles/monitor/key-settings";
import { defaults } from "../../shared/monitor-contracts";
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

it("preserves global presentation for upgraded existing panels once, keeping explicitly owned keys and sampling unchanged", async () => {
	const source = builtinProfiles("linux").find((p) => p.id === "1-3");
	const key = source?.pages[0].keys[0];
	if (!source || !key) throw new Error("missing fixture");
	const encoded = Schema.encodeSync(Profile)(source);
	const existing = {
		...encoded,
		pages: encoded.pages.map((page) => ({
			...page,
			keys: page.keys.map((key) => {
				const { temperatureUnit: _unit, ...config } = key.config;
				return { ...key, config };
			}),
		})),
	};
	const explicit: Profile = {
		...source,
		id: "owned",
		pages: [
			{
				...source.pages[0],
				keys: [
					withMonitorKeySettings(key, {
						...defaults(),
						styleId: "anime",
						background: "none",
					}),
				],
			},
		],
	};
	let disk: unknown = {
		schemaVersion: 1,
		profiles: [existing, Schema.encodeSync(Profile)(explicit)],
		activeByDevice: {
			preview: { profileId: source.id, pageId: source.pages[0].id },
		},
	};
	const legacy = {
		...defaults(),
		styleId: "cyber" as const,
		temperatureUnit: "fahrenheit" as const,
		background: "custom" as const,
		media: {
			cyber: { id: "c".repeat(32), kind: "image" as const, name: "saved.png" },
		},
		hz: 2,
	};
	const write = vi.fn(async (value: unknown) => {
		disk = value;
	});
	const storage = monitorProfileStorage(
		{ read: async () => disk, write },
		async () => ({ revision: 7, settings: legacy }),
	);
	const first = Schema.decodeUnknownSync(ProfileEnvelope)(await storage.read());
	const migratedKey = first.profiles[0].pages[0].keys[0];
	if (!migratedKey) throw new Error("missing migrated key");
	expect(monitorKeySettings(migratedKey, legacy)).toEqual(legacy);
	expect(first.profiles[0].revision).toBe(source.revision + 1);
	expect(first.profiles[1]).toEqual(explicit);
	expect(first.activeByDevice.preview?.profileId).toBe(source.id);
	expect(await storage.read()).toEqual(disk);
	const restarted = monitorProfileStorage(
		{ read: async () => disk, write },
		async () => ({
			revision: 8,
			settings: { ...defaults(), styleId: "wasteland" },
		}),
	);
	expect(await restarted.read()).toEqual(disk);
	expect(write).toHaveBeenCalledTimes(1);
	expect(legacy.hz).toBe(2);
});
it("carries legacy global presentation into the replacement for an untouched installed grid", () => {
	const settings = {
		...defaults(),
		styleId: "cyber" as const,
		temperatureUnit: "fahrenheit" as const,
	};
	const result = migrateMonitorProfile(legacy(), settings);
	const envelope = Schema.decodeUnknownSync(ProfileEnvelope)(result);
	const key = envelope.profiles[0].pages[0].keys[0];
	if (!key) throw new Error("missing migrated grid");
	expect(monitorKeySettings(key)).toMatchObject({
		styleId: "cyber",
		temperatureUnit: "fahrenheit",
	});
	expect(migrateMonitorProfile(result, settings)).toBeUndefined();
});
