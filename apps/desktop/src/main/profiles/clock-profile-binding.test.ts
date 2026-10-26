import { Effect, Layer, ManagedRuntime, Option, Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { builtinProfiles } from "../../../../../packages/device/src/profiles/profile-catalog.js";
import {
	encodeProfileEnvelope,
	Profile,
	ProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../packages/device/src/profiles/profile-repository.js";
import { ClockMediaUnusable } from "../../shared/clock-errors";
import { handleClockCommand, parseMediaUrl } from "../clock/clock-ipc";
import {
	ClockFiles,
	ClockRoot,
	ClockStore,
	ClockVideoProbe,
} from "../clock/clock-store";
import { clockProfileLayer } from "./clock-profile-binding";

const clock = builtinProfiles("darwin").find((p) =>
	p.pages.some((page) =>
		page.keys.some((k) => k.config.type === "dkDesktopClock"),
	),
);
if (!clock) throw new Error("Clock preset missing");
const a = Schema.encodeSync(Profile)(clock);
const b = { ...a, id: "independent-clock", name: "Second clock" };
const targetA = { profileId: a.id, pageId: a.pages[0].id, keyCode: "1,1" };
const targetB = { profileId: b.id, pageId: b.pages[0].id, keyCode: "1,1" };
function fixture() {
	let stored = encodeProfileEnvelope(
		Schema.decodeUnknownSync(ProfileEnvelope)({
			schemaVersion: 1,
			clockConfigVersion: 1,
			profiles: [a, b],
			activeByDevice: {},
		}),
	);
	const state = { fail: false, writes: 0, legacyWrites: 0 };
	const profiles = () =>
		ManagedRuntime.make(
			ProfileRepository.Default.pipe(
				Layer.provide(
					profileStorageLayer({
						read: async () => stored,
						write: async (value) => {
							if (state.fail) throw new Error("disk full");
							stored = value;
							state.writes++;
						},
					}),
				),
			),
		);
	let profile = profiles();
	const clocks = () =>
		ManagedRuntime.make(
			ClockStore.Default.pipe(
				Layer.provide(
					Layer.mergeAll(
						Layer.succeed(ClockRoot, "/unused"),
						Layer.succeed(ClockVideoProbe, {
							duration: () =>
								Effect.fail(ClockMediaUnusable.fromCause(undefined)),
						}),
						Layer.succeed(ClockFiles, {
							read: () => Effect.succeed(Option.none()),
							writeAtomic: () =>
								Effect.sync(() => {
									state.legacyWrites++;
								}),
							exists: () => Effect.succeed(true),
						}),
						clockProfileLayer(profile),
					),
				),
			),
		);
	let store = clocks();
	return {
		state,
		stored: () => stored,
		run: <A, E>(effect: Effect.Effect<A, E, ClockStore>) =>
			store.runPromise(effect),
		profiles: () => profile,
		restart: async () => {
			await store.dispose();
			await profile.dispose();
			profile = profiles();
			store = clocks();
		},
		dispose: async () => {
			await store.dispose();
			await profile.dispose();
		},
	};
}
const fixtures: ReturnType<typeof fixture>[] = [];
const setup = () => {
	const f = fixture();
	fixtures.push(f);
	return f;
};
afterEach(async () => {
	await Promise.all(fixtures.splice(0).map((f) => f.dispose()));
});
describe("clock profile owner", () => {
	it("independent profile formats, styles and seconds survive restart without writing legacy stores", async () => {
		const f = setup();
		const untouched = f.stored().profiles[1];
		await f.run(ClockStore.setHourFormat("12h", targetA));
		await f.run(ClockStore.setSeconds(true, targetA));
		await f.run(ClockStore.setTheme("1,1", "aurora", targetA));
		expect(f.stored().profiles[1]).toEqual(untouched);
		await f.run(ClockStore.setTheme("1,1", "cyber", targetB));
		await f.restart();
		expect(await f.run(ClockStore.read(targetA))).toMatchObject({
			hourFormat: "12h",
			showSeconds: true,
			themeId: "aurora",
			target: targetA,
		});
		expect(await f.run(ClockStore.read(targetB))).toMatchObject({
			hourFormat: "24h",
			showSeconds: false,
			themeId: "cyber",
			target: targetB,
		});
		expect(f.state.legacyWrites).toBe(0);
	});
	it("format writes preserve weather, title, key policies and every other action", async () => {
		const f = setup();
		const original = f.stored().profiles[0];
		await f.run(
			handleClockCommand(
				{ _tag: "setHourFormat", hourFormat: "12h", target: targetA },
				Effect.succeed(Option.none()),
			),
		);
		const next = f.stored().profiles[0];
		const key = next.pages[0].keys[0];
		const oldKey = original.pages[0].keys[0];
		expect({ ...key?.config, actions: [] }).toEqual({
			...oldKey?.config,
			actions: [],
		});
		expect(key?.config.actions?.filter((a) => a.type !== "hourFormat")).toEqual(
			oldKey?.config.actions?.filter((a) => a.type !== "hourFormat"),
		);
		expect(next.revision).toBe(original.revision + 1);
	});
	it("failed profile persistence returns failure with unchanged committed state", async () => {
		const f = setup();
		const original = f.stored();
		f.state.fail = true;
		const reply = await f.run(
			handleClockCommand(
				{ _tag: "setHourFormat", hourFormat: "12h", target: targetB },
				Effect.succeed(Option.none()),
			),
		);
		expect(reply).toMatchObject({
			_tag: "failure",
			code: "QUAKE.CLOCK.PERSISTENCE_FAILED",
		});
		expect(f.stored()).toEqual(original);
	});
	it("unknown profile/page/key cannot fall through to another clock", async () => {
		const f = setup();
		const original = f.stored();
		for (const target of [
			{ ...targetA, profileId: "missing" },
			{ ...targetA, pageId: "missing" },
			{ ...targetA, keyCode: "2,2" },
		]) {
			expect(
				await f.run(
					handleClockCommand(
						{ _tag: "setHourFormat", hourFormat: "12h", target },
						Effect.succeed(Option.none()),
					),
				),
			).toMatchObject({ _tag: "failure" });
		}
		expect(f.stored()).toEqual(original);
		expect(f.state.writes).toBe(0);
	});
	it("media URLs resolve the profile that selected the slot", async () => {
		const f = setup();
		await f.run(ClockStore.stageMedia("aurora", "/profile-a.png", targetA));
		await f.run(ClockStore.stageMedia("aurora", "/profile-b.png", targetB));
		const first = await f.run(ClockStore.read(targetA));
		const second = await f.run(ClockStore.read(targetB));
		const urlA = first.media.aurora?.url;
		const urlB = second.media.aurora?.url;
		if (!urlA || !urlB) throw new Error("missing media");
		const parsedA = parseMediaUrl(urlA);
		const parsedB = parseMediaUrl(urlB);
		if (!parsedA || !parsedB) throw new Error("invalid media target");
		expect(Option.getOrNull(await f.run(ClockStore.mediaPath(parsedA)))).toBe(
			"/profile-a.png",
		);
		expect(Option.getOrNull(await f.run(ClockStore.mediaPath(parsedB)))).toBe(
			"/profile-b.png",
		);
	});
});
