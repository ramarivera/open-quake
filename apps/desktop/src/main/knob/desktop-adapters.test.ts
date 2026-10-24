import { describe, expect, it } from "@effect/vitest";
import { HardwareControls, QuakeDevice } from "@open-quake/device";
import { makeFakeHardwareTransport } from "@open-quake/device/hardware/fake";
import {
	Effect,
	Layer,
	ManagedRuntime,
	Option,
	Schema,
	Stream,
	TestClock,
} from "effect";
import { KnobModelPorts } from "../../../../../packages/device/src/knob/model/ports.js";
import { KnobModel } from "../../../../../packages/device/src/knob/model/service.js";
import {
	type EncodedProfileEnvelope,
	ProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service.js";
import { ProfilesLive } from "../profiles/profile-ipc";
import { desktopKnobAdapters } from "./desktop-adapters";
import { makeKnobRuntime } from "./index";
import { canRequestKnob } from "./permissions";
import { knobProfileBinding } from "./profile-binding";

const source = (): EncodedProfileEnvelope => ({
	schemaVersion: 1,
	profiles: [
		{
			id: "grid",
			name: "Workspace",
			revision: 0,
			pages: [{ id: "page", keys: [] }],
		},
		{
			id: "colorful",
			name: "Colorful Screen",
			revision: 0,
			pages: [{ id: "wallpaper", keys: [] }],
			compatibility: { name: "5,Colorful Screen", resourceId: "1-4" },
		},
	],
	activeByDevice: {},
});

describe("desktop knob integration", () => {
	it.scoped(
		"routes focused screen luminance, volume and failure tones through available production adapters",
		() =>
			Effect.gen(function* () {
				const fake = yield* makeFakeHardwareTransport();
				const device = yield* QuakeDevice.pipe(
					Effect.provide(
						QuakeDevice.DefaultWithoutDependencies.pipe(
							Layer.provide(fake.layer),
						),
					),
				);
				const connection = yield* device.connect();
				const controls = yield* HardwareControls.pipe(
					Effect.provide(HardwareControls.Default),
				);
				const hardware = yield* controls.create(connection, {
					serial: "mock-quake",
					session: "hardware-1",
				});
				yield* hardware.refresh();
				yield* hardware.configure({
					...(yield* hardware.snapshot()).preferences,
					alertVolume: 64,
				});
				const volumes: number[] = [];
				const adapter = desktopKnobAdapters(
					"/unused",
					{
						hardware: () => hardware,
						readVolume: Effect.succeed({ level: 50, muted: false }),
						writeVolume: (reading) =>
							Effect.sync(() => {
								volumes.push(reading.level);
							}),
					},
					{ read: async () => source(), write: async () => undefined },
				);
				yield* TestClock.adjust(1000);
				yield* Effect.gen(function* () {
					const model = yield* KnobModel;
					const context = yield* adapter.load;
					yield* model.configure({
						...context,
						keys: [
							{
								keyCode: "1,1",
								kind: "luminance",
								visible: true,
								supportKnob: true,
							},
							{ keyCode: "1,2", kind: "vol", visible: true, supportKnob: true },
							{
								keyCode: "1,3",
								kind: "hotkey",
								visible: true,
								supportKnob: true,
							},
						],
					});
					const send = (input: object) =>
						model.dispatch({ sessionId: context.session.sessionId, ...input });
					yield* send({ _tag: "TapTile", keyCode: "1,1" });
					yield* send({ _tag: "Rotate", delta: -1 });
					expect((yield* hardware.snapshot()).luminance).toBe(229);
					expect([...((yield* fake.writes).at(-1) ?? [])].slice(3, 6)).toEqual([
						1, 5, 229,
					]);
					yield* send({ _tag: "TapTile", keyCode: "1,2" });
					yield* send({ _tag: "Rotate", delta: 1 });
					expect(volumes).toEqual([51]);
					expect((yield* model.snapshot()).notice).toBe("");
					yield* send({ _tag: "TapTile", keyCode: "1,3" });
					yield* send({ _tag: "Rotate", delta: 1 }).pipe(Effect.either);
					yield* TestClock.adjust(0);
					expect([...((yield* fake.writes).at(-1) ?? [])].slice(3, 6)).toEqual([
						1, 2, 64,
					]);
					yield* TestClock.adjust(199);
					expect([...((yield* fake.writes).at(-1) ?? [])].slice(3, 6)).toEqual([
						1, 2, 64,
					]);
					yield* TestClock.adjust(1);
					expect((yield* model.snapshot()).notice).toBe(
						"QUAKE.KNOB.CAPABILITY_UNAVAILABLE",
					);
					const commands = (yield* fake.writes).map((bytes) =>
						[...bytes].slice(3, 6),
					);
					expect(commands.slice(-2)).toEqual([
						[1, 2, 64],
						[1, 2, 0],
					]);
					const before = commands.length;
					yield* hardware.configure({
						...(yield* hardware.snapshot()).preferences,
						buzzerEnabled: false,
					});
					yield* send({ _tag: "Key", code: 5 }).pipe(Effect.either);
					yield* TestClock.adjust(200);
					expect(yield* fake.writes).toHaveLength(before);
				}).pipe(
					Effect.provide(
						KnobModel.DefaultWithoutDependencies.pipe(
							Layer.provide(Layer.succeed(KnobModelPorts, adapter.ports)),
						),
					),
				);
			}),
	);

	it.effect(
		"commits actual local profile selection and passes voice generations without slot dispatch",
		() =>
			Effect.gen(function* () {
				let committed = source();
				let writes = 0;
				const voices: string[] = [];
				const adapter = desktopKnobAdapters(
					"/unused",
					{
						voice: (input) =>
							Effect.sync(() => {
								voices.push(`${input.action}:${input.generation}`);
							}),
					},
					{
						read: () => Promise.resolve(committed),
						write: (next) => {
							committed = next;
							writes++;
							return Promise.resolve();
						},
					},
				);
				const runtime = makeKnobRuntime(adapter.ports);
				yield* Effect.acquireUseRelease(
					Effect.succeed(runtime),
					() =>
						Effect.promise(async () => {
							await runtime.runPromise(
								adapter.load.pipe(Effect.flatMap(KnobModel.configure)),
							);
							const send = async (code: number): Promise<void> => {
								const snapshot = await runtime.runPromise(KnobModel.snapshot());
								await runtime.runPromise(
									KnobModel.dispatch({
										_tag: "Key",
										sessionId: snapshot.context.session.sessionId,
										code,
									}),
								);
							};
							await send(5);
							await send(255);
							await send(1);
							await send(2);
							expect(voices).toEqual([
								"holdStart:1",
								"release:1",
								"interrupt:1",
							]);
							expect(writes).toBe(1);
							expect(committed.activeByDevice["desktop-preview"]).toEqual({
								profileId: "colorful",
								pageId: "wallpaper",
							});
							expect(
								Schema.is(ProfileEnvelope)(
									Schema.decodeUnknownSync(ProfileEnvelope)(committed),
								),
							).toBe(true);
							await send(2);
							expect(writes).toBe(1);
						}),
					() => Effect.promise(() => runtime.dispose()),
				);
			}),
	);
	it("selects through the shared profile repository and publishes the committed snapshot", async () => {
		let committed = source();
		let writes = 0;
		let failWrite = false;
		const profiles = ManagedRuntime.make(
			ProfilesLive({
				read: async () => committed,
				write: async (next) => {
					if (failWrite) throw new Error("native storage failure");
					committed = next;
					writes++;
				},
			}),
		);
		const adapter = desktopKnobAdapters(
			"/unused",
			{ profiles: knobProfileBinding(profiles) },
			{
				read: async () => {
					throw new Error("old raw storage read");
				},
				write: async () => {
					throw new Error("old raw storage write");
				},
			},
		);
		const runtime = makeKnobRuntime(adapter.ports);
		try {
			await runtime.runPromise(
				adapter.load.pipe(Effect.flatMap(KnobModel.configure)),
			);
			const state = await runtime.runPromise(KnobModel.snapshot());
			await runtime.runPromise(
				KnobModel.dispatch({
					_tag: "Key",
					sessionId: state.context.session.sessionId,
					code: 2,
				}),
			);
			const published = await profiles.runPromise(
				ProfileService.subscribeCommittedProfiles().pipe(
					Effect.flatMap(Stream.runHead),
				),
			);
			expect(
				Option.isSome(published) &&
					published.value.activeByDevice["desktop-preview"]?.profileId,
			).toBe("colorful");
			expect(committed.activeByDevice["desktop-preview"]?.profileId).toBe(
				"colorful",
			);
			expect(writes).toBe(1);
			const next = await runtime.runPromise(KnobModel.snapshot());
			await runtime.runPromise(
				adapter.load.pipe(Effect.flatMap(KnobModel.synchronize)),
			);
			expect(
				(await runtime.runPromise(KnobModel.snapshot())).context.session
					.sessionId,
			).toBe(next.context.session.sessionId);
			const invalid = await profiles.runPromise(
				Effect.either(
					ProfileService.selectProfile({
						deviceId: "desktop-preview",
						profileId: "grid",
						pageId: "missing",
					}),
				),
			);
			expect(invalid).toMatchObject({
				_tag: "Left",
				left: { _tag: "ProfileNotFound" },
			});
			expect(writes).toBe(1);
			failWrite = true;
			const failed = await profiles.runPromise(
				Effect.either(
					ProfileService.selectProfile({
						deviceId: "desktop-preview",
						profileId: "grid",
					}),
				),
			);
			expect(failed).toMatchObject({
				_tag: "Left",
				left: { _tag: "ProfileWriteFailed" },
			});
			expect(
				(await profiles.runPromise(ProfileService.loadProfiles())).envelope
					.activeByDevice["desktop-preview"]?.profileId,
			).toBe("colorful");
		} finally {
			await runtime.dispose();
			await profiles.dispose();
		}
	});
	it("accepts only app-document panel mutations and never accepts firmware events from renderer", () => {
		const renderer = "file:///app/index.html";
		const input = { _tag: "Page", sessionId: "session", delta: 1 };
		expect(
			canRequestKnob(`${renderer}?surface=management`, renderer, input, true),
		).toBe(true);
		expect(
			canRequestKnob(`${renderer}?surface=panel`, renderer, input, false),
		).toBe(false);
		expect(
			canRequestKnob(
				"https://attacker.test/app/index.html",
				renderer,
				input,
				true,
			),
		).toBe(false);
		expect(canRequestKnob(renderer, renderer, { _tag: "Read" }, false)).toBe(
			true,
		);
		for (const code of [1, 2, 5, 255])
			expect(
				canRequestKnob(
					renderer,
					renderer,
					{ _tag: "Key", sessionId: "session", code },
					true,
				),
			).toBe(false);
	});
});
