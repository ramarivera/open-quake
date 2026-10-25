import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect, Array as EffectArray, Fiber, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translateProfile } from "../../../../../packages/device/src/profiles/profile-catalog.js";
import { ProfileEnvelope } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import type { ProfileLocale } from "../../../../../packages/device/src/profiles/profile-manager-contracts.js";
import { profileThumbnailKey } from "../profiles/profile-thumbnail-key";
import { createProfileThumbnailStore } from "../profiles/profile-thumbnails";
import { desktopKnobAdapters } from "./desktop-adapters";

const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlYAAAAAASUVORK5CYII=",
	"base64",
);
vi.mock("electron", () => ({
	nativeImage: {
		createFromBuffer: (bytes: Buffer) => ({
			getSize: () => ({ width: 1, height: 1 }),
			isEmpty: () => bytes.length < 60,
		}),
	},
}));
const directories: string[] = [];
afterEach(async () => {
	for (const dir of directories.splice(0))
		await rm(dir, { recursive: true, force: true });
});
const initial = () =>
	Schema.decodeUnknownSync(ProfileEnvelope)({
		schemaVersion: 1,
		profiles: [
			{
				id: "first",
				name: "First",
				revision: 0,
				pages: [{ id: "a", keys: [] }],
			},
			{
				id: "second",
				name: "Second",
				revision: 0,
				pages: [{ id: "b", keys: [] }],
			},
		],
		activeByDevice: {},
	});
async function fixture() {
	const root = await mkdtemp(
		join(process.env.OPEN_QUAKE_TEST_SCRATCH ?? tmpdir(), "reader-"),
	);
	directories.push(root);
	return root;
}
describe("profile manager to knob thumbnail handoff", () => {
	it("uses the manager producer once, reads the same canonical file, and invalidates locale and same-revision edits", async () => {
		const root = await fixture();
		let saved = initial();
		let locale: ProfileLocale = "en";
		const store = createProfileThumbnailStore(join(root, "profiles"));
		const thumbnail = vi.fn(
			async (id: string, requestedLocale: ProfileLocale) => {
				const profile = saved.profiles.find((p) => p.id === id);
				if (!profile) throw new Error("Missing fixture");
				return store.write(
					translateProfile(profile, requestedLocale),
					requestedLocale,
					png,
				);
			},
		);
		const adapter = desktopKnobAdapters(root, {
			locale: () => locale,
			thumbnail,
			profiles: {
				read: Effect.sync(() => saved),
				select: () => Effect.succeed(saved),
			},
		});
		const context = await Effect.runPromise(adapter.load);
		const version = adapter.contextVersion();
		const ready = await Effect.runPromise(
			adapter.ports.warmThumbnails(context.profiles),
		);
		expect(ready.every((p) => p.thumbnail._tag === "ready")).toBe(true);
		expect(thumbnail).toHaveBeenCalledTimes(2);
		await Effect.runPromise(adapter.ports.warmThumbnails(context.profiles));
		expect(thumbnail).toHaveBeenCalledTimes(2);
		locale = "de";
		const german = await Effect.runPromise(adapter.load);
		expect(adapter.contextVersion()).not.toBe(version);
		await Effect.runPromise(adapter.ports.warmThumbnails(german.profiles));
		expect(thumbnail).toHaveBeenCalledTimes(4);
		saved = {
			...saved,
			profiles: EffectArray.map(saved.profiles, (p) =>
				p.id === "first" ? { ...p, name: "Edited" } : p,
			),
		};
		const edited = await Effect.runPromise(adapter.load);
		await Effect.runPromise(adapter.ports.warmThumbnails(edited.profiles));
		expect(thumbnail).toHaveBeenCalledTimes(5);
	});
	it("discards a late old-content capture and skips corrupt files without poisoning other menu entries", async () => {
		const root = await fixture();
		let saved = initial();
		const old = saved.profiles[0];
		const store = createProfileThumbnailStore(join(root, "profiles"));
		const entered = await Effect.runPromise(Deferred.make<void>());
		const release = await Effect.runPromise(Deferred.make<void>());
		const adapter = desktopKnobAdapters(root, {
			profiles: {
				read: Effect.sync(() => saved),
				select: () => Effect.succeed(saved),
			},
			thumbnail: async (id, locale) => {
				if (id === old.id) {
					await Effect.runPromise(Deferred.succeed(entered, undefined));
					await Effect.runPromise(Deferred.await(release));
					return store.write(old, locale, png);
				}
				return store.write(
					saved.profiles.find((p) => p.id === "second") ?? old,
					locale,
					png,
				);
			},
		});
		const context = await Effect.runPromise(adapter.load);
		const warming = Effect.runPromise(
			adapter.ports.warmThumbnails(context.profiles),
		);
		await Effect.runPromise(Deferred.await(entered));
		saved = {
			...saved,
			profiles: EffectArray.map(saved.profiles, (p) =>
				p.id === old.id ? { ...p, name: "Replacement" } : p,
			),
		};
		await Effect.runPromise(Deferred.succeed(release, undefined));
		const ready = await warming;
		expect(ready[0]?.thumbnail._tag).toBe("missing");
		expect(ready[1]?.thumbnail._tag).toBe("ready");
		const next = await Effect.runPromise(adapter.load);
		await mkdir(join(root, "profiles", "thumbnails"), { recursive: true });
		await writeFile(
			join(
				root,
				"profiles",
				"thumbnails",
				`${profileThumbnailKey(saved.profiles[0], "en")}.png`,
			),
			png.subarray(0, 8),
		);
		const partial = await Effect.runPromise(
			adapter.ports.warmThumbnails(next.profiles),
		);
		expect(partial.map((p) => p.thumbnail._tag)).toEqual(["missing", "ready"]);
	});
	it("passes cancellation to the manager and does not publish an interrupted capture", async () => {
		const root = await fixture();
		const saved = initial();
		let signal: AbortSignal | undefined;
		const entered = await Effect.runPromise(Deferred.make<void>());
		const adapter = desktopKnobAdapters(root, {
			profiles: {
				read: Effect.succeed(saved),
				select: () => Effect.succeed(saved),
			},
			thumbnail: async (_id, _locale, requestedSignal) => {
				signal = requestedSignal;
				await Effect.runPromise(Deferred.succeed(entered, undefined));
				return new Promise<string>((_resolve, reject) =>
					requestedSignal.addEventListener(
						"abort",
						() => reject(requestedSignal.reason),
						{ once: true },
					),
				);
			},
		});
		const context = await Effect.runPromise(adapter.load);
		const warming = Effect.runFork(
			adapter.ports.warmThumbnails(context.profiles),
		);
		await Effect.runPromise(Deferred.await(entered));
		await Effect.runPromise(Fiber.interrupt(warming));
		expect(signal?.aborted).toBe(true);
	});
});
