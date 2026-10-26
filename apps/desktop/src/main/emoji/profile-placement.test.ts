import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { describe, expect, it } from "vitest";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import { managerState } from "../../../../../packages/device/src/profiles/profile-manager-invariants";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../packages/device/src/profiles/profile-repository";
import {
	type EmojiStore,
	emptyEmojiStore,
} from "../../../../../packages/edge/src/emoji/emoji-contracts";
import { placeEmojiPackage } from "./profile-placement";
import { renameLinkedEmojiProfile } from "./profile-rename";

const hash = "a".repeat(64);
const fixture: EmojiStore = {
	...emptyEmojiStore,
	items: [
		{
			id: "hello",
			name: "Hello",
			original: hash,
			rendered: hash,
			caption: { text: "", size: 48, color: "0xffffffff", position: "bot" },
		},
	],
	packages: [
		{ id: "daily", name: "Daily", emojiIds: ["hello"], profileId: null },
	],
};
function setup() {
	let disk = encodeProfileEnvelope(createInitialProfileEnvelope());
	let failWrite = false;
	const runtime = ManagedRuntime.make(
		ProfileRepository.Default.pipe(
			Layer.provide(
				profileStorageLayer({
					read: async () => disk,
					write: async (next) => {
						if (failWrite) throw Error("disk unavailable");
						disk = next;
					},
				}),
			),
		),
	);
	const read = () =>
		runtime.runPromise(Effect.flatMap(ProfileRepository, (r) => r.load()));
	return {
		runtime,
		read,
		get disk() {
			return disk;
		},
		fail: () => {
			failWrite = true;
		},
	};
}
describe("emoji profile placement", () => {
	it("places in row order, pins hashes, and updates the same profile on repeat", async () => {
		const f = setup();
		let selected = "";
		try {
			const place = placeEmojiPackage({
				runtime: f.runtime,
				select: async (id) => {
					selected = id;
				},
			});
			const id = await place("daily", fixture);
			expect(selected).toBe(id);
			const saved = (await f.read()).envelope.profiles.find((p) => p.id === id);
			expect(saved?.pages[0].keys[0]?.keyCode).toBe("1,1");
			expect(saved?.pages[0].keys[0]?.config.icon).toBe(`emoji:${hash}`);
			await place("daily", {
				...fixture,
				packages: fixture.packages.map((p) => ({ ...p, profileId: id })),
			});
			expect(
				(await f.read()).envelope.profiles.filter((p) => p.id === id),
			).toHaveLength(1);
		} finally {
			await f.runtime.dispose();
		}
	});
	it("restores the previous envelope data if activation fails after persistence", async () => {
		const f = setup();
		try {
			const before = (await f.read()).envelope;
			await expect(
				placeEmojiPackage({
					runtime: f.runtime,
					select: async () => {
						throw Error("device offline");
					},
				})("daily", fixture),
			).rejects.toThrow("device offline");
			const after = (await f.read()).envelope;
			expect(after.profiles).toEqual(before.profiles);
			expect(after.activeByDevice).toEqual(before.activeByDevice);
		} finally {
			await f.runtime.dispose();
		}
	});
	it("does not activate after a failed profile write", async () => {
		const f = setup();
		let selected = false;
		try {
			const before = f.disk;
			f.fail();
			await expect(
				placeEmojiPackage({
					runtime: f.runtime,
					select: async () => {
						selected = true;
					},
				})("daily", fixture),
			).rejects.toThrow();
			expect(selected).toBe(false);
			expect(f.disk).toEqual(before);
		} finally {
			await f.runtime.dispose();
		}
	});
	it("preserves vacancies in placed key coordinates", async () => {
		const f = setup();
		try {
			const id = await placeEmojiPackage({
				runtime: f.runtime,
				select: async () => {},
			})("daily", {
				...fixture,
				packages: [
					{
						id: "daily",
						name: "Daily",
						profileId: null,
						emojiIds: ["", "hello"],
					},
				],
			});
			expect(
				(await f.read()).envelope.profiles
					.find((profile) => profile.id === id)
					?.pages[0].keys.map((key) => key.keyCode),
			).toEqual(["1,2"]);
		} finally {
			await f.runtime.dispose();
		}
	});
	it("compensates package-link persistence failure after activation, preserving independent edits", async () => {
		const f = setup();
		const failure = new Error("synthetic linkage failure");
		let refreshed = false;
		try {
			const before = (await f.read()).envelope;
			const place = placeEmojiPackage({
				runtime: f.runtime,
				select: async (id) =>
					f.runtime.runPromise(
						Effect.flatMap(ProfileRepository, (repo) =>
							repo.transact((current) =>
								Effect.succeed({
									...current,
									activeByDevice: {
										...current.activeByDevice,
										"desktop-preview": { profileId: id, pageId: `${id}-page` },
									},
									manager: Option.some({
										...managerState(current),
										anchor: Option.some(id),
									}),
								}),
							),
						),
					),
				refresh: async () => {
					refreshed = true;
				},
			});
			await expect(
				place("daily", fixture, async () => {
					await f.runtime.runPromise(
						Effect.flatMap(ProfileRepository, (repo) =>
							repo.transact((current) =>
								Effect.succeed({
									...current,
									profiles: [
										{ ...current.profiles[0], name: "Independent change" },
										...current.profiles.slice(1),
									],
									manager: Option.some({
										...managerState(current),
										anchor: Option.some(current.profiles[0].id),
									}),
								}),
							),
						),
					);
					throw failure;
				}),
			).rejects.toBe(failure);
			const after = (await f.read()).envelope;
			expect(after.profiles).toHaveLength(before.profiles.length);
			expect(after.profiles[0].name).toBe("Independent change");
			expect(after.activeByDevice).toEqual(before.activeByDevice);
			expect(managerState(after).anchor).toEqual(
				Option.some(before.profiles[0].id),
			);
			expect(refreshed).toBe(true);
		} finally {
			await f.runtime.dispose();
		}
	});
	it("refuses to overwrite a concurrent edit of the placed profile during rollback", async () => {
		const f = setup();
		try {
			await expect(
				placeEmojiPackage({ runtime: f.runtime, select: async () => {} })(
					"daily",
					fixture,
					async (id) => {
						await f.runtime.runPromise(
							Effect.flatMap(ProfileRepository, (repo) =>
								repo.transact((current) =>
									Effect.succeed({
										...current,
										profiles: [
											current.profiles[0],
											...current.profiles.slice(1).map((profile) =>
												profile.id === id
													? {
															...profile,
															revision: profile.revision + 1,
															name: "Concurrent",
														}
													: profile,
											),
										],
									}),
								),
							),
						);
						throw Error("linkage failed");
					},
				),
			).rejects.toThrow("Emoji request is invalid");
			expect(
				(await f.read()).envelope.profiles.find(
					(profile) => profile.id === "emoji-daily",
				)?.name,
			).toBe("Concurrent");
		} finally {
			await f.runtime.dispose();
		}
	});
});

it("MGMT-101 renames linked profiles, rejects existing names and rolls back library save failure", async () => {
	const f = setup();
	try {
		const place = placeEmojiPackage({
			runtime: f.runtime,
			select: async () => {},
		});
		const id = await place("daily", fixture);
		let published = 0;
		const rename = renameLinkedEmojiProfile({
			runtime: f.runtime,
			refresh: async () => {
				published++;
			},
		});
		await rename(id, "Renamed", async () => {});
		expect(
			(await f.read()).envelope.profiles.find((p) => p.id === id)?.name,
		).toBe("Renamed");
		expect(published).toBe(1);
		await expect(
			rename(id, "Failed", async () => {
				throw Error("library unavailable");
			}),
		).rejects.toThrow("library unavailable");
		expect(
			(await f.read()).envelope.profiles.find((p) => p.id === id)?.name,
		).toBe("Renamed");
		expect(published).toBe(1);
		const existing = (await f.read()).envelope.profiles.find(
			(p) => p.id !== id,
		)?.name;
		expect(existing).toBeTruthy();
		await expect(
			rename(id, existing ?? "", async () => {
				throw Error("must not save");
			}),
		).rejects.toBeDefined();
		expect(
			(await f.read()).envelope.profiles.find((p) => p.id === id)?.name,
		).toBe("Renamed");
	} finally {
		await f.runtime.dispose();
	}
});
