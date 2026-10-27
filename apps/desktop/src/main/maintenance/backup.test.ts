import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { defaultHardwarePreferences } from "../../../../../packages/device/src/hardware/hardware-contracts.js";
import discord from "../../../../../packages/device/src/profiles/builtins/default_discord_config.json";
import { builtinProfiles } from "../../../../../packages/device/src/profiles/profile-catalog.js";
import {
	createEmptyProfileKey,
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
	Profile,
	ProfileEnvelope,
	ProfileJsonObject,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { decodeAccountConfig, encodeAccountConfig } from "./account-config";
import { referenceArchive, referenceDecode } from "./archive-fixtures";
import {
	backupAccount,
	readBackup,
	safeArchivePath,
	writeBackup,
} from "./backup-archive";
import { backupProjection, mergeBackup } from "./backup-merge";
import { clearOwnedData, exportBackup, prepareRestore } from "./backup-store";

const bytes = (v: unknown) => Buffer.from(JSON.stringify(v));
// Archive/path/settings tests need one small native profile. Catalog payloads
// are exercised separately below without exporting nine presets per archive.
const envelope = () => {
	const initial = createInitialProfileEnvelope();
	return encodeProfileEnvelope({
		...initial,
		profiles: [{ ...initial.profiles[0], id: "1-0", name: "Discord" }],
	});
};
function legacy() {
	const key = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
	const files = new Map<string, Uint8Array>([
		[
			"export_index.json",
			bytes({
				originalBasePath: "C:\\Users\\legacy\\resources\\old",
				originalPlatform: "win32",
			}),
		],
		["old_config.json", bytes({ config: {} })],
		[
			"app/assets/resources.conf",
			bytes([
				{
					data: [
						{
							id: "one",
							name: "9,1,1",
							path: "C:\\Users\\legacy\\resources\\old\\app\\assets\\config\\one.json",
							resourceType: "DeviceConfig",
						},
						{
							id: "icon",
							name: "icon",
							path: "C:\\Users\\legacy\\resources\\old\\app\\assets\\resource\\image.png",
							resourceType: "Image",
						},
						{
							id: "builtin",
							name: "builtin",
							path: "@/builtin.png",
							resourceType: "Image",
						},
						{
							id: "deleted",
							name: "deleted",
							path: "missing",
							resourceType: "Image",
							isDelete: true,
						},
					],
				},
			]),
		],
		["app/assets/config/one.json", bytes([key])],
		["app/assets/resource/image.png", Buffer.from([137, 80, 78, 71, 1])],
	]);
	return files;
}
describe("authenticated backup compatibility", () => {
	it("reimports a native profile after editing its first import without reusing its ID", () => {
		const initial = envelope();
		const original = initial.profiles[0];
		if (!original) throw new Error("Missing fixture profile");
		const files = legacy();
		files.set(
			"open-quake/profiles-v1.json",
			bytes({
				...initial,
				profiles: [
					{
						...original,
						id: "custom",
						knob: { keyCode: "0,1", config: { marker: "original" } },
					},
				],
			}),
		);
		const first = mergeBackup(files, initial, "/destination");
		const edited = {
			...first.envelope,
			profiles: first.envelope.profiles.map((p) =>
				p.id.startsWith("import-")
					? { ...p, knob: { keyCode: "0,1", config: { marker: "edited" } } }
					: p,
			),
		};
		const second = mergeBackup(files, edited, "/destination");
		expect(second.imported).toBe(1);
		expect(new Set(second.envelope.profiles.map((p) => p.id)).size).toBe(
			second.envelope.profiles.length,
		);
		expect(second.envelope.profiles).toContainEqual(
			expect.objectContaining({
				knob: { keyCode: "0,1", config: { marker: "edited" } },
			}),
		);
	});
	it("deduplicates equal configurations with distinct resource ids in one archive", () => {
		const files = legacy();
		files.set(
			"app/assets/resources.conf",
			bytes([
				{
					data: ["one", "alias"].map((id, i) => ({
						id,
						name: `${20 + i},1,1`,
						path: "C:\\Users\\legacy\\resources\\old\\app\\assets\\config\\one.json",
						resourceType: "DeviceConfig",
					})),
				},
			]),
		);
		const result = mergeBackup(files, envelope(), "/new/userData");
		expect(result.envelope.profiles).toHaveLength(2);
		expect(result.imported).toBe(1);
		expect(result.skipped).toBe(1);
	});
	it("skips an unchanged recovered default, including its knob and source-only fields", () => {
		const files = legacy();
		files.set(
			"app/assets/resources.conf",
			bytes([
				{
					data: [
						{
							id: "1-0",
							name: "1,1,1",
							path: "C:\\Users\\legacy\\resources\\old\\app\\assets\\config\\one.json",
							resourceType: "DeviceConfig",
						},
					],
				},
			]),
		);
		files.set("app/assets/config/one.json", bytes(discord));
		const result = mergeBackup(files, envelope(), "/new/userData");
		expect(result.imported).toBe(0);
		expect(result.skipped).toBe(1);
		expect(result.envelope.profiles).toHaveLength(1);
	});
	it("projects knob data and encrypted profile titles into the DK format", () => {
		const initial = createInitialProfileEnvelope();
		const profiles = builtinProfiles("darwin").filter(
			(p) => p.id === "1-0" || p.id === "1-8",
		);
		const [first, ...rest] = profiles;
		if (!first) throw new Error("Missing catalog fixture");
		const projected = backupProjection(
			encodeProfileEnvelope({ ...initial, profiles: [first, ...rest] }),
			"/source",
			"darwin",
		);
		const config = decodeAccountConfig(
			projected.get("default_config.json") ?? new Uint8Array(),
			"default",
		);
		expect(config).toMatchObject({
			quakeConfig: {
				deviceMenuProfile: expect.arrayContaining([
					{ resourceId: "1-0", title: "Discord" },
				]),
			},
		});
		expect(
			JSON.parse(
				Buffer.from(
					projected.get("app/assets/config/1-8.json") ?? [],
				).toString(),
			),
		).toContainEqual(expect.objectContaining({ keyCode: "0,1" }));
	});
	it("materializes archived legacy paths, remaps references without changing numeric layout values", async () => {
		const files = legacy();
		const base = "C:\\Users\\legacy\\resources\\old";
		files.set(
			"old_config.json",
			encodeAccountConfig(
				{
					quakeConfig: {
						deviceMenuProfile: [
							{ resourceId: "one", title: "My restored profile" },
						],
					},
				},
				"old",
			),
		);
		files.set(
			"app/assets/config/one.json",
			bytes([
				{
					keyCode: "1,1",
					childrenName: "fixture",
					config: {
						type: "fixture",
						title: {
							text: "",
							pos: "bot",
							size: 8,
							color: "#FFFFFF",
							display: true,
							style: "",
							resourceId: 0,
						},
						size: [1, 1],
						display: true,
						icon: "icon",
						actions: [
							{ type: "file", value: `${base}\\app\\assets\\extra\\clip.bin` },
						],
					},
				},
			]),
		);
		files.set("app/assets/extra/clip.bin", Buffer.from("fixture bytes"));
		const directory = await mkdtemp(join(tmpdir(), "oq-legacy-paths-"));
		const root = join(directory, "userData");
		await mkdir(root);
		await writeFile(join(root, "profiles-v1.json"), bytes(envelope()));
		try {
			const plan = await prepareRestore(
				referenceArchive(files, "old"),
				"DK-Suite_old_date.zip",
			);
			await plan.commit(root);
			const restored = Schema.decodeUnknownSync(ProfileEnvelope)(
				JSON.parse(await readFile(join(root, "profiles-v1.json"), "utf8")),
			);
			const imported = restored.profiles.find(
				(p) => p.name === "My restored profile",
			);
			expect(imported?.pages[0]?.keys[0]?.config.size).toEqual([1, 1]);
			expect(imported?.pages[0]?.keys[0]?.config.icon).toMatch(
				/^data:image\/png;base64,/,
			);
			const path = imported?.pages[0]?.keys[0]?.config.actions[0]?.value;
			expect(path).toMatch(
				new RegExp(
					`${root}/backup-legacy/[a-f0-9]{64}/app/assets/extra/clip.bin$`,
				),
			);
			if (typeof path !== "string")
				throw new Error("Missing restored asset path");
			expect(await readFile(path, "utf8")).toBe("fixture bytes");
			files.set(
				"app/assets/extra/clip.bin",
				Buffer.from("second backup bytes"),
			);
			const changed = Schema.decodeUnknownSync(Schema.Array(ProfileJsonObject))(
				JSON.parse(
					Buffer.from(files.get("app/assets/config/one.json") ?? []).toString(
						"utf8",
					),
				),
			);
			files.set(
				"app/assets/config/one.json",
				bytes(
					changed.map((key) => ({
						...key,
						config: {
							...Schema.decodeUnknownSync(ProfileJsonObject)(key.config),
							name: "Second profile",
						},
					})),
				),
			);
			const next = await prepareRestore(
				referenceArchive(files, "old"),
				"DK-Suite_old_date.zip",
			);
			await next.commit(root);
			expect(await readFile(path, "utf8")).toBe("fixture bytes");
			const after: unknown = JSON.parse(
				await readFile(join(root, "profiles-v1.json"), "utf8"),
			);
			expect(
				Schema.decodeUnknownSync(ProfileEnvelope)(after).profiles,
			).toHaveLength(restored.profiles.length + 1);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	it("rebases native resource references to a different app root and rejects symlink destinations", async () => {
		const directory = await mkdtemp(join(tmpdir(), "oq-native-paths-"));
		const source = join(directory, "source");
		const target = join(directory, "target");
		const outside = join(directory, "outside");
		for (const root of [source, target, outside]) await mkdir(root);
		const initial = envelope();
		const first = initial.profiles[0];
		expect(first).toBeDefined();
		await mkdir(join(source, "backup-resources-v1"));
		await writeFile(
			join(source, "backup-resources-v1", "asset"),
			"asset bytes",
		);
		await writeFile(
			join(source, "profiles-v1.json"),
			bytes({
				...initial,
				profiles: initial.profiles.map((p, i) =>
					i === 0
						? {
								...p,
								knob: {
									keyCode: "0,1",
									config: {
										assetPath: join(source, "backup-resources-v1", "asset"),
									},
								},
							}
						: p,
				),
			}),
		);
		await writeFile(join(target, "profiles-v1.json"), bytes(initial));
		try {
			const archive = await exportBackup(source);
			const projected = referenceDecode(archive);
			const projectedKeys = JSON.parse(
				Buffer.from(
					projected.get("app/assets/config/1-0.json") ?? [],
				).toString(),
			);
			expect(projectedKeys).toContainEqual(
				expect.objectContaining({
					keyCode: "0,1",
					config: expect.objectContaining({
						assetPath: expect.stringContaining("/app/assets/resource/"),
					}),
				}),
			);
			expect(
				[...projected.keys()].some((name) =>
					name.startsWith("app/assets/resource/"),
				),
			).toBe(true);
			const plan = await prepareRestore(archive, "DK-Suite_default_date.zip");
			await symlink(outside, join(target, "backup-resources-v1"));
			await expect(plan.commit(target)).rejects.toMatchObject({
				code: "QUAKE.BACKUP.INVALID",
			});
			await expect(readFile(join(outside, "asset"))).rejects.toMatchObject({
				code: "ENOENT",
			});
			await rm(join(target, "backup-resources-v1"));
			await plan.commit(target);
			const restored = Schema.decodeUnknownSync(ProfileEnvelope)(
				JSON.parse(await readFile(join(target, "profiles-v1.json"), "utf8")),
			);
			expect(
				restored.profiles.some(
					(p) =>
						Schema.encodeSync(Profile)(p).knob?.config.assetPath ===
						join(target, "backup-resources-v1", "asset"),
				),
			).toBe(true);
			expect(
				await readFile(join(target, "backup-resources-v1", "asset"), "utf8"),
			).toBe("asset bytes");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	it("imports independently encoded WinZip AES-256 archive", async () => {
		const files = legacy();
		const decoded = await readBackup(
			referenceArchive(files, "old"),
			"DK-Suite_old_date_export_resources.zip",
		);
		expect(decoded).toEqual(files);
		const result = mergeBackup(decoded, envelope(), "/new/userData");
		expect(result.imported).toBe(2);
		expect(result.skipped).toBe(2);
		expect(result.envelope.profiles).toHaveLength(2);
		const again = mergeBackup(decoded, result.envelope, "/new/userData");
		expect(again.envelope.profiles).toHaveLength(2);
	});
	it("export decrypts through an independent crypto/zip decoder", async () => {
		const files = legacy();
		const zip = await writeBackup(files, "old");
		expect(referenceDecode(zip, "old")).toEqual(files);
	});
	it("rejects wrong account, tampered ciphertext and invalid index before mutation", async () => {
		const zip = referenceArchive(legacy(), "old");
		await expect(
			readBackup(zip, "DK-Suite_other_date.zip"),
		).rejects.toMatchObject({ code: "QUAKE.BACKUP.INVALID" });
		const tampered = Uint8Array.from(zip);
		tampered[100] = (tampered[100] ?? 0) ^ 1;
		await expect(
			readBackup(tampered, "DK-Suite_old_date.zip"),
		).rejects.toMatchObject({ code: "QUAKE.BACKUP.INVALID" });
		const invalid = legacy();
		invalid.set("export_index.json", bytes({ originalBasePath: 9 }));
		await expect(
			readBackup(referenceArchive(invalid, "old"), "DK-Suite_old_date.zip"),
		).rejects.toMatchObject({ code: "QUAKE.BACKUP.INVALID" });
	});
	it.each([
		"../outside",
		"/absolute",
		"C:/outside",
		"a\\..\\outside",
		"a/../outside",
		"a//b",
		"./relative",
		"open-quake/appearance.json:stream",
		"open-quake/NUL.json",
		"open-quake/appearance.json.",
	])("rejects unsafe entry %s", async (name) => {
		expect(() => safeArchivePath(name)).toThrow();
		const files = legacy();
		files.set(name, Buffer.from("bad"));
		await expect(
			readBackup(referenceArchive(files, "old"), "DK-Suite_old_date.zip"),
		).rejects.toMatchObject({ code: "QUAKE.BACKUP.INVALID" });
	});
	it("rejects case-insensitive duplicates", async () => {
		const files = legacy();
		files.set("EXPORT_INDEX.JSON", bytes({}));
		await expect(
			readBackup(referenceArchive(files, "old"), "DK-Suite_old_date.zip"),
		).rejects.toMatchObject({ code: "QUAKE.BACKUP.INVALID" });
	});
	it("derives account using vendor filename convention", () => {
		expect(backupAccount("DK-Suite_old_date_export_resources.zip")).toBe("old");
		expect(backupAccount("renamed.zip", "current")).toBe("current");
	});
	it("round-trips native settings, keeps credentials out, and preserves unrelated app data", async () => {
		const directory = await mkdtemp(join(tmpdir(), "oq-backup-"));
		const root = join(directory, "userData");
		await mkdir(root);
		await writeFile(join(root, "profiles-v1.json"), JSON.stringify(envelope()));
		await writeFile(join(root, "unrelated"), "retain");
		const monitor = {
			revision: 3,
			settings: {
				styleId: "glass",
				background: "custom",
				media: {
					glass: { id: "a".repeat(32), kind: "image", name: "fixture" },
				},
				temperatureUnit: "fahrenheit",
				enabled: true,
				hz: 2,
			},
		};
		await mkdir(join(root, "monitor-v1", "assets"), { recursive: true });
		await writeFile(join(root, "monitor-v1", "settings.json"), bytes(monitor));
		await writeFile(
			join(root, "monitor-v1", "settings.json.new"),
			"incomplete",
		);
		await writeFile(
			join(root, "monitor-v1", "assets", "a".repeat(32)),
			"fixture pixels",
		);
		await writeFile(
			join(root, "monitor-v1", "assets", `${"a".repeat(32)}.mime`),
			"image/png",
		);
		await mkdir(join(root, "hardware-v1"));
		await writeFile(
			join(root, "hardware-v1", "settings.json"),
			JSON.stringify({
				version: 1,
				serial: "fixture",
				preferences: defaultHardwarePreferences,
				apiKey: "do-not-export",
			}),
		);
		try {
			const archive = await exportBackup(root);
			const decoded = referenceDecode(archive);
			expect(decoded.has("open-quake/monitor-v1/settings.json.new")).toBe(
				false,
			);
			expect(
				JSON.parse(
					Buffer.from(
						decoded.get("open-quake/hardware-v1/settings.json") ?? [],
					).toString(),
				),
			).toEqual({
				version: 1,
				serial: "fixture",
				preferences: defaultHardwarePreferences,
			});
			await writeFile(
				join(root, "hardware-v1", "settings.json"),
				'{"volume":0}',
			);
			const plan = await prepareRestore(archive, "DK-Suite_default_date.zip");
			await rm(join(root, "monitor-v1"), { recursive: true });
			await plan.commit(root);
			expect(
				JSON.parse(
					await readFile(join(root, "monitor-v1", "settings.json"), "utf8"),
				),
			).toEqual(monitor);
			expect(
				await readFile(
					join(root, "monitor-v1", "assets", "a".repeat(32)),
					"utf8",
				),
			).toBe("fixture pixels");
			expect(
				await readFile(
					join(root, "monitor-v1", "assets", `${"a".repeat(32)}.mime`),
					"utf8",
				),
			).toBe("image/png");
			expect(
				JSON.parse(
					await readFile(join(root, "hardware-v1", "settings.json"), "utf8"),
				),
			).toEqual({
				version: 1,
				serial: "fixture",
				preferences: defaultHardwarePreferences,
			});
			expect(await readFile(join(root, "unrelated"), "utf8")).toBe("retain");
			await symlink(join(directory, "outside"), join(root, "clock-v1"));
			await expect(exportBackup(root)).rejects.toMatchObject({
				code: "QUAKE.BACKUP.INVALID",
			});
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	it("rejects malformed native monitor settings before restore can mutate data", async () => {
		const files = legacy();
		files.set(
			"open-quake/monitor-v1/settings.json",
			bytes({ revision: 0, settings: { hz: 100 } }),
		);
		await expect(
			prepareRestore(referenceArchive(files, "old"), "DK-Suite_old_date.zip"),
		).rejects.toBeDefined();
	});
	it("clear removes only its captured app root", async () => {
		const directory = await mkdtemp(join(tmpdir(), "oq-clear-"));
		const root = join(directory, "app");
		await mkdir(root);
		await writeFile(join(root, "data"), "erase");
		await writeFile(join(directory, "sibling"), "keep");
		try {
			await clearOwnedData(root);
			await expect(readFile(join(root, "data"))).rejects.toMatchObject({
				code: "ENOENT",
			});
			expect(await readFile(join(directory, "sibling"), "utf8")).toBe("keep");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
