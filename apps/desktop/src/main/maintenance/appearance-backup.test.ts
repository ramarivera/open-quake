import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { defaultAppearance } from "../../renderer/src/theme/appearance";
import {
	acknowledgeAppearance,
	appearanceRecord,
	pendingAppearance,
} from "./appearance-backup";

it("validates restored appearance and only consumes the record acknowledged by its consumer", async () => {
	const root = await mkdtemp(join(tmpdir(), "oq-appearance-"));
	try {
		const restored = JSON.stringify({
			...defaultAppearance,
			theme: "light",
			motion: "reduce",
		});
		await writeFile(join(root, "appearance.json"), restored);
		expect(await pendingAppearance(root)).toBe(restored);
		await acknowledgeAppearance(root, JSON.stringify(defaultAppearance));
		expect(await readFile(join(root, "appearance.json"), "utf8")).toBe(
			restored,
		);
		await acknowledgeAppearance(root, restored);
		expect(await pendingAppearance(root)).toBeUndefined();
		expect(() => appearanceRecord('{"version":2}')).toThrow(
			expect.objectContaining({ code: "QUAKE.BACKUP.INVALID" }),
		);
		await mkdir(join(root, "appearance.json"));
		await expect(pendingAppearance(root)).rejects.toMatchObject({
			code: "QUAKE.BACKUP.INVALID",
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
