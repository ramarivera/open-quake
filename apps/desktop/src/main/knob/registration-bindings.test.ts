import { Deferred, Effect, Option, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { selectorProfiles } from "../../../../../packages/device/src/knob/model/invariants.js";
import { KnobModel } from "../../../../../packages/device/src/knob/model/service.js";
import {
	createEmptyProfileKey,
	encodeProfileEnvelope,
	ProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { desktopKnobAdapters } from "./desktop-adapters";
import { makeKnobRuntime, registerKnobRuntime } from "./index";

vi.mock("electron", () => ({
	app: {},
	nativeImage: {},
	ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));
const create = () =>
	makeKnobRuntime({
		selectProfile: () => Effect.never,
		focusedTurn: () => Effect.void,
		voice: () => Effect.void,
		readVolume: Effect.succeed({ level: 50, muted: false }),
		writeVolume: () => Effect.void,
		warmThumbnails: (p) => Effect.succeed(p),
	});
describe("knob registration binding lifecycle", () => {
	for (const mutation of ["add", "rename", "reorder", "delete"] as const)
		for (const mode of ["selector", "focus", "volume"] as const)
			it(`${mutation} through production registration preserves ${mode} and unchanged thumbnails`, async () => {
				const key = createEmptyProfileKey("1,1");
				const base = Schema.decodeUnknownSync(ProfileEnvelope)({
					schemaVersion: 1,
					profiles: ["cold", "active", "inactive", "third"].map((id) => ({
						id,
						name: id,
						revision: 0,
						pages: [{ id: `${id}-page`, keys: [] }],
					})),
					activeByDevice: {
						"desktop-preview": { profileId: "active", pageId: "active-page" },
					},
				});
				const active = base.profiles[1];
				if (!active) throw new Error("Missing active profile");
				const control = {
					...key,
					childrenName: Option.some("control"),
					config: {
						...key.config,
						type: mode === "volume" ? "playAudio" : "vol",
						supportKnob: true,
					},
				};
				let saved = Schema.validateSync(ProfileEnvelope)({
					...base,
					profiles: base.profiles.map((p) =>
						p.id === active.id
							? { ...active, pages: [{ ...active.pages[0], keys: [control] }] }
							: p,
					),
				});
				const write = vi.fn(async () => {});
				const adapters = desktopKnobAdapters(
					"/unused",
					{
						readVolume: Effect.succeed({ level: 50, muted: false }),
						writeVolume: () => Effect.void,
					},
					{ read: async () => encodeProfileEnvelope(saved), write },
				);
				const runtime = makeKnobRuntime(adapters.ports);
				const registration = registerKnobRuntime(
					runtime,
					adapters.load,
					() => undefined,
					() => [],
					undefined,
					{
						readVolume: Effect.never,
						contextVersion: adapters.contextVersion,
					},
				);
				try {
					await registration.refresh();
					const context = (await runtime.runPromise(KnobModel.snapshot()))
						.context;
					await runtime.runPromise(
						KnobModel.configure({
							...context,
							profiles: context.profiles.map((p) => ({
								...p,
								thumbnail:
									p.id === "cold"
										? { _tag: "missing" }
										: {
												_tag: "ready",
												dataUrl: "data:image/png;base64,YWJj",
											},
							})),
						}),
					);
					const send = (event: object) =>
						runtime.runPromise(
							KnobModel.dispatch({
								sessionId: context.session.sessionId,
								...event,
							}),
						);
					if (mode === "selector")
						await registration.onDevice({
							source: "mock",
							kind: "rotate",
							direction: 1,
						});
					if (mode === "focus") await send({ _tag: "TapTile", keyCode: "1,1" });
					if (mode === "volume") {
						await send({ _tag: "ToggleVolume" });
						await vi.waitFor(async () =>
							expect(
								(await runtime.runPromise(KnobModel.snapshot())).volume.phase,
							).toBe("active"),
						);
					}
					const before = await runtime.runPromise(KnobModel.snapshot());
					const version = adapters.contextVersion();
					const third = saved.profiles.find((p) => p.id === "third");
					if (!third) throw new Error("Missing third profile");
					const profiles =
						mutation === "add"
							? [...saved.profiles, { ...third, id: "added", name: "Added" }]
							: mutation === "rename"
								? saved.profiles.map((p) =>
										p.id === "inactive" ? { ...p, name: "Renamed" } : p,
									)
								: mutation === "reorder"
									? [...saved.profiles].reverse()
									: saved.profiles.filter((p) => p.id !== "inactive");
					saved = Schema.validateSync(ProfileEnvelope)({ ...saved, profiles });
					await registration.refresh();
					const after = await runtime.runPromise(KnobModel.snapshot());
					expect(adapters.contextVersion()).not.toBe(version);
					expect(after.context.profiles.map((p) => p.id)).toEqual(
						profiles.map((p) => p.id),
					);
					expect(after.context.session.profileId).toBe("active");
					expect(
						after.context.profiles.find((p) => p.id === "active")?.thumbnail,
					).toEqual(
						before.context.profiles.find((p) => p.id === "active")?.thumbnail,
					);
					if (mode === "selector") {
						expect(after.selector.mode).toBe("ring");
						expect(selectorProfiles(after)[after.selector.index]?.id).toBe(
							"active",
						);
					} else if (mode === "focus")
						expect(after.focus).toEqual(before.focus);
					else expect(after.volume.phase).toBe("active");
					if (mutation === "rename")
						expect(
							after.context.profiles.find((p) => p.id === "inactive"),
						).toMatchObject({
							name: "Renamed",
							thumbnail: { _tag: "missing" },
						});
					expect(write).not.toHaveBeenCalled();
				} finally {
					await registration.dispose();
				}
			});
	it("interrupts an in-flight observation when its registration is disposed", async () => {
		const runtime = create();
		const initial = (await runtime.runPromise(KnobModel.snapshot())).context;
		const entered = await Effect.runPromise(Deferred.make<void>());
		let interrupted = false;
		const readVolume = Deferred.succeed(entered, undefined).pipe(
			Effect.zipRight(Effect.never),
			Effect.onInterrupt(() =>
				Effect.sync(() => {
					interrupted = true;
				}),
			),
		);
		const registration = registerKnobRuntime(
			runtime,
			Effect.succeed({ ...initial, player: true }),
			() => undefined,
			() => [],
			undefined,
			{ readVolume },
		);
		try {
			await registration.refresh();
			await runtime.runPromise(
				KnobModel.dispatch({
					_tag: "ToggleVolume",
					sessionId: initial.session.sessionId,
				}),
			);
			await Effect.runPromise(Deferred.await(entered));
			await registration.dispose();
			expect(interrupted).toBe(true);
		} finally {
			if (!interrupted) await registration.dispose();
		}
	});
});
