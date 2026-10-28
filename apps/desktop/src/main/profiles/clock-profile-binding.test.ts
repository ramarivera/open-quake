import { Effect, Layer, ManagedRuntime, Option, Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { validateAction } from "../../../../../packages/device/src/actions/action-invariants.js";
import { KeyEditing } from "../../../../../packages/device/src/profiles/key-editing-service.js";
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
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service.js";
import { ClockMediaUnusable } from "../../shared/clock-errors";
import { handleClockCommand, parseMediaUrl } from "../clock/clock-ipc";
import {
	ClockFiles,
	ClockRoot,
	ClockStore,
	ClockVideoProbe,
} from "../clock/clock-store";
import { activeClockTarget, clockProfileLayer } from "./clock-profile-binding";

const clock = builtinProfiles("darwin").find((p) =>
	p.pages.some((page) =>
		page.keys.some((k) => k.config.type === "dkDesktopClock"),
	),
);
if (!clock) throw new Error("Clock preset missing");
const encoded = Schema.encodeSync(Profile)(clock);
const firstPage = encoded.pages[0];
if (!firstPage) throw new Error("clock page missing");
const a = {
	...encoded,
	pages: [
		firstPage,
		...encoded.pages.slice(1),
		{ ...firstPage, id: "second-clock-page" },
	] as const,
};
const b = { ...a, id: "independent-clock", name: "Second clock" };
const targetA = { profileId: a.id, pageId: a.pages[0].id, keyCode: "1,1" };
const targetB = { profileId: b.id, pageId: b.pages[0].id, keyCode: "1,1" };
const targetA2 = { ...targetA, pageId: "second-clock-page" };
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

describe("clock burn-down per-key enrichment", () => {
	it("editor save validation accepts enriched clock actions and rejects invalid or duplicate formats", () => {
		const config = firstPage.keys[0]?.config;
		if (!config) throw new Error("clock key missing");
		expect(validateAction("dkDesktopClock", config)._tag).toBe("Right");
		for (const value of ["unknown", "12h"]) {
			const actions =
				value === "unknown"
					? config.actions?.map((a) =>
							a.type === "hourFormat" ? { ...a, value } : a,
						)
					: [...(config.actions ?? []), { type: "hourFormat", value }];
			expect(
				validateAction("dkDesktopClock", { ...config, actions })._tag,
			).toBe("Left");
		}
	});
	it("two clock keys in one profile retain separate settings and revisions across restart", async () => {
		const f = setup();
		const second = await f.run(ClockStore.read(targetA2));
		if (!second.weather) throw new Error("weather defaults missing");
		await f.run(ClockStore.setHourFormat("12h", targetA2));
		await f.run(ClockStore.setTheme("1,1", "cyber", targetA2));
		await f.run(ClockStore.setMusic(false, targetA2));
		await f.run(
			ClockStore.setWeather(
				{ ...second.weather, city: "Paris", unit: "fahrenheit" },
				targetA2,
			),
		);
		await f.run(ClockStore.setTheme("1,1", "aurora", targetA));
		await f.restart();
		expect(await f.run(ClockStore.read(targetA2))).toMatchObject({
			hourFormat: "12h",
			themeId: "cyber",
			musicEnabled: false,
			weather: { city: "Paris", unit: "fahrenheit" },
		});
		expect(await f.run(ClockStore.read(targetA))).toMatchObject({
			hourFormat: "24h",
			themeId: "aurora",
			musicEnabled: true,
			weather: { city: "", unit: "celsius" },
		});
		expect(await f.run(ClockStore.read(targetB))).toMatchObject({
			revision: 0,
			themeId: "season",
			weather: { city: "" },
		});
	});
	it("saves all four cards independently, preserves metadata and survives restart", async () => {
		const f = setup();
		const beforeB = f.stored().profiles[1];
		const initial = await f.run(ClockStore.read(targetA));
		expect(initial).toMatchObject({
			hourFormat: "24h",
			musicEnabled: true,
			weather: { enabled: true, ipLookup: false, city: "" },
		});
		if (!initial.weather) throw new Error("weather defaults missing");
		await f.run(
			handleClockCommand(
				{
					_tag: "setWeather",
					target: targetA,
					settings: {
						...initial.weather,
						city: "Berlin",
						unit: "fahrenheit",
						forecastUrl: "https://weather.example/forecast",
					},
				},
				Effect.succeed(Option.none()),
			),
		);
		await f.run(
			handleClockCommand(
				{ _tag: "setMusic", target: targetA, enabled: false },
				Effect.succeed(Option.none()),
			),
		);
		await f.run(ClockStore.setHourFormat("12h", targetA));
		await f.run(ClockStore.setTheme("1,1", "tactical", targetA));
		expect(f.stored().profiles[1]).toEqual(beforeB);
		const weather = f
			.stored()
			.profiles[0].pages[0].keys[0]?.config.actions?.find(
				(a) => a.type === "weather",
			)?.value;
		expect(weather).toMatchObject({
			city: "Berlin",
			weatherVersion: 1,
			updatedAt: expect.any(Number),
			service: { forecastUrl: "https://weather.example/forecast" },
		});
		await f.restart();
		expect(await f.run(ClockStore.read(targetA))).toMatchObject({
			hourFormat: "12h",
			themeId: "tactical",
			musicEnabled: false,
			weather: { city: "Berlin", unit: "fahrenheit" },
		});
		expect(await f.run(ClockStore.read(targetB))).toMatchObject({
			hourFormat: "24h",
			themeId: "season",
			musicEnabled: true,
			weather: { city: "" },
		});
	});
	it("failed and stale enrichment/theme writes preserve both profiles", async () => {
		const f = setup();
		const current = await f.run(ClockStore.read(targetA));
		const before = f.stored();
		const choose = Effect.succeed(Option.none<string>());
		expect(
			await f.run(
				handleClockCommand(
					{
						_tag: "setTheme",
						target: targetA,
						keyCode: "1,1",
						themeId: "aurora",
						expectedRevision: current.revision + 1,
					},
					choose,
				),
			),
		).toMatchObject({ _tag: "failure" });
		f.state.fail = true;
		for (const command of [
			{
				_tag: "setWeather",
				settings: { ...current.weather, city: "Paris" },
				target: targetA,
			},
			{ _tag: "setMusic", enabled: false, target: targetB },
			{ _tag: "setTheme", keyCode: "1,1", themeId: "cyber", target: targetA },
		]) {
			expect(await f.run(handleClockCommand(command, choose))).toMatchObject({
				_tag: "failure",
			});
		}
		expect(f.stored()).toEqual(before);
		expect(f.state.writes).toBe(0);
	});
	it("resolves omitted device targets only within that device's selected page", async () => {
		const f = setup();
		const envelope = Schema.decodeUnknownSync(ProfileEnvelope)({
			...f.stored(),
			activeByDevice: {
				A: { profileId: a.id, pageId: a.pages[0].id },
				B: { profileId: b.id, pageId: b.pages[0].id },
			},
		});
		expect(activeClockTarget(envelope, "A", "1,1")).toEqual(targetA);
		expect(activeClockTarget(envelope, "B", "1,1")).toEqual(targetB);
		expect(activeClockTarget(envelope, "unknown", "1,1")).toBeUndefined();
		expect(activeClockTarget(envelope, "B", "2,2")).toBeUndefined();
	});
	it("preset preserves legacy flags as data and has no knob or touch effect", () => {
		const key = a.pages[0].keys[0];
		expect(key?.config).toMatchObject({
			supportKnob: false,
			supportTouchEffect: false,
			icon: "",
			basicEditableItems: {
				title: false,
				grid: false,
				icon: false,
				allowDelete: false,
				allowDrag: false,
			},
		});
	});
	it("the real editor permits clock title/icon/move but keeps structural resize/delete locks", async () => {
		const f = setup();
		const repository = await f.profiles().runPromise(ProfileRepository);
		const editor = ManagedRuntime.make(
			KeyEditing.DefaultWithoutDependencies.pipe(
				Layer.provideMerge(
					ProfileService.DefaultWithoutDependencies.pipe(
						Layer.provideMerge(Layer.succeed(ProfileRepository, repository)),
					),
				),
			),
		);
		const target = { ...targetA, revision: 0, token: "clock-locks" };
		const original = a.pages[0].keys[0];
		if (!original) throw new Error("clock key missing");
		try {
			for (const field of ["title", "icon", "grid", "allowDrag"] as const) {
				const key = {
					...original,
					config: {
						...original.config,
						...(field === "title"
							? { title: { ...original.config.title, text: "Changed" } }
							: {}),
						...(field === "icon" ? { icon: "changed" } : {}),
						...(field === "grid" ? { size: [2, 1] } : {}),
					},
				};
				const result = await editor.runPromise(
					KeyEditing.preview(
						target,
						key,
						field === "allowDrag" ? { destination: "1,2" } : {},
					).pipe(Effect.either),
				);
				expect(result).toMatchObject({
					_tag: "Right",
					right: { _tag: field === "grid" ? "rejected" : "ready" },
				});
				await editor.runPromise(KeyEditing.revert(target.token));
			}
			expect(
				await editor.runPromise(KeyEditing.remove(target).pipe(Effect.either)),
			).toMatchObject({ _tag: "Left" });
			expect(f.state.writes).toBe(0);
		} finally {
			await editor.dispose();
		}
	});
});
