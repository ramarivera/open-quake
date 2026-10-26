import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EncodedProfileEnvelope } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileManager } from "../../../../../packages/device/src/profiles/profile-manager-service.js";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../packages/device/src/profiles/profile-repository.js";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service.js";
import {
	ProfileSwitching,
	ProfileSwitchingPort,
} from "../../../../../packages/device/src/profiles/profile-switching-service.js";
import {
	createDesktopProfileStorage,
	profileFileSystem,
} from "../profiles/local-profile-storage";
import {
	makeProfileController,
	type ProfileSelectionScope,
} from "../profiles/profile-controller";
import { desktopKnobAdapters } from "./desktop-adapters";
import { knobProfileBinding } from "./profile-binding";

vi.mock("electron", () => ({ nativeImage: {} }));
const initial: EncodedProfileEnvelope = {
	schemaVersion: 1 as const,
	profiles: [
		{ id: "first", name: "First", revision: 0, pages: [{ id: "a", keys: [] }] },
		{
			id: "second",
			name: "Second",
			revision: 0,
			pages: [{ id: "b", keys: [] }],
		},
	],
	activeByDevice: { "desktop-preview": { profileId: "first", pageId: "a" } },
};
const latch = () => {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, release: () => resolve() };
};
const directories: string[] = [];
afterEach(async () => {
	for (const dir of directories.splice(0))
		await rm(dir, { recursive: true, force: true });
});
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "knob-selection-"));
	directories.push(root);
	const path = join(root, "profiles.json");
	await createDesktopProfileStorage(path).write(initial);
	const entered = latch(),
		release = latch();
	let block: "read" | "write" | undefined;
	const storage = createDesktopProfileStorage(path, {
		...profileFileSystem,
		readFile: async (target) => {
			if (block === "read") {
				block = undefined;
				entered.release();
				await release.promise;
			}
			return profileFileSystem.readFile(target);
		},
		writeFile: async (target, contents) => {
			await profileFileSystem.writeFile(target, contents);
			if (block === "write" && !target.startsWith(`${path}.bak.`)) {
				block = undefined;
				entered.release();
				await release.promise;
			}
		},
	});
	const deliveries: string[] = [],
		publications: unknown[] = [];
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProfileManager.DefaultWithoutDependencies,
			ProfileService.DefaultWithoutDependencies,
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
					foreground: () => Effect.succeed(Option.none()),
					push: (serial, profile) =>
						Effect.sync(() => {
							deliveries.push(`${serial}:${profile.id}`);
						}),
				}),
			),
		),
	);
	const controller = await runtime.runPromise(
		makeProfileController({
			confirm: async () => true,
			execute: async () => {},
			chooseApp: async () => Option.none(),
			capture: async () => "",
			cachedThumbnail: async () => Option.none(),
			publish: (view) => {
				publications.push(view);
			},
			progress: () => {},
		}),
	);
	const switching = await runtime.runPromise(ProfileSwitching);
	let serial = "A";
	const select = (id: string, scope?: ProfileSelectionScope) =>
		runtime.runPromise(
			controller
				.request({ type: "manage", command: { type: "select", id } }, scope)
				.pipe(Effect.zipRight(ProfileManager.read())),
		);
	const adapter = desktopKnobAdapters(root, {
		deviceId: () => serial,
		profiles: knobProfileBinding(runtime, select),
	});
	return {
		root,
		path,
		storage,
		runtime,
		controller,
		switching,
		adapter,
		deliveries,
		publications,
		entered,
		release,
		block: (value: "read" | "write") => {
			block = value;
		},
		serial: (value: string) => {
			serial = value;
		},
	};
}
describe("device-owned knob selection through the manager", () => {
	it("rejects a selection that loses its serial while its shared repository read is blocked", async () => {
		const f = await fixture();
		let blocked = false,
			serial = "A";
		const entered = latch(),
			release = latch();
		const binding = knobProfileBinding(f.runtime, (id, scope) =>
			f.runtime.runPromise(
				f.controller
					.request({ type: "manage", command: { type: "select", id } }, scope)
					.pipe(Effect.zipRight(ProfileManager.read())),
			),
		);
		const adapter = desktopKnobAdapters(f.root, {
			deviceId: () => serial,
			profiles: {
				...binding,
				read: Effect.promise(async () => {
					if (blocked) {
						entered.release();
						await release.promise;
					}
					return f.runtime.runPromise(ProfileManager.read());
				}),
			},
		});
		try {
			await f.runtime.runPromise(f.switching.connect("A", "first"));
			await Effect.runPromise(adapter.load);
			const before = await f.runtime.runPromise(ProfileManager.read());
			blocked = true;
			const choosing = Effect.runPromise(
				adapter.ports.selectProfile("second").pipe(Effect.either),
			);
			await entered.promise;
			await f.runtime.runPromise(f.switching.disconnect("A"));
			serial = "B";
			await f.runtime.runPromise(f.switching.connect("B", "first"));
			release.release();
			expect(await choosing).toMatchObject({
				_tag: "Left",
				left: { code: "QUAKE.KNOB.SESSION_STALE" },
			});
			const after = await f.runtime.runPromise(ProfileManager.read());
			expect(after.activeByDevice["desktop-preview"]).toEqual(
				before.activeByDevice["desktop-preview"],
			);
			expect(after.activeByDevice.B?.profileId).toBe("first");
			expect(f.deliveries).not.toContain("B:second");
			expect(f.publications).toEqual([]);
		} finally {
			release.release();
			await f.runtime.dispose();
		}
	});

	it("rechecks ownership inside the manager transaction after waiting for another writer", async () => {
		const f = await fixture();
		const entered = latch(),
			release = latch();
		let holder: Promise<unknown> | undefined;
		const binding = knobProfileBinding(f.runtime, async (id, scope) => {
			holder = f.runtime.runPromise(
				Effect.gen(function* () {
					const repo = yield* ProfileRepository;
					yield* repo.transact((current) =>
						Effect.promise(async () => {
							entered.release();
							await release.promise;
							return current;
						}),
					);
				}),
			);
			await entered.promise;
			return f.runtime.runPromise(
				f.controller
					.request({ type: "manage", command: { type: "select", id } }, scope)
					.pipe(Effect.zipRight(ProfileManager.read())),
			);
		});
		const adapter = desktopKnobAdapters(f.root, {
			deviceId: () => "A",
			profiles: binding,
		});
		try {
			await f.runtime.runPromise(f.switching.connect("A", "first"));
			await Effect.runPromise(adapter.load);
			const before = await f.runtime.runPromise(ProfileManager.read());
			const choosing = Effect.runPromise(
				adapter.ports.selectProfile("second").pipe(Effect.either),
			);
			await entered.promise;
			await f.runtime.runPromise(f.switching.disconnect("A"));
			const reconnect = f.runtime.runPromise(f.switching.connect("B", "first"));
			release.release();
			expect((await choosing)._tag).toBe("Left");
			await reconnect;
			const after = await f.runtime.runPromise(ProfileManager.read());
			expect(after.activeByDevice["desktop-preview"]).toEqual(
				before.activeByDevice["desktop-preview"],
			);
			expect(after.activeByDevice.B?.profileId).toBe("first");
			expect(f.deliveries).not.toContain("B:second");
			expect(f.publications).toEqual([]);
		} finally {
			release.release();
			await holder;
			await f.runtime.dispose();
		}
	});

	it.each(["B", "A"])(
		"cancels a staged file write across disconnect/reconnect to %s, without changing preview or the replacement",
		async (replacement) => {
			const f = await fixture();
			try {
				await f.runtime.runPromise(f.switching.connect("A", "first"));
				await Effect.runPromise(f.adapter.load);
				const before = await f.runtime.runPromise(ProfileManager.read());
				f.block("write");
				const choosing = Effect.runPromise(
					f.adapter.ports.selectProfile("second").pipe(Effect.either),
				);
				await f.entered.promise;
				await f.runtime.runPromise(f.switching.disconnect("A"));
				f.serial(replacement);
				const reconnect = f.runtime.runPromise(
					f.switching.connect(replacement, "first"),
				);
				f.release.release();
				const result = await choosing;
				await reconnect;
				expect(result._tag).toBe("Left");
				const after = await f.runtime.runPromise(ProfileManager.read());
				expect(after.activeByDevice["desktop-preview"]).toEqual(
					before.activeByDevice["desktop-preview"],
				);
				expect(after.activeByDevice[replacement]?.profileId).toBe("first");
				expect(
					JSON.parse(await readFile(f.path, "utf8")).activeByDevice[
						"desktop-preview"
					].profileId,
				).toBe("first");
				expect(
					f.deliveries.filter((value) => value === `${replacement}:second`),
				).toHaveLength(replacement === "A" ? 1 : 0);
				expect(f.publications).toEqual([]);
			} finally {
				f.release.release();
				await f.runtime.dispose();
			}
		},
	);
	it("accepts a live selection when its committed publication refreshes the adapter context", async () => {
		const f = await fixture();
		let adapter: ReturnType<typeof desktopKnobAdapters>;
		const binding = knobProfileBinding(f.runtime, async (id, scope) => {
			const committed = await f.runtime.runPromise(
				f.controller
					.request({ type: "manage", command: { type: "select", id } }, scope)
					.pipe(Effect.zipRight(ProfileManager.read())),
			);
			await Effect.runPromise(adapter.load);
			return committed;
		});
		adapter = desktopKnobAdapters(f.root, {
			deviceId: () => "A",
			profiles: binding,
		});
		try {
			await f.runtime.runPromise(f.switching.connect("A", "first"));
			await Effect.runPromise(adapter.load);
			const selected = await Effect.runPromise(
				adapter.ports.selectProfile("second"),
			);
			expect(selected.session.profileId).toBe("second");
			expect(
				(await f.runtime.runPromise(ProfileManager.read())).activeByDevice.A
					?.profileId,
			).toBe("second");
		} finally {
			await f.runtime.dispose();
		}
	});

	it("updates preview and the originating device for live knob selection while manager UI still selects all devices", async () => {
		const f = await fixture();
		try {
			await f.runtime.runPromise(f.switching.connect("A", "first"));
			await f.runtime.runPromise(f.switching.connect("B", "first"));
			await Effect.runPromise(f.adapter.load);
			await Effect.runPromise(f.adapter.ports.selectProfile("second"));
			const selected = await f.runtime.runPromise(ProfileManager.read());
			expect(selected.activeByDevice["desktop-preview"]?.profileId).toBe(
				"second",
			);
			expect(selected.activeByDevice.A?.profileId).toBe("second");
			expect(selected.activeByDevice.B?.profileId).toBe("first");
			await f.runtime.runPromise(
				f.controller.request({
					type: "manage",
					command: { type: "select", id: "second" },
				}),
			);
			expect(
				(await f.runtime.runPromise(ProfileManager.read())).activeByDevice.B
					?.profileId,
			).toBe("second");
		} finally {
			await f.runtime.dispose();
		}
	});
});
