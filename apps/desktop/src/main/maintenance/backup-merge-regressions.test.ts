import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { builtinProfiles } from "../../../../../packages/device/src/profiles/profile-catalog.js";
import {
	createEmptyProfileKey,
	Profile,
	ProfileJsonObject,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { referenceArchive } from "./archive-fixtures";
import { mergeBackup } from "./backup-merge";
import { prepareRestore } from "./backup-store";

const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
const empty = {
	schemaVersion: 1,
	profiles: builtinProfiles("darwin")
		.slice(0, 1)
		.map((profile) => Schema.encodeSync(Profile)(profile)),
	activeByDevice: {},
};
const base = "C:/synthetic/resources";
const emptyKey = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
const key = (value: object) => ({
	...emptyKey,
	config: {
		...emptyKey.config,
		type: "synthetic",
		actions: [{ type: "synthetic", value }],
	},
});
const actionValue = (key: typeof ProfileKey.Encoded | undefined) =>
	Schema.decodeUnknownSync(ProfileJsonObject)(key?.config.actions?.[0]?.value);

function archive(
	pages: readonly { group: number; page: number; config: object }[],
) {
	return new Map<string, Uint8Array>([
		["synthetic_config.json", bytes({ config: {} })],
		[
			"export_index.json",
			bytes({ originalBasePath: base, originalPlatform: "win32" }),
		],
		[
			"app/assets/resources.conf",
			bytes([
				{
					data: pages.map((page, index) => ({
						id: `resource-${index}`,
						name: `${page.group},${page.page},1`,
						path: `${base}/app/assets/config/${index}.json`,
						resourceType: "DeviceConfig",
					})),
				},
			]),
		],
		...pages.map((page, index): [string, Uint8Array] => [
			`app/assets/config/${index}.json`,
			bytes([key(page.config)]),
		]),
	]);
}
describe("complete legacy profile identity", () => {
	it("retains matching and repeated pages, their order and later page changes", () => {
		const first = mergeBackup(
			archive([{ group: 1, page: 1, config: { action: "A" } }]),
			empty,
			"/destination",
		);
		const pages = ["A", "B", "A"].map((action, index) => ({
			group: 2,
			page: index + 1,
			config: { action },
		}));
		const files = archive([
			...pages,
			...pages.map((page) => ({ ...page, group: 3 })),
		]);
		const result = mergeBackup(files, first.envelope, "/destination");
		expect(result.imported).toBe(1);
		expect(result.skipped).toBe(1);
		expect(result.envelope.profiles).toHaveLength(3);
		const imported = result.envelope.profiles[2];
		expect(imported?.pages.map((page) => page.id)).toEqual(["1", "2", "3"]);
		expect(
			imported?.pages.map((page) => actionValue(page.keys[0]).action),
		).toEqual(["A", "B", "A"]);
		expect(mergeBackup(files, result.envelope, "/destination").imported).toBe(
			0,
		);
		const changed = archive(
			pages.map((page, index) =>
				index === 1 ? { ...page, config: { action: "C" } } : page,
			),
		);
		const next = mergeBackup(changed, result.envelope, "/destination");
		expect(next.imported).toBe(1);
		expect(next.envelope.profiles).toHaveLength(4);
		expect(next.envelope.profiles[2]).toEqual(imported);
		expect(
			next.envelope.profiles[3]?.pages.map(
				(page) => actionValue(page.keys[0]).action,
			),
		).toEqual(["A", "C", "A"]);
	});
	it("includes registered asset bytes when the resource ID and raw configuration stay unchanged", () => {
		const files = archive([
			{ group: 1, page: 1, config: { resourceId: "asset", icon: "asset" } },
		]);
		files.set(
			"app/assets/resources.conf",
			bytes([
				{
					data: [
						{
							id: "resource-0",
							name: "1,1,1",
							path: `${base}/app/assets/config/0.json`,
							resourceType: "DeviceConfig",
						},
						{
							id: "asset",
							name: "icon",
							path: `${base}/app/assets/resource/image.png`,
							resourceType: "Image",
						},
					],
				},
			]),
		);
		files.set(
			"app/assets/resource/image.png",
			Buffer.from([137, 80, 78, 71, 1]),
		);
		const first = mergeBackup(files, empty, "/destination");
		const again = mergeBackup(
			files,
			first.envelope,
			"/destination",
			new Set(first.resources.keys()),
		);
		expect(again.imported).toBe(0);
		files.set(
			"app/assets/resource/image.png",
			Buffer.from([137, 80, 78, 71, 2]),
		);
		const changed = mergeBackup(
			files,
			first.envelope,
			"/destination",
			new Set(first.resources.keys()),
		);
		expect(changed.imported).toBe(2);
		expect(changed.envelope.profiles).toHaveLength(3);
		const configs = changed.envelope.profiles
			.slice(1)
			.map((profile) => actionValue(profile.pages[0]?.keys[0]));
		expect(configs[0]?.resourceId).not.toBe(configs[1]?.resourceId);
		expect(configs[0]?.icon).not.toBe(configs[1]?.icon);
		expect(changed.envelope.profiles[1]).toEqual(first.envelope.profiles[1]);
		expect(
			mergeBackup(
				files,
				changed.envelope,
				"/destination",
				new Set([...first.resources.keys(), ...changed.resources.keys()]),
			).imported,
		).toBe(0);
	});
	it("includes referenced content retained in legacy-only configuration fields", () => {
		const files = archive([{ group: 1, page: 1, config: { marker: "same" } }]);
		const record = key({ marker: "same" });
		files.set(
			"app/assets/config/0.json",
			bytes([
				{
					...record,
					config: {
						...record.config,
						legacyPath: `${base}/app/assets/extra/clip.bin`,
					},
				},
			]),
		);
		files.set("app/assets/extra/clip.bin", Buffer.from("first bytes"));
		const first = mergeBackup(files, empty, "/destination");
		expect(mergeBackup(files, first.envelope, "/destination").imported).toBe(0);
		files.set("app/assets/extra/clip.bin", Buffer.from("changed bytes"));
		const changed = mergeBackup(files, first.envelope, "/destination");
		expect(changed.imported).toBe(1);
		expect(changed.envelope.profiles).toHaveLength(3);
		expect(changed.envelope.profiles[1]).toEqual(first.envelope.profiles[1]);
		expect(mergeBackup(files, changed.envelope, "/destination").imported).toBe(
			0,
		);
	});
	it.each(["file", "folder"])(
		"preserves changed referenced %s bytes without changing raw config or overwriting retained assets",
		async (kind) => {
			const directory = await mkdtemp(join(tmpdir(), "oq-content-identity-"));
			const root = join(directory, "app");
			await mkdir(root);
			await writeFile(join(root, "profiles-v1.json"), bytes(empty));
			const relative = "app/assets/extra/clip.bin";
			const path = kind === "folder" ? "app/assets/extra" : relative;
			const files = archive([
				{ group: 1, page: 1, config: { filePath: `${base}/${path}` } },
			]);
			try {
				const restore = async (content: string) => {
					files.set(relative, Buffer.from(content));
					const plan = await prepareRestore(
						referenceArchive(files, "synthetic"),
						"DK-Suite_synthetic_date.zip",
					);
					await plan.commit(root);
				};
				await restore("first bytes");
				await restore("first bytes");
				const read = async () =>
					mergeBackup(
						files,
						JSON.parse(await readFile(join(root, "profiles-v1.json"), "utf8")),
						root,
					).envelope;
				expect((await read()).profiles).toHaveLength(2);
				await restore("changed bytes");
				const profiles = (await read()).profiles.slice(1);
				expect(profiles).toHaveLength(2);
				expect(new Set(profiles.map((profile) => profile.id)).size).toBe(2);
				const paths = profiles.map(
					(profile) => actionValue(profile.pages[0]?.keys[0]).filePath,
				);
				expect(paths[0]).not.toBe(paths[1]);
				for (const [index, target] of paths.entries()) {
					if (typeof target !== "string")
						throw new Error("Missing synthetic asset path");
					expect(
						await readFile(
							kind === "folder" ? join(target, "clip.bin") : target,
							"utf8",
						),
					).toBe(index === 0 ? "first bytes" : "changed bytes");
				}
				await restore("changed bytes");
				expect((await read()).profiles).toHaveLength(3);
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		},
	);
});
