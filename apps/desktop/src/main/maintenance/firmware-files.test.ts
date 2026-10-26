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
import {
	firmwareFiles,
	hashBytes,
	trustedFirmware,
	validateFirmware,
} from "./firmware-files";

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

it("discovers highest trusted bundled UF2 across packaged/dev roots without trusting filenames", async () => {
	const root = await mkdtemp(join(tmpdir(), "bundled-synthetic-"));
	const first = join(root, "resources", "firmware");
	const second = join(root, "public", "firmware");
	await mkdir(first, { recursive: true });
	await mkdir(second, { recursive: true });
	const newer = Uint8Array.from(payload);
	newer[40] = 0xee;
	const descriptors = [
		{ ...descriptor, version: "1.0.19" },
		{ ...descriptor, sha256: hashBytes(newer) },
	];
	try {
		await writeFile(join(first, "QUAKE_01.00.19_NEW.uf2"), payload);
		await writeFile(join(second, "QUAKE_01.00.21_NEW.uf2"), newer);
		await writeFile(join(second, "QUAKE_99.00.00.uf2"), newer);
		await writeFile(join(second, "QUAKE_01.00.21.bin"), newer);
		await writeFile(join(second, "QUAKE_01.00.21.hex"), newer);
		await writeFile(join(second, "arbitrary.uf2"), newer);
		await writeFile(
			join(first, "QUAKE_01.00.21_BROKEN.uf2"),
			Buffer.from("bad magic"),
		);
		const files = firmwareFiles([], descriptors);
		expect(
			await Effect.runPromise(
				files.bundled([first, second, join(root, "missing")]),
			),
		).toMatchObject({
			version: "1.0.21",
			fileName: "QUAKE_01.00.21_NEW.uf2",
			trusted: true,
		});
		expect(await Effect.runPromise(files.selected())).toMatchObject({
			fingerprint: hashBytes(newer),
		});
		await rm(join(second, "QUAKE_01.00.21_NEW.uf2"));
		// Renaming an older trusted image as a newer version never authorizes it.
		await writeFile(join(second, "QUAKE_01.00.21_RENAMED.uf2"), payload);
		expect(
			await Effect.runPromise(
				firmwareFiles([], descriptors).bundled([first, second]),
			),
		).toMatchObject({ version: "1.0.19" });
		expect(
			await Effect.runPromise(firmwareFiles([]).bundled([first, second])),
		).toBeUndefined();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
it("pins audited descriptor facts and rejects synthetic payloads using production trust", () => {
	expect(trustedFirmware).toEqual([
		{
			board: "QUAKE",
			version: "1.0.21",
			sha256:
				"92b171021caf5ce098f31ab901c796f4facf593ea9b1d450abbbd8a16d51f874",
			start: 0x12000,
			end: 0x6e7ff,
		},
	]);
	expect(validateFirmware(payload, "QUAKE_01.00.21_NEW.uf2").trusted).toBe(
		false,
	);
	const mutated = Uint8Array.from(payload);
	mutated[40] = 3;
	expect(validateFirmware(mutated, "QUAKE_01.00.21_NEW.uf2").trusted).toBe(
		false,
	);
});
