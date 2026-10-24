import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../packages/device/src/profiles/profile-repository";
import {
	type EmojiStore,
	emptyEmojiStore,
} from "../../../../../packages/edge/src/emoji/emoji-contracts";
import { placeEmojiPackage } from "./profile-placement";

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
});
