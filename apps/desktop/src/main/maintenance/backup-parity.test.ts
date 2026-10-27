import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { expect, it } from "vitest";
import { AppLibrarySnapshot } from "../../../../../packages/device/src/profiles/app-library.js";
import {
	createEmptyProfileKey,
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { appLibraryStore } from "../key-library/app-library-store";
import { encodeAccountConfig } from "./account-config";
import { readBackup, writeBackup } from "./backup-archive";
import { exportBackup, prepareRestore } from "./backup-store";

const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
const initial = encodeProfileEnvelope(createInitialProfileEnvelope());
const key = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
const base = "/legacy/resources";
const kinds = ["Icon", "AlertTone", "GIF", "PluginIcon", "Wallpaper", "Emoji"];
function legacy() {
	const rows = kinds.map((resourceType, i) => ({
		id: `r${i}`,
		name: `Named ${resourceType}`,
		resourceType,
		path: `${base}/assets/${i}`,
		category: "user",
		customField: { retained: true },
	}));
	const icon = rows[0];
	if (!icon) throw new Error("missing icon fixture");
	rows.push({ ...icon, id: "icon-alias", name: "Same bytes, another name" });
	const files = new Map<string, Uint8Array>([
		["default_config.json", encodeAccountConfig({}, "default")],
		[
			"export_index.json",
			bytes({ originalBasePath: base, originalPlatform: "linux" }),
		],
		[
			"app/assets/resources.conf",
			bytes([
				{
					data: [
						...rows,
						{
							id: "profile",
							name: "1,1,1",
							resourceType: "DeviceConfig",
							customField: { retained: true },
							path: `${base}/profile.json`,
						},
					],
				},
			]),
		],
		[
			"profile.json",
			bytes([
				{
					...key,
					childrenName: "obsStream",
					config: {
						...key.config,
						type: "obsStream",
						actions: [],
						references: rows.map((r) => ({ resourceId: r.id, file: r.path })),
					},
				},
			]),
		],
	]);
	rows.slice(0, kinds.length).forEach((row, i) => {
		files.set(`assets/${i}`, Buffer.from(`content-${row.resourceType}`));
	});
	return files;
}
it("MGMT-400/429 restores every resource taxonomy, references and OBS library identity through a native second round trip", async () => {
	const root = await mkdtemp(join(tmpdir(), "profiles-resources-"));
	const source = join(root, "source"),
		target = join(root, "target");
	try {
		for (const directory of [source, target]) {
			await mkdir(directory);
			await writeFile(join(directory, "profiles-v1.json"), bytes(initial));
		}
		const imported = await prepareRestore(
			await writeBackup(legacy(), "default"),
			"DK-Suite_default_test.zip",
		);
		await imported.validate(source);
		await imported.commit(source);
		const saved = JSON.parse(
			await readFile(join(source, "profiles-v1.json"), "utf8"),
		);
		expect(JSON.stringify(saved)).not.toContain(base);
		for (const kind of kinds)
			expect(
				await readFile(
					join(
						source,
						"backup-resources-v1",
						(await import("./firmware-files")).hashBytes(
							Buffer.from(`content-${kind}`),
						),
					),
					"utf8",
				),
			).toBe(`content-${kind}`);
		const library = await Effect.runPromise(
			appLibraryStore(join(source, "app-library-v1.json")).read(),
		);
		expect(
			library.groups.find((g) => g.subMenu === "obsStudio")?.children[0]?.config
				.type,
		).toBe("obsStream");
		const native = await exportBackup(source);
		const second = await prepareRestore(native, "DK-Suite_default_test.zip");
		await second.validate(target);
		await second.commit(target);
		const files = await readBackup(
			await exportBackup(target),
			"DK-Suite_default_test.zip",
			"default",
		);
		const catalog = JSON.parse(
			Buffer.from(files.get("app/assets/resources.conf") ?? []).toString(),
		);
		const rows = Schema.decodeUnknownSync(
			Schema.Array(
				Schema.Struct({
					data: Schema.Array(
						Schema.Struct({
							resourceType: Schema.String,
							name: Schema.String,
							customField: Schema.optional(
								Schema.Struct({ retained: Schema.Boolean }),
							),
						}),
					),
				}),
			),
		)(catalog).flatMap((g) => g.data);
		expect(rows.some((r) => r.name === "Same bytes, another name")).toBe(true);
		expect(new Set(rows.map((r) => r.resourceType))).toEqual(
			new Set([...kinds, "DeviceConfig"]),
		);
		expect(
			rows.find((r) => r.resourceType === "DeviceConfig" && r.customField),
		).toMatchObject({ customField: { retained: true } });
		for (const kind of kinds)
			expect(rows.find((r) => r.resourceType === kind)).toMatchObject({
				name: `Named ${kind}`,
				customField: { retained: true },
			});
		const restoredLibrary = Schema.decodeUnknownSync(AppLibrarySnapshot)(
			JSON.parse(await readFile(join(target, "app-library-v1.json"), "utf8")),
		);
		expect(
			restoredLibrary.groups.find((g) => g.subMenu === "obsStudio")?.children,
		).toHaveLength(1);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
it("MGMT-429 merges saved app groups without dropping local keys or duplicating imported OBS keys", async () => {
	const root = await mkdtemp(join(tmpdir(), "profiles-library-"));
	try {
		await writeFile(join(root, "profiles-v1.json"), bytes(initial));
		const existing = {
			...key,
			config: {
				...key.config,
				title: { ...key.config.title, text: "Keep me" },
			},
		};
		await writeFile(
			join(root, "app-library-v1.json"),
			bytes({
				version: 1,
				revision: 4,
				groups: [{ subMenu: "Custom", children: [existing] }],
			}),
		);
		const files = new Map<string, Uint8Array>([
			["default_config.json", encodeAccountConfig({}, "default")],
			[
				"export_index.json",
				bytes({ originalBasePath: base, originalPlatform: "linux" }),
			],
			["open-quake/profiles-v1.json", bytes(initial)],
			[
				"open-quake/app-library-v1.json",
				bytes({
					version: 1,
					revision: 9,
					groups: [
						{
							subMenu: "Custom",
							children: [existing, { ...existing, keyCode: "1,2" }],
						},
					],
				}),
			],
		]);
		const plan = await prepareRestore(
			await writeBackup(files, "default"),
			"DK-Suite_default_test.zip",
		);
		await plan.validate(root);
		await plan.commit(root);
		await plan.commit(root);
		const library = await Effect.runPromise(
			appLibraryStore(join(root, "app-library-v1.json")).read(),
		);
		expect(
			library.groups.find((g) => g.subMenu === "Custom")?.children,
		).toHaveLength(2);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
it.each(["native", "legacy"])(
	"MGMT-322 rejects over-capacity %s import before any profile, resource or library mutation",
	async (format) => {
		const root = await mkdtemp(join(tmpdir(), "profiles-capacity-"));
		const current = {
			...initial,
			profiles: Array.from({ length: 30 }, (_, i) => ({
				...initial.profiles[0],
				id: `p${i}`,
				name: `P${i}`,
				pages: [
					{
						id: "page",
						keys: [
							{
								...key,
								config: {
									...key.config,
									title: { ...key.config.title, text: `unique-${i}` },
								},
							},
						],
					},
				],
			})),
		};
		try {
			await writeFile(join(root, "profiles-v1.json"), bytes(current));
			await writeFile(
				join(root, "app-library-v1.json"),
				bytes({ version: 1, revision: 0, groups: [] }),
			);
			const before = await readFile(join(root, "profiles-v1.json"));
			const files =
				format === "legacy"
					? legacy()
					: new Map<string, Uint8Array>([
							["default_config.json", encodeAccountConfig({}, "default")],
							[
								"export_index.json",
								bytes({ originalBasePath: base, originalPlatform: "linux" }),
							],
							["open-quake/profiles-v1.json", bytes(initial)],
						]);
			const plan = await prepareRestore(
				await writeBackup(files, "default"),
				"DK-Suite_default_test.zip",
			);
			await expect(plan.validate(root)).rejects.toMatchObject({
				_tag: "BackupInvalid",
			});
			await expect(plan.commit(root)).rejects.toMatchObject({
				_tag: "BackupInvalid",
			});
			expect(await readFile(join(root, "profiles-v1.json"))).toEqual(before);
			expect((await readdir(root)).sort()).toEqual([
				"app-library-v1.json",
				"profiles-v1.json",
			]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
);
