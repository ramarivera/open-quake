import { createHash } from "node:crypto";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	truncate,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, ManagedRuntime, Option, Schema } from "effect";
import { expect, it } from "vitest";
import { builtinProfiles } from "../../../../../packages/device/src/profiles/profile-catalog.js";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
	Profile,
	ProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../packages/device/src/profiles/profile-repository.js";
import { BackupFailed } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import { defaultClockTile, defaultWallpaper } from "../../shared/display";
import {
	ClockLive,
	ClockStore,
	defaultClockRecord,
} from "../clock/clock-store";
import { clockProfileLayer } from "../profiles/clock-profile-binding";
import { createDesktopProfileStorage } from "../profiles/local-profile-storage";
import { readBackup } from "./backup-archive";
import { exportBackup, prepareRestore } from "./backup-store";

const profiles = () =>
	JSON.stringify(encodeProfileEnvelope(createInitialProfileEnvelope()));

it.each(["deleted-media", "invalid-record", "unused-asset"])(
	"ignores abandoned legacy %s after migration and restores every canonical profile clock",
	async (abandoned) => {
		const scratch = await mkdtemp(join(tmpdir(), "profile-clock-backup-"));
		const source = join(scratch, "source");
		const destination = join(scratch, "destination");
		await Promise.all([source, destination].map((path) => mkdir(path)));
		const image = join(scratch, "profile-image.png");
		await mkdir(join(source, "clock-v1"));
		await writeFile(
			join(source, "clock-v1/clock.json"),
			JSON.stringify({
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
										themeId: "season",
										themes: {
											season: {
												kind: "image",
												path: join(scratch, "deleted-legacy.png"),
											},
										},
									},
								},
							},
						],
					},
				})),
			}),
		);
		await writeFile(image, "profile-clock-image");
		const preset = builtinProfiles("darwin").find((p) =>
			p.pages.some((page) =>
				page.keys.some((k) => k.config.type === "dkDesktopClock"),
			),
		);
		if (!preset) throw new Error("Clock fixture missing");
		const first = Schema.encodeSync(Profile)(preset);
		const second = { ...first, id: "second-clock" };
		const envelope = {
			schemaVersion: 1,
			clockConfigVersion: 1,
			profiles: [first, second],
			activeByDevice: {},
		};
		const owner = (root: string) =>
			ManagedRuntime.make(
				ProfileRepository.Default.pipe(
					Layer.provide(
						profileStorageLayer(
							createDesktopProfileStorage(join(root, "profiles-v1.json")),
						),
					),
				),
			);
		await writeFile(join(source, "profiles-v1.json"), JSON.stringify(envelope));
		await writeFile(join(destination, "profiles-v1.json"), profiles());
		const repository = owner(source);
		const clocks = ManagedRuntime.make(
			ClockLive(source, { duration: () => Effect.succeed(3000) }).pipe(
				Layer.provide(clockProfileLayer(repository)),
			),
		);
		try {
			for (const profile of [first, second]) {
				const target = {
					profileId: profile.id,
					pageId: profile.pages[0].id,
					keyCode: "1,1",
				};
				await clocks.runPromise(ClockStore.stageMedia("season", image, target));
				if (profile.id === first.id)
					await clocks.runPromise(ClockStore.setHourFormat("12h", target));
			}
			if (abandoned === "invalid-record")
				await writeFile(join(source, "clock-v1/clock.json"), "corrupt");
			if (abandoned === "unused-asset") {
				await mkdir(join(source, "clock-v1/assets"));
				await writeFile(join(source, "clock-v1/assets/unused.png"), "unused");
			}
			const archive = await exportBackup(source);
			const entries = await readBackup(archive, "canonical.zip");
			expect(entries.has("open-quake/clock-v1/clock.json")).toBe(false);
			expect(entries.has("open-quake/clock-v1/assets/unused.png")).toBe(false);
			await clocks.dispose();
			await repository.dispose();
			await rm(image);
			await rm(source, { recursive: true });
			const restore = await prepareRestore(archive, "profile-clocks.zip");
			await restore.validate(destination);
			await restore.commit(destination);
			const restoredEnvelope = Schema.decodeUnknownSync(ProfileEnvelope)(
				JSON.parse(
					await readFile(join(destination, "profiles-v1.json"), "utf8"),
				),
			);
			const restoredOwner = owner(destination);
			const restored = ManagedRuntime.make(
				ClockLive(destination, { duration: () => Effect.succeed(3000) }).pipe(
					Layer.provide(clockProfileLayer(restoredOwner)),
				),
			);
			try {
				const formats: string[] = [];
				for (const profile of restoredEnvelope.profiles) {
					const page = profile.pages.find((p) =>
						p.keys.some((k) => k.config.type === "dkDesktopClock"),
					);
					if (!page) continue;
					const target = {
						profileId: profile.id,
						pageId: page.id,
						keyCode: "1,1",
					};
					const snapshot = await restored.runPromise(ClockStore.read(target));
					formats.push(snapshot.hourFormat ?? "missing");
					expect(snapshot.media.season?.available).toBe(true);
					const selected = await restored.runPromise(
						ClockStore.mediaPath({ theme: "season", target }),
					);
					if (Option.isNone(selected))
						throw new Error("Restored media missing");
					expect(
						selected.value.startsWith(`${destination}/clock-v1/assets/`),
					).toBe(true);
					expect(await readFile(selected.value, "utf8")).toBe(
						"profile-clock-image",
					);
				}
				expect(formats.sort()).toEqual(["12h", "24h"]);
			} finally {
				await restored.dispose();
				await restoredOwner.dispose();
			}
		} finally {
			await clocks.dispose();
			await repository.dispose();
			await rm(scratch, { recursive: true, force: true });
		}
	},
);

it("restores selected external image and video through ClockStore after the originals are removed", async () => {
	const scratch = await mkdtemp(join(tmpdir(), "clock-backup-"));
	const source = join(scratch, "source");
	const destination = join(scratch, "different-installation");
	const external = join(scratch, "selected");
	await Promise.all([source, destination, external].map((path) => mkdir(path)));
	const image = join(external, "chosen.png");
	const video = join(external, "chosen.mp4");
	const imageBytes = Buffer.from("synthetic-image");
	const videoBytes = Buffer.from("synthetic-video");
	const runtime = ManagedRuntime.make(
		ClockLive(source, { duration: () => Effect.succeed(3000) }),
	);
	try {
		await writeFile(join(source, "profiles-v1.json"), profiles());
		await writeFile(join(destination, "profiles-v1.json"), profiles());
		await writeFile(image, imageBytes);
		await writeFile(video, videoBytes);
		await writeFile(join(external, "unselected.png"), "must not be collected");
		await runtime.runPromise(ClockStore.stageMedia("season", image));
		const candidate = await runtime.runPromise(
			ClockStore.stageMedia("cyber", video),
		);
		if (candidate._tag !== "candidate")
			throw new Error("Missing video candidate");
		await runtime.runPromise(
			ClockStore.commitMedia(candidate.candidate.token, 3000),
		);
		const archive = await exportBackup(source);
		const entries = await readBackup(archive, "synthetic.zip");
		expect(
			[...entries.keys()].filter((name) =>
				name.startsWith("open-quake/clock-v1/assets/"),
			),
		).toHaveLength(2);
		expect(
			[...entries.values()].some(
				(bytes) => Buffer.from(bytes).toString() === "must not be collected",
			),
		).toBe(false);
		await runtime.dispose();
		await rm(source, { recursive: true });
		await rm(external, { recursive: true });
		const restore = await prepareRestore(archive, "synthetic.zip");
		await restore.validate(destination);
		await restore.commit(destination);
		const restored = ManagedRuntime.make(
			ClockLive(destination, { duration: () => Effect.succeed(3000) }),
		);
		try {
			const snapshot = await restored.runPromise(ClockStore.read());
			expect(snapshot.media.season).toMatchObject({
				kind: "image",
				available: true,
			});
			expect(snapshot.media.cyber).toMatchObject({
				kind: "video",
				available: true,
			});
			for (const [theme, bytes] of [
				["season", imageBytes],
				["cyber", videoBytes],
			] as const) {
				const selected = await restored.runPromise(
					ClockStore.mediaPath({ theme }),
				);
				expect(Option.isSome(selected)).toBe(true);
				if (Option.isNone(selected)) throw new Error("Missing restored path");
				expect(
					selected.value.startsWith(`${destination}/clock-v1/assets/`),
				).toBe(true);
				expect(await readFile(selected.value)).toEqual(bytes);
			}
			const record = await readFile(
				join(destination, "clock-v1/clock.json"),
				"utf8",
			);
			expect(record).not.toContain(external);
		} finally {
			await restored.dispose();
		}
	} finally {
		await runtime.dispose();
		await rm(scratch, { recursive: true, force: true });
	}
});

for (const failure of [
	"missing",
	"unreadable",
	"directory",
	"symlink",
	"parent-symlink",
	"oversized",
	"non-media",
] as const) {
	it(`rejects ${failure} clock references instead of exporting an incomplete backup`, async () => {
		const scratch = await mkdtemp(join(tmpdir(), "clock-backup-invalid-"));
		const root = join(scratch, "root");
		await mkdir(join(root, "clock-v1"), { recursive: true });
		let selected = join(scratch, "chosen.png");
		try {
			await writeFile(join(root, "profiles-v1.json"), profiles());
			if (failure === "directory") await mkdir(selected);
			if (failure === "unreadable") {
				await writeFile(selected, "synthetic");
				await chmod(selected, 0);
			}
			if (failure === "symlink") {
				await writeFile(join(scratch, "target.png"), "synthetic");
				await symlink(join(scratch, "target.png"), selected);
			}
			if (failure === "parent-symlink") {
				await mkdir(join(scratch, "target"));
				await writeFile(join(scratch, "target/chosen.png"), "synthetic");
				await symlink(join(scratch, "target"), join(scratch, "alias"));
				selected = join(scratch, "alias/chosen.png");
			}
			if (failure === "oversized") {
				await writeFile(selected, "");
				await truncate(selected, 32 * 1024 * 1024 + 1);
			}
			if (failure === "non-media") {
				selected = join(scratch, "synthetic.json");
				await writeFile(selected, "{}");
			}
			await writeFile(
				join(root, "clock-v1/clock.json"),
				JSON.stringify({
					version: 1,
					revision: 0,
					keys: [
						{
							keyCode: "1,1",
							config: {
								type: "dkDesktopClock",
								actions: [
									{
										type: "clockStyle",
										value: {
											background: {
												mode: "theme",
												themeId: "season",
												themes: { season: { kind: "image", path: selected } },
											},
										},
									},
								],
							},
						},
					],
				}),
			);
			const error: unknown = await exportBackup(root).catch(
				(cause: unknown) => cause,
			);
			expect(error).toBeInstanceOf(BackupFailed);
			if (!(error instanceof BackupFailed))
				throw new Error("Missing backup failure identity");
			expect(error.code).toBe("QUAKE.BACKUP.FAILED");
			expect(JSON.stringify(error)).not.toContain(scratch);
			if (failure === "unreadable")
				expect(error.originalCause).toMatchObject({ code: "EACCES" });
			if (failure === "missing")
				expect(error.originalCause).toMatchObject({ code: "ENOENT" });
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});
}

it("migrates a pre-migration archive into a marked destination once without changing existing clocks", async () => {
	const scratch = await mkdtemp(join(tmpdir(), "legacy-profile-clock-backup-"));
	const source = join(scratch, "source"),
		destination = join(scratch, "destination");
	await Promise.all([source, destination].map((path) => mkdir(path)));
	const preset = builtinProfiles("darwin").find((p) =>
		p.pages.some((page) =>
			page.keys.some((k) => k.config.type === "dkDesktopClock"),
		),
	);
	if (!preset) throw new Error("Clock fixture missing");
	const profile = Schema.encodeSync(Profile)(preset);
	const existing = { ...profile, id: "existing", revision: 9 };
	const current = {
		schemaVersion: 1,
		clockConfigVersion: 1,
		profiles: [existing],
		activeByDevice: {},
	};
	try {
		await writeFile(
			join(source, "profiles-v1.json"),
			JSON.stringify({
				schemaVersion: 1,
				profiles: [profile],
				activeByDevice: {},
			}),
		);
		await writeFile(
			join(destination, "profiles-v1.json"),
			JSON.stringify(current),
		);
		await mkdir(join(source, "clock-v1"));
		await writeFile(
			join(source, "clock-v1/clock.json"),
			JSON.stringify({
				...defaultClockRecord,
				keys: defaultClockRecord.keys.map((k) => ({
					...k,
					config: {
						...k.config,
						actions: [
							{
								type: "clockStyle",
								value: {
									background: { mode: "theme", themeId: "cyber", themes: {} },
								},
							},
							{ type: "showSeconds", value: true },
						],
					},
				})),
			}),
		);
		await mkdir(join(source, "wallpaper-v1/settings"), { recursive: true });
		await writeFile(
			join(
				source,
				"wallpaper-v1/settings",
				`${createHash("sha256").update("desktop-preview").digest("hex")}.json`,
			),
			JSON.stringify({
				version: 1,
				serial: "desktop-preview",
				revision: 0,
				settings: defaultWallpaper,
				clock: {
					...defaultClockTile,
					actions: [{ type: "hourFormat", value: "12h" }],
				},
			}),
		);
		const archive = await exportBackup(source);
		const restore = await prepareRestore(archive, "legacy-clock.zip");
		await restore.validate(destination);
		await restore.commit(destination);
		const first = JSON.parse(
			await readFile(join(destination, "profiles-v1.json"), "utf8"),
		);
		expect(
			first.profiles.find((p: typeof existing) => p.id === existing.id),
		).toEqual(existing);
		expect(first.profiles).toHaveLength(2);
		const imported = Schema.decodeUnknownSync(ProfileEnvelope)(
			first,
		).profiles.find((p) => p.id !== existing.id);
		const actions = imported?.pages[0].keys[0]?.config.actions;
		expect(actions?.find((a) => a.type === "hourFormat")?.value).toBe("12h");
		expect(actions?.find((a) => a.type === "clockStyle")?.value).toMatchObject({
			background: { themeId: "cyber" },
		});
		expect(actions?.find((a) => a.type === "showSeconds")?.value).toBe(true);
		await restore.validate(destination);
		await restore.commit(destination);
		expect(
			JSON.parse(await readFile(join(destination, "profiles-v1.json"), "utf8")),
		).toEqual(first);
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
});
