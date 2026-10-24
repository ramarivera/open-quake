import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, ManagedRuntime, Option, Schema } from "effect";
import { expect, it } from "vitest";
import {
	createEmptyProfileKey,
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
	Profile,
	ProfileEnvelope,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { managerState } from "../../../../../packages/device/src/profiles/profile-manager-invariants.js";
import { profileStorageLayer } from "../../../../../packages/device/src/profiles/profile-repository.js";
import {
	ProfileSwitching,
	ProfileSwitchingPort,
} from "../../../../../packages/device/src/profiles/profile-switching-service.js";
import { mergeBackup } from "./backup-merge";
import { clearOwnedData, exportBackup, prepareRestore } from "./backup-store";

const seed = encodeProfileEnvelope(createInitialProfileEnvelope());
const emptyKey = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
const custom = (id: string, marker: string) =>
	Schema.encodeSync(Profile)(
		Schema.decodeUnknownSync(Profile)({
			...seed.profiles[0],
			id,
			name: marker,
			pages: [
				{
					id: "1",
					keys: [
						{
							...emptyKey,
							compatibility: { unsupported: true },
							config: {
								...emptyKey.config,
								type: "synthetic",
								actions: [{ type: "synthetic", value: marker }],
							},
						},
					],
				},
			],
		}),
	);
const link = (
	profileId: string,
	appPath = "/Applications/Editor.app",
	device?: string,
) => ({
	profileId,
	appPath,
	appIdentifier: "Editor",
	...(device ? { device } : {}),
});
const envelope = (
	profiles: (typeof Profile.Encoded)[],
	links: ReturnType<typeof link>[] = [],
) => ({
	...seed,
	profiles: [seed.profiles[0], ...profiles],
	manager: {
		revision: 7,
		nextId: 99,
		installed: true,
		hidden: [],
		userHasSetDefault: true,
		anchor: seed.profiles[0].id,
		startup: seed.profiles[0].id,
		approvedCommands: ["source-approval"],
		links,
	},
});
const nativeFiles = (source: unknown, platform = process.platform) =>
	new Map<string, Uint8Array>([
		[
			"export_index.json",
			Buffer.from(
				JSON.stringify({
					originalBasePath: "/source/resources/default",
					originalUserDataPath: "/source",
					originalPlatform: platform,
				}),
			),
		],
		["open-quake/profiles-v1.json", Buffer.from(JSON.stringify(source))],
	]);
const state = (value: unknown) =>
	managerState(Schema.decodeUnknownSync(ProfileEnvelope)(value));

it("rebases links onto added and content-deduplicated profiles, preserving destination manager state and idempotence", () => {
	const destination = envelope([custom("retained", "same")]);
	destination.manager.approvedCommands = ["destination-approval"];
	const source = envelope(
		[custom("source-same", "same"), custom("source-new", "new")],
		[link("source-same"), link("source-new", "/Applications/Other.app")],
	);
	const files = nativeFiles(source);
	const result = mergeBackup(files, destination, "/destination");
	const merged = state(result.envelope);
	expect(merged.links.map((l) => l.profileId)).toEqual([
		"retained",
		result.envelope.profiles[2]?.id,
	]);
	expect(merged.links.map((l) => l.appPath)).toEqual([
		"/Applications/Editor.app",
		"/Applications/Other.app",
	]);
	expect({ ...merged, links: [], revision: 0 }).toEqual({
		...state(destination),
		links: [],
		revision: 0,
	});
	expect(merged.revision).toBe(state(destination).revision + 1);
	expect(result.imported).toBe(1);
	expect(mergeBackup(files, result.envelope, "/destination").envelope).toEqual(
		result.envelope,
	);
});
it("rebases links after an imported ID collides with an edited retained import", () => {
	const files = nativeFiles(
		envelope([custom("source", "original")], [link("source")]),
	);
	const first = mergeBackup(files, seed, "/destination");
	const imported = first.envelope.profiles[1];
	if (!imported) throw new Error("Missing imported profile");
	const edited = envelope([custom(imported.id, "edited")]);
	const result = mergeBackup(files, edited, "/destination");
	expect(result.envelope.profiles[1]?.id).toBe(imported.id);
	expect(result.envelope.profiles[2]?.id).toBe(`${imported.id}-1`);
	expect(state(result.envelope).links[0]?.profileId).toBe(`${imported.id}-1`);
});
it.each([undefined, "device-a"])(
	"preserves destination associations and overlapping app identity with scope %s",
	(device) => {
		const destination = envelope(
			[custom("kept", "same"), custom("other", "other")],
			[
				link("kept", "/Applications/Kept.app"),
				link(
					"other",
					"/Applications/EDITOR.app/Contents/MacOS/Editor",
					"device-a",
				),
			],
		);
		const source = envelope(
			[custom("source-same", "same"), custom("new", "new")],
			[link("source-same"), link("new", "/applications/editor.app", device)],
		);
		const result = mergeBackup(
			nativeFiles(source),
			destination,
			"/destination",
		);
		expect(state(result.envelope).links).toEqual(state(destination).links);
		expect(result.envelope.manager).toEqual(destination.manager);
	},
);
it("keeps distinct device scopes and distinct paths with the same display identifier", () => {
	const destination = envelope(
		[custom("kept", "kept")],
		[link("kept", "/Applications/Editor.app", "device-a")],
	);
	const source = envelope(
		[custom("new", "new"), custom("another", "another")],
		[
			link("new", "/Applications/Editor.app", "device-b"),
			link("another", "/Elsewhere/Editor.app"),
		],
	);
	const result = mergeBackup(nativeFiles(source), destination, "/destination");
	expect(state(result.envelope).links).toHaveLength(3);
});
it("skips dangling links and incompatible-platform app identities without importing source transient state", () => {
	const source = envelope(
		[custom("source", "new")],
		[link("absent"), link("source")],
	);
	const result = mergeBackup(
		nativeFiles(source, process.platform === "win32" ? "darwin" : "win32"),
		seed,
		"/destination",
	);
	expect(result.envelope.manager).toBeUndefined();
	const samePlatform = mergeBackup(nativeFiles(source), seed, "/destination");
	expect(state(samePlatform.envelope).links).toHaveLength(1);
	expect(state(samePlatform.envelope).approvedCommands).toEqual([]);
	expect(state(samePlatform.envelope).startup).toEqual(Option.none());
	expect(state(samePlatform.envelope).anchor).toEqual(Option.none());
	expect(state(samePlatform.envelope).installed).toBe(false);
});
it("deduplicates source aliases onto one final profile and preserves the first association", () => {
	const source = envelope(
		[custom("alias-a", "same"), custom("alias-b", "same")],
		[link("alias-a"), link("alias-b", "/Applications/Other.app")],
	);
	const result = mergeBackup(nativeFiles(source), seed, "/destination");
	expect(result.imported).toBe(1);
	expect(state(result.envelope).links).toHaveLength(1);
	expect(state(result.envelope).links[0]?.appPath).toBe(
		"/Applications/Editor.app",
	);
	expect(
		mergeBackup(nativeFiles(source), result.envelope, "/destination").envelope,
	).toEqual(result.envelope);
});
it("restores an app-linked export after reset and switches through the real ProfileSwitching.probe", async () => {
	const root = await mkdtemp(join(tmpdir(), "linked-backup-"));
	const source = envelope([custom("custom-1", "linked")], [link("custom-1")]);
	const path = join(root, "profiles-v1.json");
	let runtime:
		| ManagedRuntime.ManagedRuntime<ProfileSwitching, unknown>
		| undefined;
	try {
		await writeFile(path, JSON.stringify(source));
		const backup = await exportBackup(root);
		await clearOwnedData(root);
		await mkdir(root);
		await writeFile(path, JSON.stringify(seed));
		const restore = await prepareRestore(backup, "synthetic.zip");
		await restore.validate(root);
		await restore.commit(root);
		const restored = Schema.decodeUnknownSync(ProfileEnvelope)(
			JSON.parse(await readFile(path, "utf8")),
		);
		const imported = restored.profiles.find((p) => p.name === "linked");
		expect(imported).toBeDefined();
		const pushes: string[] = [];
		runtime = ManagedRuntime.make(
			ProfileSwitching.Default.pipe(
				Layer.provide(
					profileStorageLayer({
						read: async () => JSON.parse(await readFile(path, "utf8")),
						write: async (value) => {
							await writeFile(path, JSON.stringify(value));
						},
					}),
				),
				Layer.provide(
					Layer.succeed(ProfileSwitchingPort, {
						platform: "darwin",
						foreground: () =>
							Effect.succeed(
								Option.some({
									id: "Editor",
									path: "/Applications/Editor.app/Contents/MacOS/Editor",
								}),
							),
						push: (_serial, profile) =>
							Effect.sync(() => {
								pushes.push(profile.id);
							}),
					}),
				),
			),
		);
		await runtime.runPromise(
			Effect.gen(function* () {
				const switching = yield* ProfileSwitching;
				yield* switching.connect("mock-serial", seed.profiles[0].id);
				yield* switching.probe();
			}),
		);
		expect(pushes).toEqual([seed.profiles[0].id, imported?.id]);
		const selected = JSON.parse(await readFile(path, "utf8"));
		expect(selected.activeByDevice["mock-serial"].profileId).toBe(imported?.id);
		await runtime.dispose();
		runtime = undefined;
		await (await prepareRestore(backup, "synthetic.zip")).commit(root);
		expect(state(JSON.parse(await readFile(path, "utf8"))).links).toHaveLength(
			1,
		);
	} finally {
		await runtime?.dispose();
		await rm(root, { recursive: true, force: true });
	}
});
