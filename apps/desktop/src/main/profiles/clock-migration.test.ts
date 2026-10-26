import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { builtinProfiles } from "../../../../../packages/device/src/profiles/profile-catalog.js";
import {
	encodeProfileEnvelope,
	Profile,
	ProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { defaultClockTile, defaultWallpaper } from "../../shared/display";
import { defaultClockRecord } from "../clock/clock-store";
import {
	loadProfileClockMigration,
	migrateProfileClocks,
} from "./clock-migration";
import {
	createDesktopProfileStorage,
	profileFileSystem,
} from "./local-profile-storage";

const seed = () =>
	encodeProfileEnvelope(
		Schema.decodeUnknownSync(ProfileEnvelope)({
			schemaVersion: 1,
			profiles: builtinProfiles("darwin").map((p) =>
				Schema.encodeSync(Profile)(p),
			),
			activeByDevice: {},
		}),
	);
const clockKey = (envelope: ReturnType<typeof seed>) =>
	envelope.profiles
		.flatMap((p) => p.pages.flatMap((page) => page.keys))
		.find((k) => k.config.type === "dkDesktopClock");
const action = (envelope: ReturnType<typeof seed>, type: string) =>
	clockKey(envelope)?.config.actions?.find((a) => a.type === type)?.value;
const legacy = {
	...defaultClockRecord,
	keys: defaultClockRecord.keys.map((k) => ({
		...k,
		config: {
			...k.config,
			actions: [
				{
					type: "clockStyle",
					value: {
						background: {
							mode: "theme",
							themeId: "cyber",
							themes: { aurora: { kind: "image", path: "/retained.png" } },
						},
						musicEnabled: true,
						customMetadata: "keep",
					},
				},
				{ type: "showSeconds", value: true },
			],
		},
	})),
};
const roots: string[] = [];
async function root() {
	const path = await mkdtemp(join(tmpdir(), "profile-clock-migration-"));
	roots.push(path);
	return path;
}
async function saveLegacy(
	path: string,
	serial = "desktop-preview",
	format: "12h" | "24h" = "12h",
) {
	await mkdir(join(path, "clock-v1"), { recursive: true });
	await writeFile(join(path, "clock-v1/clock.json"), JSON.stringify(legacy));
	await mkdir(join(path, "wallpaper-v1/settings"), { recursive: true });
	const file = join(
		path,
		"wallpaper-v1/settings",
		`${createHash("sha256").update(serial).digest("hex")}.json`,
	);
	await writeFile(
		file,
		JSON.stringify({
			version: 1,
			serial,
			revision: 7,
			settings: defaultWallpaper,
			clock: {
				...defaultClockTile,
				actions: [{ type: "hourFormat", value: format }],
			},
		}),
	);
	return file;
}
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});
describe("profile clock migration", () => {
	it("finds physical-serial-only wallpaper without an existing selection", async () => {
		const path = await root();
		await saveLegacy(path, "physical-serial-only", "12h");
		const value = await loadProfileClockMigration(seed(), path, async () => {});
		expect(action(value, "hourFormat")).toBe("12h");
	});
	it("retains the real built-in seed when the first migration commit is interrupted", async () => {
		const path = await root();
		await saveLegacy(path);
		const profilePath = join(path, "profiles-v1.json");
		let commits = 0;
		const storage = createDesktopProfileStorage(
			profilePath,
			{
				...profileFileSystem,
				rename: async (from, to) => {
					if (to === profilePath && ++commits === 2)
						throw new Error("interrupted");
					await profileFileSystem.rename(from, to);
				},
			},
			seed,
		);
		await expect(storage.read()).rejects.toThrow();
		const interrupted = JSON.parse(await readFile(profilePath, "utf8"));
		expect(interrupted.profiles).toHaveLength(seed().profiles.length);
		expect(interrupted.clockConfigVersion).toBeUndefined();
		const restarted = await createDesktopProfileStorage(
			profilePath,
			undefined,
			seed,
		).read();
		expect(restarted).toMatchObject({ clockConfigVersion: 1 });
		expect(
			action(
				Schema.encodeSync(ProfileEnvelope)(
					Schema.decodeUnknownSync(ProfileEnvelope)(restarted),
				),
				"hourFormat",
			),
		).toBe("12h");
	});
	it("fresh defaults become canonical once", async () => {
		let writes = 0;
		const value = await loadProfileClockMigration(
			seed(),
			await root(),
			async () => {
				writes++;
			},
		);
		expect(value.clockConfigVersion).toBe(1);
		expect(action(value, "hourFormat")).toBe("24h");
		expect(action(value, "showSeconds")).toBe(false);
		expect(writes).toBe(1);
	});
	it("legacy-only settings migrate into built-in defaults and originals remain byte-identical", async () => {
		const path = await root();
		const file = await saveLegacy(path);
		const original = await readFile(file, "utf8");
		const value = await loadProfileClockMigration(seed(), path, async () => {});
		expect(action(value, "hourFormat")).toBe("12h");
		expect(action(value, "showSeconds")).toBe(true);
		expect(action(value, "clockStyle")).toEqual(
			legacy.keys[0]?.config.actions[0]?.value,
		);
		expect(await readFile(file, "utf8")).toBe(original);
		expect(
			JSON.parse(await readFile(join(path, "clock-v1/clock.json"), "utf8")),
		).toEqual(legacy);
	});
	it("partial profiles preserve custom settings, metadata, weather and unrelated profiles", () => {
		const original = seed();
		const selected = clockKey(original);
		if (!selected) throw new Error("fixture clock missing");
		const partial = Schema.encodeSync(ProfileEnvelope)(
			Schema.decodeUnknownSync(ProfileEnvelope)({
				...original,
				profiles: original.profiles.map((p) => ({
					...p,
					pages: p.pages.map((page) => ({
						...page,
						keys: page.keys.map((k) =>
							k !== selected
								? k
								: {
										...k,
										config: {
											...k.config,
											actions: [
												{ type: "hourFormat", value: "12h" },
												{
													type: "weather",
													value: { enabled: false, custom: "untouched" },
												},
											],
										},
									},
						),
					})),
				})),
			}),
		);
		const value = migrateProfileClocks(partial, {
			clock: legacy,
			formats: new Map([["desktop-preview", "24h"]]),
		});
		expect(action(value, "hourFormat")).toBe("12h");
		expect(action(value, "weather")).toEqual({
			enabled: false,
			custom: "untouched",
		});
		expect(action(value, "clockStyle")).toEqual(
			legacy.keys[0]?.config.actions[0]?.value,
		);
		const unrelated = (envelope: ReturnType<typeof seed>) =>
			envelope.profiles.filter(
				(p) =>
					!p.pages.some((page) =>
						page.keys.some((k) => k.config.type === "dkDesktopClock"),
					),
			);
		expect(unrelated(value)).toEqual(unrelated(partial));
	});
	it("serial conflicts resolve lexically before desktop-preview", () => {
		const original = seed();
		const p = original.profiles.find((p) =>
			p.pages.some((page) =>
				page.keys.some((k) => k.config.type === "dkDesktopClock"),
			),
		);
		if (!p) throw new Error("fixture");
		const value = migrateProfileClocks(
			{
				...original,
				activeByDevice: {
					z: { profileId: p.id, pageId: p.pages[0].id },
					a: { profileId: p.id, pageId: p.pages[0].id },
				},
			},
			{
				clock: undefined,
				formats: new Map([
					["z", "24h"],
					["a", "12h"],
					["desktop-preview", "24h"],
				]),
			},
		);
		expect(action(value, "hourFormat")).toBe("12h");
	});
	it("a failed write is retryable without changing originals or publishing a marker", async () => {
		const path = await root();
		const file = await saveLegacy(path);
		const original = await readFile(file, "utf8");
		const input = seed();
		await expect(
			loadProfileClockMigration(input, path, async () => {
				throw new Error("write failed");
			}),
		).rejects.toThrow("write failed");
		expect(input.clockConfigVersion).toBeUndefined();
		expect(await readFile(file, "utf8")).toBe(original);
		const value = await loadProfileClockMigration(input, path, async () => {});
		expect(value.clockConfigVersion).toBe(1);
		expect(action(value, "hourFormat")).toBe("12h");
	});
	it("repeat does not read corrupted legacy or overwrite canonical values", async () => {
		const path = await root();
		await saveLegacy(path);
		const first = await loadProfileClockMigration(seed(), path, async () => {});
		await writeFile(join(path, "clock-v1/clock.json"), "invalid");
		let writes = 0;
		const second = await loadProfileClockMigration(first, path, async () => {
			writes++;
		});
		expect(second).toEqual(first);
		expect(writes).toBe(0);
		expect(
			migrateProfileClocks(first, { clock: undefined, formats: new Map() }),
		).toBe(first);
	});
	it("invalid legacy is retained and cannot commit a completion marker", async () => {
		const path = await root();
		await mkdir(join(path, "clock-v1"));
		await writeFile(join(path, "clock-v1/clock.json"), "invalid");
		let writes = 0;
		await expect(
			loadProfileClockMigration(seed(), path, async () => {
				writes++;
			}),
		).rejects.toThrow();
		expect(writes).toBe(0);
		expect(await readFile(join(path, "clock-v1/clock.json"), "utf8")).toBe(
			"invalid",
		);
	});
});
