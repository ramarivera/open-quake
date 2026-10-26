import mdiCatalog from "virtual:mdi-icons";
import star from "@mdi/svg/svg/star.svg?raw";
import {
	Cause,
	Effect,
	Layer,
	ManagedRuntime,
	Option,
	Runtime,
	Schema,
	Stream,
} from "effect";
import { describe, expect, it } from "vitest";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
	type ProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import {
	applyManagerCommand,
	installProfileCatalog,
	PROFILE_LIMIT,
	visibleProfiles,
} from "../../../../../packages/device/src/profiles/profile-manager-invariants";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../packages/device/src/profiles/profile-repository";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service";
import { HaKey } from "../../../../../packages/edge/src/home-assistant/ha-contracts";
import type { ShortcutLibrary } from "../../../../../packages/edge/src/shortcuts/shortcut-contracts";
import { resolveTileArtwork } from "../../renderer/src/strip/useTileArt";
import {
	ManagementProfileContractsLive,
	managementProfileContracts,
} from "../management/profile-contracts";
import {
	integrationProfiles,
	keyHaConfig,
	visibleHaEntities,
} from "./profiles";

const library = (count: number): ShortcutLibrary => ({
	id: "manual",
	name: "Editing",
	app: "Office",
	createdAt: "2026-10-24",
	rows: Array.from({ length: count }, (_, index) => ({
		id: `row-${index}`,
		name: `Copy ${index}`,
		app: "Office",
		chord: "control+c",
	})),
});
function setup(initial: ProfileEnvelope = createInitialProfileEnvelope()) {
	let data = encodeProfileEnvelope(initial);
	let fail = false;
	const storage = {
		read: async () => data,
		write: async (next: typeof data) => {
			if (fail) throw new TypeError("disk failed");
			data = next;
		},
	};
	const runtime = ManagedRuntime.make(
		ProfileService.DefaultWithoutDependencies.pipe(
			Layer.provideMerge(
				ProfileRepository.DefaultWithoutDependencies.pipe(
					Layer.provide(ManagementProfileContractsLive),
					Layer.provide(profileStorageLayer(storage)),
				),
			),
		),
	);
	return {
		runtime,
		adapter: integrationProfiles(runtime),
		read: () => data,
		fail: () => {
			fail = true;
		},
	};
}
describe("integration placement through the shared ProfileService repository", () => {
	it("allows hidden built-ins beyond the visible profile limit and enforces the remaining capacity", async () => {
		let initial = installProfileCatalog(
			createInitialProfileEnvelope(),
			"darwin",
		);
		while (initial.profiles.length < PROFILE_LIMIT) {
			const result = applyManagerCommand(initial, { type: "create" });
			if (result._tag !== "updated") throw new TypeError("Unexpected capacity");
			initial = result.envelope;
		}
		expect(visibleProfiles(initial)).toHaveLength(PROFILE_LIMIT - 1);
		const f = setup(initial);
		try {
			const id = await f.adapter.sync(library(1));
			const { envelope } = await f.runtime.runPromise(
				ProfileService.loadProfiles(),
			);
			expect(envelope.profiles).toHaveLength(PROFILE_LIMIT + 1);
			expect(visibleProfiles(envelope)).toHaveLength(PROFILE_LIMIT);
			expect(applyManagerCommand(envelope, { type: "create" })._tag).toBe(
				"rejected",
			);
			const before = f.read();
			const failure: unknown = await f.adapter
				.sync({ ...library(1), id: "second", name: "Second" })
				.then(
					() => null,
					(error: unknown) => error,
				);
			expect(
				Runtime.isFiberFailure(failure) &&
					Option.getOrUndefined(
						Cause.failureOption(failure[Runtime.FiberFailureCauseId]),
					),
			).toMatchObject({ code: "INTEGRATION.INPUT.REJECTED" });
			expect(f.read()).toEqual(before);
			expect(await f.adapter.sync(library(2))).toBe(id);
		} finally {
			await f.runtime.dispose();
		}
	});
	it("writes 17 keys in row-major pages and updates the same library profile", async () => {
		const f = setup();
		try {
			const id = await f.adapter.sync(library(17));
			let profile = await f.runtime.runPromise(ProfileService.getProfile(id));
			expect(profile.pages.map((p) => p.keys.length)).toEqual([16, 1]);
			expect(profile.pages[0].keys.map((k) => k.keyCode)).toEqual([
				"1,1",
				"1,2",
				"1,3",
				"1,4",
				"1,5",
				"1,6",
				"1,7",
				"1,8",
				"2,1",
				"2,2",
				"2,3",
				"2,4",
				"2,5",
				"2,6",
				"2,7",
				"2,8",
			]);
			expect(await f.adapter.sync(library(2))).toBe(id);
			profile = await f.runtime.runPromise(ProfileService.getProfile(id));
			expect(profile.pages[0].keys).toHaveLength(2);
			expect(
				(await f.runtime.runPromise(ProfileService.loadProfiles())).envelope
					.profiles,
			).toHaveLength(2);
		} finally {
			await f.runtime.dispose();
		}
	});
	it("repairs selected removed pages in the same commit and preserves surviving selections", async () => {
		const f = setup();
		try {
			const id = await f.adapter.sync(library(17));
			await f.runtime.runPromise(
				ProfileService.selectProfile({
					deviceId: "desktop-preview",
					profileId: id,
					pageId: `${id}-2`,
				}),
			);
			await f.runtime.runPromise(
				ProfileService.selectProfile({
					deviceId: "synthetic-physical",
					profileId: id,
					pageId: `${id}-1`,
				}),
			);
			const before = f.read();
			f.fail();
			await expect(f.adapter.sync(library(16))).rejects.toThrow();
			expect(f.read()).toEqual(before);
		} finally {
			await f.runtime.dispose();
		}
		const good = setup();
		try {
			const id = await good.adapter.sync(library(17));
			await good.runtime.runPromise(
				ProfileService.selectProfile({
					deviceId: "desktop-preview",
					profileId: id,
					pageId: `${id}-2`,
				}),
			);
			await good.runtime.runPromise(
				ProfileService.selectProfile({
					deviceId: "synthetic-physical",
					profileId: id,
					pageId: `${id}-1`,
				}),
			);
			await good.adapter.sync(library(16));
			const { envelope } = await good.runtime.runPromise(
				ProfileService.loadProfiles(),
			);
			expect(envelope.activeByDevice["desktop-preview"]).toEqual({
				profileId: id,
				pageId: `${id}-1`,
			});
			expect(envelope.activeByDevice["synthetic-physical"]).toEqual({
				profileId: id,
				pageId: `${id}-1`,
			});
			expect(good.read().activeByDevice).toEqual(envelope.activeByDevice);
		} finally {
			await good.runtime.dispose();
		}
	});

	it("rejects naming, empty libraries and failed writes without changing profiles", async () => {
		const f = setup();
		try {
			await f.runtime.runPromise(ProfileService.loadProfiles());
			const before = f.read();
			await expect(
				f.adapter.sync({ ...library(1), name: "Very long pack title" }),
			).rejects.toBeDefined();
			await expect(f.adapter.sync(library(0))).rejects.toBeDefined();
			f.fail();
			await expect(f.adapter.sync(library(17))).rejects.toBeDefined();
			expect(f.read()).toEqual(before);
			expect(
				(await f.runtime.runPromise(ProfileService.loadProfiles())).envelope
					.profiles,
			).toHaveLength(1);
		} finally {
			await f.runtime.dispose();
		}
	});
	it("persists HA configData, exposes key targets and follows active visible references", async () => {
		const f = setup();
		try {
			const key = Schema.decodeUnknownSync(HaKey)({
				entity_id: "light.desk",
				service: "turn_on",
				service_data: {},
				custom_display_type: "default",
				custom_display_settings: { fontSize: 40 },
				custom_display_detail: [],
			});
			const target = {
				profileId: "local-profile",
				pageId: "local-page",
				keyCode: "1,2",
			};
			await f.adapter.place(target, key);
			const profile = await f.runtime.runPromise(
				ProfileService.getProfile(target.profileId),
			);
			const saved = profile.pages[0].keys[0];
			expect(saved?.config.actions[0]?.type).toBe("configData");
			expect(saved && keyHaConfig(saved)).toEqual(key);
			expect(
				saved &&
					managementProfileContracts
						.get("homeAssistant")
						?.validateConfig(saved.config),
			).toEqual([]);
			const targets = await f.adapter.targets();
			expect(targets).toHaveLength(16);
			expect(targets.find((t) => t.keyCode === "1,2")?.key).toEqual(key);
			await f.runtime.runPromise(
				ProfileService.selectProfile({
					deviceId: "desktop-preview",
					profileId: target.profileId,
					pageId: target.pageId,
				}),
			);
			const { envelope } = await f.runtime.runPromise(
				ProfileService.loadProfiles(),
			);
			expect(visibleHaEntities(envelope)).toEqual(["light.desk"]);
			const dispatched = await f.runtime.runPromise(
				ProfileService.subscribeDispatchProfiles().pipe(
					Effect.flatMap(Stream.runHead),
				),
			);
			expect(
				Option.isSome(dispatched) &&
					dispatched.value.profiles[0].pages[0].keys[0]?.config.type,
			).toBe("homeAssistant");
		} finally {
			await f.runtime.dispose();
		}
	});
});

// AI-121 retained action data must survive the production profile adapter.
it("syncs validated generated configuration rows without converting them to hotkeys", async () => {
	const f = setup();
	try {
		const id = await f.adapter.sync({
			...library(0),
			rows: [
				{
					id: "url",
					name: "Docs",
					app: "Office",
					chord: "",
					icon: "mdi-star",
					config: {
						type: "website",
						actions: [{ type: "url", value: "https://example.org" }],
					},
				},
			],
		});
		const profile = await f.runtime.runPromise(ProfileService.getProfile(id));
		expect(profile.pages[0].keys[0]?.config).toMatchObject({
			type: "website",
			icon: "mdi-star",
			actions: [{ type: "url", value: "https://example.org" }],
			title: { text: "Docs" },
		});
		const key = profile.pages[0].keys[0];
		const art = await resolveTileArtwork(
			key?.config.icon ?? "",
			key?.config.type ?? "",
		);
		const svg = decodeURIComponent(art.slice(art.indexOf(",") + 1));
		expect(mdiCatalog.find((icon) => icon.name === "star")?.path).toBe(
			/\bd="([^"]+)"/.exec(star)?.[1],
		);
		expect(svg).toContain(/\bd="([^"]+)"/.exec(star)?.[1]);
		expect(svg).toContain('fill="white"');
		expect(await resolveTileArtwork("mdi-does-not-exist", "website")).toBe("");
		expect(await resolveTileArtwork("mdi-<script>", "website")).toBe("");
	} finally {
		await f.runtime.dispose();
	}
});
