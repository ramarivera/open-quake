import { describe, expect, it } from "@effect/vitest";
import {
	Effect,
	Either,
	Fiber,
	FastCheck as fc,
	Layer,
	Option,
	Schema,
	Stream,
	TestClock,
} from "effect";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
} from "./profile-contracts.js";
import { ProfileDeliveryFailed, ProfileWriteFailed } from "./profile-errors.js";
import {
	applyManagerCommand,
	installProfileCatalog,
	managerState,
	truncateProfileName,
	visibleProfiles,
	weightedNameLength,
} from "./profile-manager-invariants.js";
import { ProfileManager } from "./profile-manager-service.js";
import {
	ProfileRepository,
	profileStorageLayer,
} from "./profile-repository.js";
import { appPathSimilarity } from "./profile-switching-invariants.js";
import {
	ProfileSwitching,
	ProfileSwitchingPort,
} from "./profile-switching-service.js";

const seed = () => {
	const initial = createInitialProfileEnvelope();
	const installed = installProfileCatalog(initial, "win32");
	// Manager rules use actual identities/labels, without dispatching preset keys.
	// Keep every catalog row for visibility/capacity and use minimal page data.
	return {
		...installed,
		profiles: [
			{ ...installed.profiles[0], pages: initial.profiles[0].pages },
			...installed.profiles.slice(1).map((profile) => ({
				...profile,
				pages: initial.profiles[0].pages,
			})),
		] satisfies typeof installed.profiles,
	};
};
const makeLayer = (
	storage: {
		read: () => Promise<unknown>;
		write: (e: unknown) => Promise<void>;
	},
	pushes: string[] = [],
	foreground: () => Effect.Effect<
		Option.Option<{ readonly id: string; readonly path: string }>
	> = () => Effect.succeed(Option.none()),
	push?: (
		serial: string,
		profile: Profile,
	) => Effect.Effect<void, ProfileDeliveryFailed>,
) =>
	Layer.mergeAll(
		ProfileManager.DefaultWithoutDependencies,
		ProfileSwitching.DefaultWithoutDependencies,
	).pipe(
		Layer.provideMerge(
			ProfileRepository.Default.pipe(
				Layer.provide(profileStorageLayer(storage)),
			),
		),
		Layer.provide(
			Layer.succeed(ProfileSwitchingPort, {
				platform: "darwin",
				foreground,
				push:
					push ??
					((serial, p) =>
						Effect.sync(() => {
							pushes.push(`${serial}:${p.id}`);
						})),
			}),
		),
	);
const memory = () => {
	let current: unknown = encodeProfileEnvelope(seed());
	return {
		read: async () => current,
		write: async (e: unknown) => {
			current = e;
		},
	};
};
describe("profile manager behavior", () => {
	it.effect(
		"deleting another custom preserves the transient selection and stable anchor",
		() =>
			Effect.gen(function* () {
				const manager = yield* ProfileManager;
				yield* manager.command({ type: "select", id: "1-2" });
				yield* manager.command({ type: "create" });
				yield* manager.command({ type: "create" });
				yield* manager.command({
					type: "delete",
					id: "custom-1",
					confirmed: true,
				});
				const envelope = yield* manager.read();
				expect(envelope.activeByDevice["desktop-preview"]?.profileId).toBe(
					"custom-2",
				);
				expect(managerState(envelope).anchor).toEqual(Option.some("1-2"));
			}).pipe(Effect.provide(makeLayer(memory()))),
	);
	it.effect(
		"never restores a hidden deletion anchor, regardless of when it was hidden",
		() =>
			Effect.gen(function* () {
				const manager = yield* ProfileManager;
				yield* manager.command({ type: "select", id: "1-1" });
				yield* manager.command({ type: "create" });
				yield* manager.command({
					type: "visibility",
					id: "1-1",
					visible: false,
				});
				yield* manager.command({
					type: "delete",
					id: "custom-1",
					confirmed: true,
				});
				expect(
					(yield* manager.read()).activeByDevice["desktop-preview"]?.profileId,
				).toBe("local-profile");
				yield* manager.command({
					type: "visibility",
					id: "1-1",
					visible: true,
				});
				yield* manager.command({ type: "select", id: "1-1" });
				yield* manager.command({
					type: "visibility",
					id: "1-1",
					visible: false,
				});
				yield* manager.command({ type: "create" });
				yield* manager.command({
					type: "delete",
					id: "custom-2",
					confirmed: true,
				});
				expect(
					(yield* manager.read()).activeByDevice["desktop-preview"]?.profileId,
				).toBe("local-profile");
			}).pipe(Effect.provide(makeLayer(memory()))),
	);
	it.prop(
		"truncates arbitrary names to ten weighted units",
		[fc.string()],
		([name]) => {
			expect(weightedNameLength(truncateProfileName(name))).toBeLessThanOrEqual(
				10,
			);
			expect(name.startsWith(truncateProfileName(name))).toBe(true);
		},
	);
	it("protects built-ins and last visible default even with customs", () => {
		let e = seed();
		for (const p of e.profiles.filter((p) => p.id.startsWith("1-")).slice(1)) {
			const r = applyManagerCommand(e, {
				type: "visibility",
				id: p.id,
				visible: false,
			});
			if (r._tag === "updated") e = r.envelope;
		}
		expect(
			applyManagerCommand(e, { type: "visibility", id: "1-0", visible: false }),
		).toEqual({ _tag: "rejected", reason: "last-builtin" });
		expect(
			applyManagerCommand(e, { type: "delete", id: "1-0", confirmed: true }),
		).toEqual({ _tag: "rejected", reason: "builtin" });
		expect(
			applyManagerCommand(e, { type: "rename", id: "1-0", name: "Renamed" }),
		).toEqual({ _tag: "rejected", reason: "builtin" });
	});
	it("enforces capacity on unhide and preserves the hidden layout", () => {
		let e = seed();
		const hidden = applyManagerCommand(e, {
			type: "visibility",
			id: "1-1",
			visible: false,
		});
		if (hidden._tag === "updated") e = hidden.envelope;
		const original = e.profiles.find((p) => p.id === "1-1");
		for (let i = 0; i < 21; i++) {
			const r = applyManagerCommand(e, { type: "create" });
			if (r._tag === "updated") e = r.envelope;
		}
		expect(visibleProfiles(e)).toHaveLength(30);
		expect(
			applyManagerCommand(e, { type: "visibility", id: "1-1", visible: true }),
		).toEqual({ _tag: "rejected", reason: "limit" });
		expect(e.profiles.find((p) => p.id === "1-1")).toBe(original);
	});
	it("rejects names and requires deletion/default replacement confirmation", () => {
		const e = seed();
		for (const name of ["", "          ", "abcdefghijk"])
			expect(
				applyManagerCommand(e, { type: "rename", id: "local-profile", name }),
			).toEqual({ _tag: "rejected", reason: "name" });
		expect(
			applyManagerCommand(e, {
				type: "rename",
				id: "local-profile",
				name: "Quick",
			}),
		).toEqual({ _tag: "rejected", reason: "duplicate" });
		expect(
			applyManagerCommand(e, {
				type: "delete",
				id: "local-profile",
				confirmed: false,
			}),
		).toEqual({ _tag: "rejected", reason: "confirmation" });
		const first = applyManagerCommand(e, {
			type: "startup",
			id: "1-1",
			enabled: true,
			confirmed: false,
		});
		expect(first._tag).toBe("updated");
		if (first._tag === "updated")
			expect(
				applyManagerCommand(first.envelope, {
					type: "startup",
					id: "1-2",
					enabled: true,
					confirmed: false,
				}),
			).toEqual({ _tag: "rejected", reason: "confirmation" });
	});
	it.effect(
		"serializes manager changes with key saves and leaves a failed write unpublished",
		() =>
			Effect.gen(function* () {
				const repo = yield* ProfileRepository,
					manager = yield* ProfileManager;
				const before = yield* manager.read();
				const old = before.profiles.find((p) => p.id === "local-profile");
				if (!old) return yield* Effect.die("fixture missing");
				const { revision, ...draft } = Schema.encodeSync(Profile)(old);
				yield* Effect.all(
					[
						repo.save({
							expectedRevision: revision,
							profile: { ...draft, name: "Saved" },
						}),
						manager.command({ type: "create" }),
					],
					{ concurrency: "unbounded" },
				);
				const after = yield* manager.read();
				expect(after.profiles.find((p) => p.id === "local-profile")?.name).toBe(
					"Saved",
				);
				expect(after.profiles.some((p) => p.name === "Custom1")).toBe(true);
			}).pipe(Effect.provide(makeLayer(memory()))),
	);
	it.effect(
		"retains exact failure identity/cause and the committed snapshot after persistence failure",
		() => {
			const cause = new Error("private token=secret");
			const storage = memory();
			storage.write = async () => {
				throw cause;
			};
			return Effect.gen(function* () {
				const manager = yield* ProfileManager;
				const before = yield* manager.read();
				const result = yield* manager
					.command({ type: "create" })
					.pipe(Effect.either);
				expect(Either.isLeft(result)).toBe(true);
				if (Either.isLeft(result)) {
					expect(result.left).toBeInstanceOf(ProfileWriteFailed);
					if (result.left instanceof ProfileWriteFailed)
						expect(result.left.originalCause).toBe(cause);
					expect(JSON.stringify(result.left)).not.toContain("secret");
				}
				expect(yield* manager.read()).toBe(before);
			}).pipe(Effect.provide(makeLayer(storage)));
		},
	);
	it.effect(
		"duplicates detach nested values and active deletion restores the stable anchor",
		() =>
			Effect.gen(function* () {
				const manager = yield* ProfileManager;
				yield* manager.command({ type: "select", id: "1-2" });
				yield* manager.command({ type: "duplicate", id: "1-2" });
				const e = yield* manager.read();
				const duplicate = e.profiles.find((p) => p.id === "custom-1"),
					source = e.profiles.find((p) => p.id === "1-2");
				expect(duplicate?.pages[0].keys).not.toBe(source?.pages[0].keys);
				expect(duplicate?.name).toBe("Quick - Copy1");
				yield* manager.command({ type: "select", id: "custom-1" });
				yield* manager.command({ type: "create" });
				yield* manager.command({
					type: "delete",
					id: "custom-2",
					confirmed: true,
				});
				expect(
					(yield* manager.read()).activeByDevice["desktop-preview"]?.profileId,
				).toBe("custom-1");
			}).pipe(Effect.provide(makeLayer(memory()))),
	);
});

import { Profile } from "./profile-contracts.js";

describe("automatic profile selection", () => {
	it.effect(
		"SCREEN-018 enrolls a new serial with the colorful fallback before publishing its selection",
		() => {
			const pushes: string[] = [];
			return Effect.gen(function* () {
				const switching = yield* ProfileSwitching;
				const repo = yield* ProfileRepository;
				expect((yield* repo.load()).envelope.activeByDevice.A).toBeUndefined();
				yield* switching.connect("A");
				const selection = (yield* repo.load()).envelope.activeByDevice.A;
				expect(selection).toMatchObject({ profileId: "1-4" });
				expect(pushes).toEqual(["A:1-4"]);
				yield* switching.disconnect("A");
				yield* switching.connect("A", "1-2");
				expect((yield* repo.load()).envelope.activeByDevice.A?.profileId).toBe(
					"1-2",
				);
			}).pipe(Effect.provide(makeLayer(memory(), pushes)));
		},
	);

	it.effect(
		"failed delivery leaves storage and subscribers unchanged and allows reconnect retry",
		() => {
			const storage = memory();
			const cause = new Error("token=private");
			const failure = ProfileDeliveryFailed.fromCause(cause);
			let fail = true;
			return Effect.gen(function* () {
				const switching = yield* ProfileSwitching,
					repo = yield* ProfileRepository;
				const before = (yield* repo.load()).envelope;
				const publications: unknown[] = [];
				const subscription = yield* Stream.runForEach(repo.snapshots, (e) =>
					Effect.sync(() => {
						publications.push(e);
					}),
				).pipe(Effect.fork);
				yield* TestClock.adjust(0);
				const result = yield* switching
					.connect("desktop-preview", "1-2")
					.pipe(Effect.either);
				expect(result).toEqual(Either.left(failure));
				expect(failure.originalCause).toBe(cause);
				expect(JSON.stringify(failure)).not.toContain("private");
				expect((yield* repo.load()).envelope).toBe(before);
				expect(yield* Effect.promise(storage.read)).toEqual(
					encodeProfileEnvelope(before),
				);
				yield* TestClock.adjust(0);
				expect(publications).toEqual([before]);
				fail = false;
				yield* switching.connect("desktop-preview", "1-2");
				expect(
					(yield* repo.load()).envelope.activeByDevice["desktop-preview"]
						?.profileId,
				).toBe("1-2");
				yield* Fiber.interrupt(subscription);
			}).pipe(
				Effect.provide(
					makeLayer(storage, [], undefined, () =>
						fail ? Effect.fail(failure) : Effect.void,
					),
				),
			);
		},
	);
	it.effect(
		"hiding a startup profile clears the default and reconnect uses a visible profile",
		() => {
			const pushes: string[] = [];
			return Effect.gen(function* () {
				const manager = yield* ProfileManager,
					switching = yield* ProfileSwitching;
				yield* manager.command({
					type: "startup",
					id: "1-1",
					enabled: true,
					confirmed: true,
				});
				yield* switching.connect("serial");
				yield* switching.disconnect("serial");
				yield* manager.command({
					type: "visibility",
					id: "1-1",
					visible: false,
				});
				expect(managerState(yield* manager.read()).startup).toEqual(
					Option.none(),
				);
				yield* switching.connect("serial", "1-2");
				expect(pushes).toEqual(["serial:1-1", "serial:1-2"]);
			}).pipe(Effect.provide(makeLayer(memory(), pushes)));
		},
	);
	it.effect(
		"ignores legacy hidden startup, reported and saved selections",
		() => {
			const envelope = seed();
			const storage = {
				...memory(),
				read: async () =>
					encodeProfileEnvelope({
						...envelope,
						activeByDevice: { serial: { profileId: "1-1", pageId: "1" } },
						manager: Option.some({
							...managerState(envelope),
							hidden: ["1-1"],
							startup: Option.some("1-1"),
						}),
					}),
			};
			const pushes: string[] = [];
			return Effect.gen(function* () {
				yield* (yield* ProfileSwitching).connect("serial", "1-1");
				expect(pushes).toHaveLength(1);
				expect(pushes[0]).not.toBe("serial:1-1");
			}).pipe(Effect.provide(makeLayer(storage, pushes)));
		},
	);
	it.effect(
		"chooses the best visible eligible app link separately for each device",
		() => {
			const pushes: string[] = [];
			return Effect.gen(function* () {
				const manager = yield* ProfileManager,
					switching = yield* ProfileSwitching;
				yield* switching.connect("a");
				yield* switching.connect("b");
				pushes.length = 0;
				for (const link of [
					{
						profileId: "1-1",
						appPath: "/Applications/Editor.app",
						appIdentifier: "Editor",
						device: "b",
					},
					{
						profileId: "1-2",
						appPath: "/Applications/Editors.app",
						appIdentifier: "Editors",
						device: "a",
					},
					{
						profileId: "1-3",
						appPath: "/Applications/Editor.app",
						appIdentifier: "Editor",
						device: "a",
					},
				])
					yield* manager.command({ type: "link", id: link.profileId, link });
				yield* manager.command({
					type: "visibility",
					id: "1-3",
					visible: false,
				});
				const work = yield* switching.probe().pipe(Effect.fork);
				yield* TestClock.adjust(300);
				yield* Fiber.join(work);
				expect(pushes.sort()).toEqual(["a:1-2", "b:1-1"]);
			}).pipe(
				Effect.provide(
					makeLayer(memory(), pushes, () =>
						Effect.succeed(
							Option.some({ id: "1", path: "/Applications/Editor.app" }),
						),
					),
				),
			);
		},
	);
	it.effect(
		"reserves a connection before concurrent initialization reports can load",
		() => {
			const pushes: string[] = [];
			return Effect.gen(function* () {
				const switching = yield* ProfileSwitching;
				yield* Effect.all(
					[switching.connect("same", "1-1"), switching.connect("same", "1-2")],
					{ concurrency: "unbounded" },
				);
				expect(pushes).toEqual(["same:1-1"]);
			}).pipe(Effect.provide(makeLayer(memory(), pushes)));
		},
	);
	it.effect(
		"disconnect invalidates initialization while storage is loading",
		() => {
			const pushes: string[] = [];
			let started: () => void = () => {};
			let release: (value: unknown) => void = () => {};
			const reading = new Promise<void>((resolve) => {
				started = resolve;
			});
			const data = new Promise<unknown>((resolve) => {
				release = resolve;
			});
			const storage = {
				...memory(),
				read: () => {
					started();
					return data;
				},
			};
			return Effect.gen(function* () {
				const switching = yield* ProfileSwitching;
				const init = yield* switching.connect("gone", "1-1").pipe(Effect.fork);
				yield* Effect.promise(() => reading);
				yield* switching.disconnect("gone");
				release(encodeProfileEnvelope(seed()));
				yield* Fiber.join(init);
				expect(pushes).toEqual([]);
				expect(yield* switching.connectedSerials()).toEqual([]);
			}).pipe(Effect.provide(makeLayer(storage, pushes)));
		},
	);
	it("normalizes bundle/executable paths and uses recovered LCS threshold", () => {
		expect(
			appPathSimilarity(
				"/Applications/Editor.app/Contents/MacOS/editor",
				"/applications/editor.app",
			),
		).toBe(1);
		expect(
			appPathSimilarity("C:\\Apps\\Editor.exe", "c:/apps/editor.exe"),
		).toBe(1);
		expect(appPathSimilarity("/one", "/another")).toBeLessThan(0.79);
	});
	it.effect(
		"startup override wins once, reconnection starts a fresh session",
		() => {
			const pushes: string[] = [];
			return Effect.gen(function* () {
				const manager = yield* ProfileManager,
					switching = yield* ProfileSwitching;
				yield* manager.command({
					type: "startup",
					id: "1-1",
					enabled: true,
					confirmed: true,
				});
				yield* switching.connect("serial", "1-2");
				yield* switching.connect("serial", "1-2");
				expect(pushes).toEqual(["serial:1-1"]);
				yield* switching.disconnect("serial");
				yield* switching.connect("serial", "1-2");
				expect(pushes).toEqual(["serial:1-1", "serial:1-1"]);
			}).pipe(Effect.provide(makeLayer(memory(), pushes)));
		},
	);
	it.effect(
		"debounces each device and cancels pending selections on disconnect",
		() => {
			const pushes: string[] = [];
			return Effect.gen(function* () {
				const switching = yield* ProfileSwitching;
				yield* switching.connect("a");
				yield* switching.connect("b");
				pushes.length = 0;
				const first = yield* switching.request("a", "1-1").pipe(Effect.fork);
				yield* TestClock.adjust(100);
				const last = yield* switching.request("a", "1-2").pipe(Effect.fork);
				const stopped = yield* switching.request("b", "1-3").pipe(Effect.fork);
				yield* switching.disconnect("b");
				yield* TestClock.adjust(300);
				yield* Fiber.join(first);
				yield* Fiber.join(last);
				yield* Fiber.join(stopped);
				expect(pushes).toEqual(["a:1-2"]);
			}).pipe(Effect.provide(makeLayer(memory(), pushes)));
		},
	);
	it.effect(
		"matches app links for all or one serial and keeps selection on unmatched focus",
		() => {
			const pushes: string[] = [];
			let foreground = {
				id: "1",
				path: "/Applications/Editor.app/Contents/MacOS/Editor",
			};
			return Effect.gen(function* () {
				const switching = yield* ProfileSwitching,
					manager = yield* ProfileManager;
				yield* switching.connect("a");
				yield* switching.connect("b");
				pushes.length = 0;
				yield* manager.command({
					type: "link",
					id: "1-1",
					link: {
						profileId: "1-1",
						appPath: "/Applications/Editor.app",
						appIdentifier: "Editor",
					},
				});
				yield* manager.command({
					type: "link",
					id: "1-2",
					link: {
						profileId: "1-2",
						appPath: "/Applications/Editor.app",
						appIdentifier: "Editor",
						device: "b",
					},
				});
				const work = yield* switching.probe().pipe(Effect.fork);
				yield* TestClock.adjust(300);
				yield* Fiber.join(work);
				expect(pushes.sort()).toEqual(["a:1-1", "b:1-2"]);
				foreground = { id: "2", path: "/unknown" };
				yield* switching.probe();
				expect(pushes).toHaveLength(2);
			}).pipe(
				Effect.provide(
					makeLayer(memory(), pushes, () =>
						Effect.succeed(Option.some(foreground)),
					),
				),
			);
		},
	);
	it.effect(
		"polls immediately and every 3000 ms, then stops all work when interrupted",
		() => {
			let probes = 0;
			return Effect.gen(function* () {
				const switching = yield* ProfileSwitching;
				yield* switching.connect("poll-target");
				const fiber = yield* switching.poll.pipe(Effect.fork);
				yield* TestClock.adjust(0);
				expect(probes).toBe(1);
				yield* TestClock.adjust(2999);
				expect(probes).toBe(1);
				yield* TestClock.adjust(1);
				expect(probes).toBe(2);
				yield* Fiber.interrupt(fiber);
				yield* TestClock.adjust(6000);
				expect(probes).toBe(2);
			}).pipe(
				Effect.provide(
					makeLayer(memory(), [], () =>
						Effect.sync(() => {
							probes++;
							return Option.none();
						}),
					),
				),
			);
		},
	);
});
