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
import { Effect, ManagedRuntime, Option } from "effect";
import { expect, it } from "vitest";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ClockLive, ClockStore } from "../clock/clock-store";
import { readBackup } from "./backup-archive";
import { exportBackup, prepareRestore } from "./backup-store";

const profiles = () =>
	JSON.stringify(encodeProfileEnvelope(createInitialProfileEnvelope()));

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
			await expect(exportBackup(root)).rejects.toMatchObject({
				code: "QUAKE.BACKUP.FAILED",
			});
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});
}
