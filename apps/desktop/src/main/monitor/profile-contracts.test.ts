import { Layer, ManagedRuntime, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { KeyEditing } from "../../../../../packages/device/src/profiles/key-editing-service";
import { builtinProfiles } from "../../../../../packages/device/src/profiles/profile-catalog";
import {
	Profile,
	ProfileEnvelope,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import { profileKeyFunctionIssues } from "../../../../../packages/device/src/profiles/profile-function-contracts";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../packages/device/src/profiles/profile-repository";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service";
import {
	monitorKeySettings,
	withMonitorKeySettings,
} from "../../renderer/src/strip/tiles/monitor/key-settings";
import { defaults } from "../../shared/monitor-contracts";
import {
	ManagementProfileContractsLive,
	managementProfileContracts,
} from "../management/profile-contracts";

const panel = builtinProfiles("linux").find((p) => p.id === "1-3");
if (!panel) throw new Error("missing monitor fixture");
const firstKey = (p: Profile) => {
	const key = p.pages[0].keys[0];
	if (!key) throw new Error("missing monitor key");
	return key;
};
describe("monitor keys at the production profile validation boundary", () => {
	it("accepts canonical keys and rejects malformed presentation", () => {
		const key = firstKey(panel);
		expect(profileKeyFunctionIssues(key, managementProfileContracts)).toEqual(
			[],
		);
		expect(
			profileKeyFunctionIssues(
				{
					...key,
					config: {
						...key.config,
						actions: [{ type: "monitorStyle", value: { styleId: "invalid" } }],
					},
				},
				managementProfileContracts,
			),
		).not.toEqual([]);
	});
	it("saves and reverts two independent panel profiles across a repository restart", async () => {
		let disk: unknown = {
			schemaVersion: 1,
			profiles: [
				Schema.encodeSync(Profile)(panel),
				{ ...Schema.encodeSync(Profile)(panel), id: "second" },
			],
			activeByDevice: {},
		};
		const make = () => {
			const repo = ProfileRepository.DefaultWithoutDependencies.pipe(
				Layer.provide(
					profileStorageLayer({
						read: async () => disk,
						write: async (value) => {
							disk = value;
						},
					}),
				),
				Layer.provide(ManagementProfileContractsLive),
			);
			return ManagedRuntime.make(
				KeyEditing.DefaultWithoutDependencies.pipe(
					Layer.provideMerge(
						ProfileService.DefaultWithoutDependencies.pipe(
							Layer.provideMerge(repo),
						),
					),
				),
			);
		};
		const runtime = make();
		try {
			for (const [id, style] of [
				["1-3", "cyber"],
				["second", "anime"],
			] as const) {
				const p = await runtime.runPromise(ProfileService.getProfile(id));
				const key = firstKey(p);
				const target = {
					token: id,
					profileId: id,
					pageId: p.pages[0].id,
					keyCode: key.keyCode,
					revision: p.revision,
				};
				const edit = withMonitorKeySettings(key, {
					...defaults(),
					styleId: style,
					background: id === "second" ? "custom" : "none",
					temperatureUnit: id === "second" ? "celsius" : "fahrenheit",
					media:
						id === "second"
							? {
									anime: {
										id: "a".repeat(32),
										name: "photo.png",
										kind: "image",
									},
								}
							: {},
				});
				expect(
					await runtime.runPromise(
						KeyEditing.preview(target, Schema.encodeSync(ProfileKey)(edit)),
					),
				).toMatchObject({ _tag: "ready" });
				expect(
					Schema.decodeUnknownSync(ProfileEnvelope)(disk).profiles.find(
						(p) => p.id === id,
					)?.revision,
				).toBe(0);
				await runtime.runPromise(KeyEditing.revert(id));
				const reverted = (
					await runtime.runPromise(KeyEditing.read())
				).profiles.find((p) => p.id === id);
				if (!reverted) throw new Error("missing reverted profile");
				expect(monitorKeySettings(firstKey(reverted)).styleId).toBe("glass");
				await runtime.runPromise(
					KeyEditing.preview(target, Schema.encodeSync(ProfileKey)(edit)),
				);
				await runtime.runPromise(KeyEditing.save(id));
			}
		} finally {
			await runtime.dispose();
		}
		const restarted = make();
		try {
			const a = await restarted.runPromise(ProfileService.getProfile("1-3"));
			const b = await restarted.runPromise(ProfileService.getProfile("second"));
			expect(monitorKeySettings(firstKey(a))).toMatchObject({
				styleId: "cyber",
				temperatureUnit: "fahrenheit",
				background: "none",
				media: {},
			});
			expect(monitorKeySettings(firstKey(b))).toMatchObject({
				styleId: "anime",
				temperatureUnit: "celsius",
				background: "custom",
				media: { anime: { name: "photo.png" } },
			});
		} finally {
			await restarted.dispose();
		}
	});
});
