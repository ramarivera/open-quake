import { constants } from "node:fs";
import {
	lstat,
	mkdir,
	mkdtemp,
	open,
	readFile,
	realpath,
	rename,
	rm,
	symlink,
	truncate,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { syntheticUf2 } from "../../../../../packages/protocol/src/uf2-fixtures.js";
import { firmwareFiles, hashBytes } from "./firmware-files";

vi.mock("node:fs/promises", async (original) => {
	const fs = await original<typeof import("node:fs/promises")>();
	return { ...fs, open: vi.fn(fs.open) };
});
afterEach(() => vi.restoreAllMocks());
const payload = syntheticUf2();
const descriptor = {
	board: "QUAKE" as const,
	sha256: hashBytes(payload),
	version: "1.0.21",
	start: 0x12000,
	end: 0x121ff,
};
const fs = () =>
	vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const scratch = async () =>
	realpath(await mkdtemp(join(tmpdir(), "firmware-races-")));

it("refuses a source swapped to a symlink at open and preserves the last selected image", async () => {
	const real = await fs();
	const root = await scratch();
	const path = join(root, "image.uf2");
	const other = join(root, "other.uf2");
	await writeFile(path, payload);
	await writeFile(other, payload);
	const files = firmwareFiles([], [descriptor]);
	try {
		await Effect.runPromise(files.inspect(path));
		vi.mocked(open).mockImplementationOnce(async (...args) => {
			await rm(path);
			await symlink(other, path);
			return real.open(...args);
		});
		const result = await Effect.runPromise(
			files.inspect(path).pipe(Effect.either),
		);
		expect(result._tag === "Left" && result.left.code).toBe(
			"QUAKE.FIRMWARE.IMAGE_INVALID",
		);
		expect((await Effect.runPromise(files.selected())).trusted).toBe(true);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("bounds reads even when a source grows after fstat, closes on rejection, and never uses handle.readFile", async () => {
	const real = await fs();
	const root = await scratch();
	const path = join(root, "growing.uf2");
	await writeFile(path, payload);
	let close = vi.fn();
	let requested = 0;
	let calls = 0;
	vi.mocked(open).mockImplementationOnce(async (...args) => {
		const handle = await real.open(...args);
		expect(Number(args[1]) & constants.O_NOFOLLOW).toBeTruthy();
		const stat = handle.stat.bind(handle);
		vi.spyOn(handle, "stat").mockImplementationOnce(async () => {
			const metadata = await stat();
			await truncate(path, 32 * 1024 * 1024);
			return metadata;
		});
		const read = handle.read.bind(handle);
		vi.spyOn(handle, "read").mockImplementation(async (options) => {
			calls++;
			requested += options?.length ?? 0;
			return read(options);
		});
		vi.spyOn(handle, "readFile").mockRejectedValue(
			new Error("unbounded read forbidden"),
		);
		close = vi.spyOn(handle, "close");
		return handle;
	});
	try {
		const result = await Effect.runPromise(
			firmwareFiles([]).inspect(path).pipe(Effect.either),
		);
		expect(result._tag === "Left" && result.left.code).toBe(
			"QUAKE.FIRMWARE.IMAGE_INVALID",
		);
		expect(calls).toBeGreaterThan(0);
		expect(requested).toBeLessThanOrEqual(16 * 1024 * 1024 + 1);
		expect(close).toHaveBeenCalledOnce();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

for (const swap of ["symlink", "directory", "unrelated-file"] as const) {
	const swappedFile = swap === "unrelated-file";
	it(`rejects a parent swap at destination open before firmware bytes; swap=${swap}`, async () => {
		const real = await fs();
		const root = await scratch();
		const volume = join(root, "QUAKE DFU");
		const decoy = join(root, "decoy");
		const destination = join(
			swap === "directory" ? volume : decoy,
			"open-quake-update.uf2",
		);
		await mkdir(volume);
		await mkdir(decoy);
		await writeFile(join(volume, "INFO_UF2.TXT"), "UF2 Board-ID: QUAKE RP2040");
		const source = join(root, "image.uf2");
		await writeFile(source, payload);
		const files = firmwareFiles([root], [descriptor]);
		let close = vi.fn();
		try {
			const image = await Effect.runPromise(files.inspect(source));
			const [selected] = await Effect.runPromise(files.discover());
			if (!selected) throw new Error("Missing synthetic volume");
			vi.mocked(open).mockImplementation(async (...args) => {
				if (String(args[0]).endsWith("open-quake-update.uf2")) {
					await rename(volume, join(root, "original"));
					if (swap === "directory") await rename(decoy, volume);
					else await symlink(decoy, volume);
					const handle = await real.open(...args);
					close = vi.spyOn(handle, "close");
					if (swappedFile) {
						await rename(destination, join(decoy, "owned-empty"));
						await writeFile(destination, "unrelated replacement");
					}
					return handle;
				}
				return real.open(...args);
			});
			const progress = vi.fn();
			const result = await Effect.runPromise(
				files.copy(image, selected, progress).pipe(Effect.either),
			);
			expect(result._tag === "Left" && result.left.code).toBe(
				"QUAKE.FIRMWARE.VOLUME_INVALID",
			);
			expect(progress).not.toHaveBeenCalled();
			expect(close).toHaveBeenCalledOnce();
			if (swappedFile) {
				expect(await readFile(destination, "utf8")).toBe(
					"unrelated replacement",
				);
				expect((await lstat(join(decoy, "owned-empty"))).size).toBe(0);
			} else expect((await lstat(destination)).size).toBe(0);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
}
