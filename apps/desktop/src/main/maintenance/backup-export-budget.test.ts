import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { BackupFailed } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import { readBackup, writeBackup } from "./backup-archive";
import { exportBackup } from "./backup-store";

const state = vi.hoisted(() => ({
	limits: {
		archive: 128 * 1024 * 1024,
		entry: 32768,
		total: 65536,
		entries: 100,
	},
	reads: [] as string[],
}));
vi.mock("./backup-archive", async (original) => {
	const archive = await original<typeof import("./backup-archive")>();
	return {
		...archive,
		backupLimits: state.limits,
		writeBackup: vi.fn(archive.writeBackup),
	};
});
vi.mock("node:fs/promises", async (original) => {
	const fs = await original<typeof import("node:fs/promises")>();
	return {
		...fs,
		readFile: vi.fn((...args: Parameters<typeof fs.readFile>) => {
			state.reads.push(String(args[0]));
			return fs.readFile(...args);
		}),
		open: vi.fn(async (...args: Parameters<typeof fs.open>) => {
			const file = await fs.open(...args);
			const read = file.read.bind(file);
			vi.spyOn(file, "read").mockImplementation(
				(...readArgs: Parameters<typeof read>) => {
					state.reads.push(String(args[0]));
					return read(...readArgs);
				},
			);
			return file;
		}),
	};
});
let root: string;
const profileBytes = Buffer.from(
	JSON.stringify(encodeProfileEnvelope(createInitialProfileEnvelope())),
);
beforeEach(async () => {
	state.limits.total = 65536;
	state.limits.entries = 100;
	state.limits.entry = 32768;
	state.reads.length = 0;
	vi.mocked(open).mockReset();
	vi.mocked(writeBackup).mockClear();
	root = await mkdtemp(join(tmpdir(), "export-budget-"));
	await writeFile(join(root, "profiles-v1.json"), profileBytes);
});
afterEach(async () => {
	vi.restoreAllMocks();
	await rm(root, { recursive: true, force: true });
});
for (const tree of [
	"backup-legacy/deep/retained",
	"backup-resources-v1/deep/retained",
	"emoji-v1/assets",
]) {
	for (const budget of ["bytes", "entries"]) {
		it(`stops before the first disallowed ${budget} read in ${tree}`, async () => {
			await mkdir(join(root, tree), { recursive: true });
			const entries = ["12345678", "23456789", "34567890"]
				.map((bytes, index) => ({
					bytes,
					name:
						tree === "emoji-v1/assets"
							? createHash("sha256").update(bytes).digest("hex")
							: `${index}.bin`,
				}))
				.sort((a, b) => a.name.localeCompare(b.name));
			for (const { name, bytes } of entries)
				await writeFile(join(root, tree, name), bytes);
			if (budget === "bytes") state.limits.total = profileBytes.length + 8;
			else state.limits.entries = 2;
			await expect(exportBackup(root)).rejects.toBeInstanceOf(BackupFailed);
			expect(state.reads).toContain(join(root, tree, entries[0]?.name ?? ""));
			expect(state.reads).not.toContain(
				join(root, tree, entries[1]?.name ?? ""),
			);
			expect(state.reads).not.toContain(
				join(root, tree, entries[2]?.name ?? ""),
			);
			expect(writeBackup).not.toHaveBeenCalled();
		});
	}
}
it("charges raw JSON reads before credential removal and normalization shrink them", async () => {
	const padded = Buffer.from(`${profileBytes.toString()}${" ".repeat(1024)}`);
	await writeFile(join(root, "profiles-v1.json"), padded);
	await mkdir(join(root, "backup-legacy"));
	await writeFile(join(root, "backup-legacy/next.bin"), "x");
	state.limits.total = padded.length;
	await expect(exportBackup(root)).rejects.toBeInstanceOf(BackupFailed);
	expect(state.reads).not.toContain(join(root, "backup-legacy/next.bin"));
});
it.each(["bytes", "entries"])(
	"shares the pre-read raw %s budget with external clock assets",
	async (budget) => {
		const image = join(root, "selected.png");
		const later = join(root, "later.mp4");
		await writeFile(image, "image");
		await writeFile(later, "video");
		const clock = Buffer.from(
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
											themes: {
												season: { kind: "image", path: image },
												cyber: { kind: "video", path: later },
											},
										},
									},
								},
							],
						},
					},
				],
			}),
		);
		await mkdir(join(root, "clock-v1"));
		await writeFile(join(root, "clock-v1/clock.json"), clock);
		if (budget === "bytes")
			state.limits.total = profileBytes.length + clock.length;
		else state.limits.entries = 2;
		await expect(exportBackup(root)).rejects.toBeInstanceOf(BackupFailed);
		expect(state.reads).not.toContain(image);
		expect(state.reads).not.toContain(later);
	},
);
for (const budget of ["bytes", "entries"]) {
	it(`includes generated projection/index entries in retained ${budget} limits`, async () => {
		const baseline = await readBackup(
			await exportBackup(root),
			"synthetic.zip",
		);
		const total = [...baseline.values()].reduce(
			(sum, bytes) => sum + bytes.length,
			0,
		);
		if (budget === "bytes") state.limits.total = total - 1;
		else state.limits.entries = baseline.size - 1;
		vi.mocked(writeBackup).mockClear();
		await expect(exportBackup(root)).rejects.toBeInstanceOf(BackupFailed);
		expect(writeBackup).not.toHaveBeenCalled();
	});
}
it("succeeds at exact retained byte and entry boundaries", async () => {
	const baseline = await readBackup(await exportBackup(root), "synthetic.zip");
	state.limits.total = [...baseline.values()].reduce(
		(sum, bytes) => sum + bytes.length,
		0,
	);
	state.limits.entries = baseline.size;
	const actual = await readBackup(await exportBackup(root), "synthetic.zip");
	expect([...actual.keys()]).toEqual([...baseline.keys()]);
	expect(
		[...actual.values()].reduce((sum, bytes) => sum + bytes.length, 0),
	).toBe(state.limits.total);
});
it("bounds a managed file that grows after descriptor inspection and closes it", async () => {
	const real =
		await vi.importActual<typeof import("node:fs/promises")>(
			"node:fs/promises",
		);
	const path = join(root, "backup-legacy/growing.bin");
	await mkdir(join(root, "backup-legacy"));
	await writeFile(path, "x");
	let closed = false;
	let requested = 0;
	vi.mocked(open).mockImplementation(async (...args) => {
		const file = await real.open(...args);
		if (args[0] === path) {
			const read = file.read.bind(file);
			vi.spyOn(file, "read").mockImplementation(
				async (...args: Parameters<typeof read>) => {
					const buffer: unknown = args[0];
					requested = ArrayBuffer.isView(buffer) ? buffer.byteLength : 0;
					await real.writeFile(path, "concurrent growth beyond initial size");
					return read(...args);
				},
			);
			const close = file.close.bind(file);
			vi.spyOn(file, "close").mockImplementation(async () => {
				closed = true;
				await close();
			});
		}
		return file;
	});
	await expect(exportBackup(root)).rejects.toBeInstanceOf(BackupFailed);
	expect(requested).toBe(2);
	expect(closed).toBe(true);
});

it("rejects descriptor growth before allocating or reading the disallowed file", async () => {
	const real =
		await vi.importActual<typeof import("node:fs/promises")>(
			"node:fs/promises",
		);
	const path = join(root, "backup-legacy/growing.bin");
	await mkdir(join(root, "backup-legacy"));
	await writeFile(path, "x");
	let reads = 0;
	let closed = false;
	vi.mocked(open).mockImplementation(async (...args) => {
		if (args[0] === path)
			await real.writeFile(path, Buffer.alloc(state.limits.entry + 1));
		const file = await real.open(...args);
		if (args[0] === path) {
			const read = file.read.bind(file);
			vi.spyOn(file, "read").mockImplementation(
				(...args: Parameters<typeof read>) => {
					reads++;
					return read(...args);
				},
			);
			const close = file.close.bind(file);
			vi.spyOn(file, "close").mockImplementation(async () => {
				closed = true;
				await close();
			});
		}
		return file;
	});
	await expect(exportBackup(root)).rejects.toBeInstanceOf(BackupFailed);
	expect(reads).toBe(0);
	expect(closed).toBe(true);
});

it("charges distinct retained paths once each while deduplicating projected asset content", async () => {
	await mkdir(join(root, "backup-legacy/deep"), { recursive: true });
	for (const name of ["a.bin", "b.bin"])
		await writeFile(join(root, "backup-legacy/deep", name), "same content");
	const baseline = await readBackup(await exportBackup(root), "synthetic.zip");
	expect(
		[...baseline.keys()].filter((name) =>
			name.startsWith("app/assets/resource/"),
		),
	).toHaveLength(1);
	expect(
		[...baseline.keys()].filter((name) =>
			name.startsWith("open-quake/backup-legacy/"),
		),
	).toHaveLength(2);
	state.limits.total = [...baseline.values()].reduce(
		(sum, bytes) => sum + bytes.length,
		0,
	);
	state.limits.entries = baseline.size;
	await expect(exportBackup(root)).resolves.toBeInstanceOf(Uint8Array);
	state.limits.total--;
	await expect(exportBackup(root)).rejects.toBeInstanceOf(BackupFailed);
});
