import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { syntheticUf2 } from "../../../../../packages/protocol/src/uf2-fixtures.js";
import { firmwareFiles, hashBytes, validateFirmware } from "./firmware-files";

const payload = syntheticUf2();
const descriptor = {
	board: "QUAKE" as const,
	sha256: hashBytes(payload),
	version: "1.0.21",
	start: 0x12000,
	end: 0x121ff,
};
describe("firmware filesystem adapter, scratch fake volume only", () => {
	it("family alone never authorizes a write", () => {
		expect(validateFirmware(payload, "fake.uf2").trusted).toBe(false);
		expect(validateFirmware(payload, "fake.uf2", [descriptor]).trusted).toBe(
			true,
		);
	});
	it("revalidates image/mount and exclusively copies only after selection", async () => {
		const root = await realpath(
			await mkdtemp(join(tmpdir(), "oq-fake-volume-")),
		);
		const volume = join(root, "QUAKE DFU");
		const image = join(root, "fixture.uf2");
		await mkdir(volume);
		await writeFile(join(volume, "INFO_UF2.TXT"), "UF2 Board-ID: QUAKE RP2040");
		await writeFile(image, payload);
		const files = firmwareFiles([root], [descriptor]);
		try {
			const inspected = await Effect.runPromise(files.inspect(image));
			const [selected] = await Effect.runPromise(files.discover());
			expect(selected).toBeDefined();
			if (!selected) throw new Error("Missing fake volume");
			const changed = Uint8Array.from(payload);
			changed[40] = 0xff;
			await writeFile(image, changed);
			const changedResult = await Effect.runPromise(
				files.copy(inspected, selected, () => {}).pipe(Effect.either),
			);
			expect(changedResult._tag).toBe("Left");
			if (changedResult._tag === "Left")
				expect(changedResult.left.code).toBe("QUAKE.FIRMWARE.TARGET_MISMATCH");
			await writeFile(image, payload);
			let progress = 0;
			await Effect.runPromise(
				files.copy(inspected, selected, (n) => {
					progress = n;
				}),
			);
			expect(progress).toBe(payload.length);
			expect(await readFile(join(volume, "open-quake-update.uf2"))).toEqual(
				Buffer.from(payload),
			);
			expect(
				(
					await Effect.runPromise(
						files.copy(inspected, selected, () => {}).pipe(Effect.either),
					)
				)._tag,
			).toBe("Left");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
	it("does not accept ordinary or replaced data directories", async () => {
		const root = await realpath(
			await mkdtemp(join(tmpdir(), "oq-fake-volume-")),
		);
		const volume = join(root, "QUAKE DFU");
		await mkdir(volume);
		const files = firmwareFiles([root], [descriptor]);
		try {
			expect(await Effect.runPromise(files.discover())).toEqual([]);
			await writeFile(
				join(volume, "INFO_UF2.TXT"),
				"UF2 Board-ID: QUAKE RP2040",
			);
			const [selected] = await Effect.runPromise(files.discover());
			expect(selected).toBeDefined();
			await rename(volume, join(root, "old"));
			await symlink(join(root, "old"), volume);
			expect(await Effect.runPromise(files.discover())).toEqual([]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
